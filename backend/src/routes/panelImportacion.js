import { Router } from 'express';
import multer from 'multer';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { requierePermiso } from '../utils/permisos.js';
import {
  crearAsistenteDirecto, crearFamiliaDirecta,
  activarVerificacionAltaAsistente, revertirAsistenteImportado, revertirFamiliaImportada,
} from '../utils/cuentasPanel.js';
import {
  parsearArchivo, intentarParsearSQL, evaluarViabilidadIA, proponerMapeoIA,
  CAMPOS_IMPORTACION, CAMPOS_LISTA, valorDesdeFila,
} from '../utils/importacionIA.js';
import { proponerConfiguracionInicial } from '../utils/propuestaConfiguracionInicial.js';
import { responderError } from '../utils/errorConMotivo.js';

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

const AVISO_ESTRUCTURA_VIA_IA =
  'La estructura de este archivo fue interpretada por IA — conviene revisar el mapeo con especial atención antes de confirmar';

// Las tres capas de lectura, en un solo lugar. Están escritas acá y no adentro de una ruta
// porque las usan dos: la que analiza para importar y la que propone la configuración inicial
// desde la guía de primeros pasos. Copiar la cadena habría dejado dos lecturas que se separan
// (celtatech/CLAUDE.md §8, punto único de verdad).
//
// Devuelve `{ ok: false, motivo }` cuando ninguna capa pudo interpretar el archivo; ese motivo
// ya está escrito para mostrarse en pantalla.
async function leerPlanillaSubida({ tipo, archivo, prestadoraId }) {
  try {
    return { ok: true, viaIA: false, ...parsearArchivo(archivo.buffer, archivo.originalname) };
  } catch {
    const resultadoSQL = intentarParsearSQL(archivo.buffer);
    if (resultadoSQL) return { ok: true, viaIA: false, ...resultadoSQL };

    const viabilidad = await evaluarViabilidadIA({
      tipo, nombreArchivo: archivo.originalname, buffer: archivo.buffer, prestadoraId,
    });
    if (!viabilidad.viable) return { ok: false, motivo: viabilidad.motivo };
    return { ok: true, viaIA: true, headers: viabilidad.headers, filas: viabilidad.filas };
  }
}

// Lo anterior más el mapeo propuesto por IA: exactamente lo que devuelve `/analizar`, para que
// la guía de primeros pasos pueda pasarle su lectura a la pantalla de importación sin que el
// archivo se lea —ni se le pregunte a la IA— dos veces.
async function analizarPlanillaSubida({ tipo, archivo, prestadoraId }) {
  const lectura = await leerPlanillaSubida({ tipo, archivo, prestadoraId });
  if (!lectura.ok) return lectura;

  const { mapeo, advertencias } = await proponerMapeoIA({
    tipo, headers: lectura.headers, filasMuestra: lectura.filas, prestadoraId,
  });

  return {
    ok: true,
    analisis: {
      headers: lectura.headers,
      filas: lectura.filas,
      mapeoPropuesto: mapeo,
      advertencias: lectura.viaIA ? [AVISO_ESTRUCTURA_VIA_IA, ...advertencias] : advertencias,
      camposDisponibles: CAMPOS_IMPORTACION[tipo],
      archivoNombre: archivo.originalname,
    },
  };
}

function tipoValido(tipo) {
  return ['asistente', 'familia'].includes(tipo);
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
    if (!tipoValido(tipo)) {
      return res.status(400).json({ error: 'Tipo de importación inválido' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Falta el archivo' });
    }

    try {
      const resultado = await analizarPlanillaSubida({
        tipo, archivo: req.file, prestadoraId: req.usuarioPanel?.prestadoraId,
      });
      if (!resultado.ok) {
        return res.status(400).json({ error: resultado.motivo });
      }
      res.json(resultado.analisis);
    } catch (error) {
      responderError(res, error, 400);
    }
  }
);

// La guía de primeros pasos, con una planilla que la Prestadora ya tiene.
//
// Lee el archivo con la misma cadena de arriba y contesta qué configuración inicial traería:
// cuántas filas, y —para una planilla de Asistentes— qué zonas de cobertura y qué tipos de
// Asistente nombra que todavía no estén configurados. Eso último es lo que la importación no
// crea sola, y descubrirlo antes evita tener que corregir ficha por ficha después.
//
// No crea nada. Devuelve además el análisis entero para que la pantalla de importación siga
// desde donde quedó, sin volver a leer el archivo.
panelImportacionRouter.post(
  '/propuesta-inicial',
  requiereRolPanel,
  requierePermiso('importar_datos_masivos'),
  upload.single('archivo'),
  manejarErrorMulter,
  async (req, res) => {
    const { tipo } = req.body;
    if (!tipoValido(tipo)) {
      return res.status(400).json({ error: 'Tipo de importación inválido' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Falta el archivo' });
    }

    const prestadoraId = req.usuarioPanel?.prestadoraId;

    try {
      const resultado = await analizarPlanillaSubida({ tipo, archivo: req.file, prestadoraId });
      if (!resultado.ok) {
        return res.status(400).json({ error: resultado.motivo });
      }

      const propuesta = await proponerConfiguracionInicial({
        tipo,
        filas: resultado.analisis.filas,
        mapeo: resultado.analisis.mapeoPropuesto,
        prestadoraId,
      });

      res.json({
        tipo,
        archivoNombre: resultado.analisis.archivoNombre,
        ...propuesta,
        advertencias: resultado.analisis.advertencias,
        analisis: resultado.analisis,
      });
    } catch (error) {
      responderError(res, error, 400);
    }
  }
);

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
            datos[campo] = valorDesdeFila(fila, mapeo, campo, CAMPOS_LISTA.asistente.has(campo));
          }
          await crearAsistenteDirecto(datos);
        } else {
          const datos = { prestadoraId, importacionId: lote.id };
          for (const campo of CAMPOS_IMPORTACION.familia) {
            datos[campo] = valorDesdeFila(fila, mapeo, campo, CAMPOS_LISTA.familia.has(campo));
          }
          await crearFamiliaDirecta(datos);
        }
        creadas += 1;
      } catch (error) {
        // Acá no sirve `responderError`: esto es un renglón de un lote, y contestar cortaría la
        // importación en la primera fila que falla, que es justo lo que no se quiere. Pero el
        // texto crudo tampoco puede salir: este arreglo viaja al navegador en la respuesta de
        // `/confirmar` y además se guarda en `importaciones_prestadora.errores`, así que un
        // mensaje de Postgres quedaría escrito en la base y a la vista (`celtatech/CLAUDE.md`
        // §6). Afuera va el motivo, que la pantalla traduce; el detalle, al registro.
        console.error(`Importación ${lote.id}, fila ${i + 1}:`, error?.message ?? error);
        errores.push({ fila: i + 1, motivo: error?.motivo ?? 'falla_del_sistema' });
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
