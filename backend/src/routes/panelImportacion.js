import { Router } from 'express';
import multer from 'multer';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { tienePermiso } from '../utils/permisos.js';
import {
  crearAsistenteDirecto, crearFamiliaDirecta,
  activarVerificacionAltaAsistente, revertirAsistenteImportado, revertirFamiliaImportada,
} from '../utils/cuentasPanel.js';
import { parsearArchivo, intentarParsearSQL, evaluarViabilidadIA, proponerMapeoIA, CAMPOS_IMPORTACION } from '../utils/importacionIA.js';

export const panelImportacionRouter = Router();

// Capa 1 (formato conocido): toda extensión que `xlsx` sabe leer (spreadsheets comunes +
// texto delimitado) más `.sql` (dump estándar, ver intentarParsearSQL). Cualquier otra
// extensión no se rechaza de plano en el filtro — pasa a /analizar, que intenta la Capa 1
// y si no calza recién ahí cae a la Capa 2 (juicio de viabilidad de IA); el filtro de multer
// solo pone un techo de tamaño, no de formato, según lo acordado ("que se ocupe la IA" para
// el resto).
const TAMANO_MAXIMO = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
});

function manejarErrorMulter(err, req, res, next) {
  if (err) {
    return res.status(400).json({ error: 'Archivo no permitido (hasta 5 MB)' });
  }
  next();
}

function requierePermiso(accion) {
  return async (req, res, next) => {
    const permitido = await tienePermiso({ accion, usuarioId: req.usuarioPanel?.id });
    if (!permitido) {
      return res.status(403).json({ error: 'La Prestadora no habilitó esta acción' });
    }
    next();
  };
}

// Sube un archivo (Excel/CSV), lo interpreta y devuelve un mapeo propuesto por IA para que
// el Admin_prestadora lo revise/corrija antes de confirmar nada (ver Fase 3 del plan
// aprobado — no se crea ningún dato todavía en este paso).
panelImportacionRouter.post(
  '/analizar',
  requiereRolPanel,
  requierePermiso('importar_datos_masivos'),
  upload.single('archivo'),
  manejarErrorMulter,
  async (req, res) => {
    const { tipo } = req.body;
    if (!['asistente', 'familia'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de importación inválido' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Falta el archivo' });
    }

    let headers;
    let filas;
    let viaIA = false;

    try {
      ({ headers, filas } = parsearArchivo(req.file.buffer, req.file.originalname));
    } catch {
      const resultadoSQL = intentarParsearSQL(req.file.buffer);
      if (resultadoSQL) {
        ({ headers, filas } = resultadoSQL);
      } else {
        const viabilidad = await evaluarViabilidadIA({
          tipo, nombreArchivo: req.file.originalname, buffer: req.file.buffer, prestadoraId: req.usuarioPanel?.prestadoraId,
        });
        if (!viabilidad.viable) {
          return res.status(400).json({ error: viabilidad.motivo });
        }
        ({ headers, filas } = viabilidad);
        viaIA = true;
      }
    }

    try {
      const { mapeo, advertencias } = await proponerMapeoIA({ tipo, headers, filasMuestra: filas, prestadoraId: req.usuarioPanel?.prestadoraId });
      res.json({
        headers,
        filas,
        mapeoPropuesto: mapeo,
        advertencias: viaIA
          ? ['La estructura de este archivo fue interpretada por IA — conviene revisar el mapeo con especial atención antes de confirmar', ...advertencias]
          : advertencias,
        camposDisponibles: CAMPOS_IMPORTACION[tipo],
        archivoNombre: req.file.originalname,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);

const CAMPOS_ASISTENTE_ARRAY = new Set(['zonas']);
const CAMPOS_FAMILIA_ARRAY = new Set(['patologiasPaciente']);

function valorDesdeFila(fila, mapeo, campo, esArray) {
  const columna = Object.keys(mapeo).find((col) => mapeo[col] === campo);
  if (!columna) return esArray ? [] : undefined;
  const valor = fila[columna];
  if (esArray) {
    return String(valor ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  }
  return valor === '' || valor == null ? undefined : valor;
}

// Confirma la importación: recorre cada fila del archivo (ya con el mapeo corregido por el
// Admin_prestadora) y reutiliza exactamente crearAsistenteDirecto/crearFamiliaDirecta — el
// mismo camino de creación que el alta manual de la Fase 1 (ver alcance de la Fase 3: "no se
// construye un camino de creación de datos paralelo"). Un error en una fila no aborta el
// resto del lote; se acumula en el resumen y queda en el registro de auditoría.
//
// Las filas creadas acá quedan con `pendiente_conformidad=true` (ocultas por la política
// RESTRICTIVE de RLS) hasta que la Prestadora revise el resultado real y lo conforme o lo
// rechace vía /conformar o /rechazar — un filtro de conformidad que dejara pasar los datos
// antes de obtenerla no cumpliría ninguna función.
panelImportacionRouter.post(
  '/confirmar',
  requiereRolPanel,
  requierePermiso('importar_datos_masivos'),
  async (req, res) => {
    const { tipo, filas, mapeo, archivoNombre } = req.body;
    if (!['asistente', 'familia'].includes(tipo) || !Array.isArray(filas) || !mapeo) {
      return res.status(400).json({ error: 'Datos de importación incompletos' });
    }

    const prestadoraId = req.usuarioPanel.prestadoraId;

    const { data: lote, error: errorLote } = await supabase
      .from('importaciones_prestadora')
      .insert({
        prestadora_id: prestadoraId,
        usuario_id: req.usuarioPanel.id,
        tipo,
        archivo_nombre: archivoNombre || null,
        filas_totales: filas.length,
      })
      .select()
      .single();
    if (errorLote) {
      return res.status(500).json({ error: 'No se pudo registrar el lote de importación' });
    }

    const errores = [];
    let creadas = 0;

    for (let i = 0; i < filas.length; i += 1) {
      const fila = filas[i];
      try {
        if (tipo === 'asistente') {
          const datos = { prestadoraId, usuarioPanelId: req.usuarioPanel.id, importacionId: lote.id };
          for (const campo of CAMPOS_IMPORTACION.asistente) {
            datos[campo] = valorDesdeFila(fila, mapeo, campo, CAMPOS_ASISTENTE_ARRAY.has(campo));
          }
          await crearAsistenteDirecto(datos);
        } else {
          const datos = { prestadoraId, importacionId: lote.id };
          for (const campo of CAMPOS_IMPORTACION.familia) {
            datos[campo] = valorDesdeFila(fila, mapeo, campo, CAMPOS_FAMILIA_ARRAY.has(campo));
          }
          await crearFamiliaDirecta(datos);
        }
        creadas += 1;
      } catch (error) {
        errores.push({ fila: i + 1, error: error.message });
      }
    }

    await supabase
      .from('importaciones_prestadora')
      .update({ filas_creadas: creadas, filas_error: errores.length, errores })
      .eq('id', lote.id);

    res.json({
      ok: true,
      importacionId: lote.id,
      filasTotales: filas.length,
      filasCreadas: creadas,
      filasError: errores.length,
      errores,
    });
  }
);

// Trae el lote y las filas efectivamente creadas para que la Prestadora revise el resultado
// real (no la propuesta) antes de conformarlo — segundo freno humano de la capa de importación.
panelImportacionRouter.get(
  '/revision/:importacionId',
  requiereRolPanel,
  requierePermiso('importar_datos_masivos'),
  async (req, res) => {
    const prestadoraId = req.usuarioPanel.prestadoraId;
    const { data: lote, error: errorLote } = await supabase
      .from('importaciones_prestadora')
      .select('*')
      .eq('id', req.params.importacionId)
      .eq('prestadora_id', prestadoraId)
      .single();
    if (errorLote || !lote) {
      return res.status(404).json({ error: 'Lote de importación no encontrado' });
    }

    const tabla = lote.tipo === 'asistente' ? 'asistentes' : 'familias';
    const { data: filas, error: errorFilas } = await supabase
      .from(tabla)
      .select(lote.tipo === 'asistente'
        ? 'id, nombre, dni, email, telefono'
        : 'id, plan, pacientes(id, nombre, domicilio)')
      .eq('importacion_id', lote.id);
    if (errorFilas) {
      return res.status(500).json({ error: 'No se pudieron leer las filas del lote' });
    }

    res.json({ lote, filas });
  }
);

// Conforma el lote: recién acá las filas dejan de estar `pendiente_conformidad` y pasan a
// ser operables (visibles por RLS). Para Asistentes, corre además la política de
// verificación de alta que había quedado en espera desde la creación (mismo camino que el
// alta manual — activarVerificacionAltaAsistente).
panelImportacionRouter.post(
  '/conformar/:importacionId',
  requiereRolPanel,
  requierePermiso('importar_datos_masivos'),
  async (req, res) => {
    const prestadoraId = req.usuarioPanel.prestadoraId;
    const { data: lote, error: errorLote } = await supabase
      .from('importaciones_prestadora')
      .select('*')
      .eq('id', req.params.importacionId)
      .eq('prestadora_id', prestadoraId)
      .single();
    if (errorLote || !lote) {
      return res.status(404).json({ error: 'Lote de importación no encontrado' });
    }
    if (lote.estado_conformidad !== 'pendiente') {
      return res.status(409).json({ error: 'Este lote ya fue revisado' });
    }

    const tabla = lote.tipo === 'asistente' ? 'asistentes' : 'familias';
    const { data: filas, error: errorFilas } = await supabase
      .from(tabla)
      .select('id')
      .eq('importacion_id', lote.id);
    if (errorFilas) {
      return res.status(500).json({ error: 'No se pudieron leer las filas del lote' });
    }

    const { error: errorUpdate } = await supabase
      .from(tabla)
      .update({ pendiente_conformidad: false })
      .eq('importacion_id', lote.id);
    if (errorUpdate) {
      return res.status(500).json({ error: 'No se pudo conformar el lote' });
    }

    if (lote.tipo === 'asistente') {
      for (const fila of filas) {
        try {
          await activarVerificacionAltaAsistente(fila.id, prestadoraId, req.usuarioPanel.id);
        } catch (error) {
          console.error('Error activando verificación de alta tras conformar importación:', error.message);
        }
      }
    }

    await supabase
      .from('importaciones_prestadora')
      .update({ estado_conformidad: 'confirmada', revisada_en: new Date().toISOString(), revisada_por: req.usuarioPanel.id })
      .eq('id', lote.id);

    res.json({ ok: true, filasConfirmadas: filas.length });
  }
);

// Rechaza el lote: revierte cada fila creada (cuenta + registro) usando el mismo desarmado
// que el alta manual ante un error a mitad de camino — nunca deja huérfanas ni cuentas ni
// filas a medio crear.
panelImportacionRouter.post(
  '/rechazar/:importacionId',
  requiereRolPanel,
  requierePermiso('importar_datos_masivos'),
  async (req, res) => {
    const prestadoraId = req.usuarioPanel.prestadoraId;
    const { data: lote, error: errorLote } = await supabase
      .from('importaciones_prestadora')
      .select('*')
      .eq('id', req.params.importacionId)
      .eq('prestadora_id', prestadoraId)
      .single();
    if (errorLote || !lote) {
      return res.status(404).json({ error: 'Lote de importación no encontrado' });
    }
    if (lote.estado_conformidad !== 'pendiente') {
      return res.status(409).json({ error: 'Este lote ya fue revisado' });
    }

    const tabla = lote.tipo === 'asistente' ? 'asistentes' : 'familias';
    const { data: filas, error: errorFilas } = await supabase
      .from(tabla)
      .select('id')
      .eq('importacion_id', lote.id);
    if (errorFilas) {
      return res.status(500).json({ error: 'No se pudieron leer las filas del lote' });
    }

    // Las dos funciones nunca fallan: si algo queda sin limpiar lo anotan en el registro del
    // servidor y devuelven `false`. Por eso el número que se cuenta acá es el de filas que se
    // revirtieron **enteras**, no el de intentos que no explotaron.
    let revertidas = 0;
    for (const fila of filas) {
      const limpia = lote.tipo === 'asistente'
        ? await revertirAsistenteImportado(fila.id, prestadoraId)
        : await revertirFamiliaImportada(fila.id, prestadoraId);
      if (limpia) revertidas += 1;
    }

    await supabase
      .from('importaciones_prestadora')
      .update({ estado_conformidad: 'rechazada', revisada_en: new Date().toISOString(), revisada_por: req.usuarioPanel.id })
      .eq('id', lote.id);

    res.json({ ok: true, filasRevertidas: revertidas });
  }
);
