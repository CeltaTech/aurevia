import { Router } from 'express';
import multer from 'multer';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { supabase } from '../db/connection.js';
import { exigeVisible } from '../utils/visibilidadPrestadora.js';

// ============================================================================
// La Matrícula, vista desde el teléfono del Asistente.
//
// POR QUÉ EXISTE ESTA PANTALLA
// Sin Matrícula vigente, la base no deja que el Asistente atienda a nadie. Si
// eso pasa y él no se entera, lo único que ve es que dejaron de ofrecerle
// guardias, sin ningún motivo a la vista. La regla dice que nunca se bloquea en
// silencio, y el lugar donde ese aviso llega de verdad es el teléfono, no una
// pantalla del Panel que él no usa.
//
// Y el papel lo tiene él. Pedirle a la oficina que lo consiga es hacer trabajo
// de más para todos.
//
// LO QUE ACÁ NO SE PUEDE HACER, A PROPÓSITO
// El Asistente carga, y nada más. No verifica, no edita y no borra.
//
//   · Verificar es de la Prestadora. Toda Matrícula que llega por acá queda
//     marcada con `cargada_por_el_asistente`, y esa marca hace que la base le
//     exija verificación aunque la Prestadora esté en modo flexible. Si no
//     fuera así, cualquiera podría escribir un número inventado y habilitarse
//     solo: el interesado no se aprueba a sí mismo.
//   · Editar o borrar tampoco. Una Matrícula es una constancia de un momento;
//     si se pudiera cambiar después, no serviría como constancia de nada. Se
//     corrige cargando la nueva, que es lo que pasa en la vida real cuando el
//     organismo emite una renovación.
// ============================================================================

export const appAsistentesMatriculaRouter = Router();

const BUCKET = 'prescripciones-medicacion';

const TIPOS_ARCHIVO_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];
const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter(req, file, cb) {
    cb(null, TIPOS_ARCHIVO_PERMITIDOS.includes(file.mimetype));
  },
});

function manejarErrorMulter(err, req, res, next) {
  if (err) {
    return res.status(400).json({ error: 'Archivo faltante o de tipo no permitido (solo PDF, JPG o PNG, hasta 10 MB)' });
  }
  next();
}

// Lo que la base ya resolvió sobre este Asistente. Se piden solo las columnas
// que la pantalla del teléfono necesita: `modo_control_matricula` es una
// decisión interna de la Prestadora y no tiene por qué salir de ahí.
const COLUMNAS_ESTADO =
  'asistente_id, requiere_matricula, tipo_matricula, motivo_bloqueo, matricula_id, vigente_hasta, verificada_at, dias_para_vencer';

async function estadoDelAsistente(asistenteId) {
  const { data } = await supabase
    .from('estado_matricula_asistente')
    .select(COLUMNAS_ESTADO)
    .eq('asistente_id', asistenteId)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Cómo está mi Matrícula
// ---------------------------------------------------------------------------

appAsistentesMatriculaRouter.get('/', requiereRolAsistente, async (req, res) => {
  const estado = await estadoDelAsistente(req.usuarioAsistente.id);

  // Con cuántos días de anticipación avisa esta Prestadora. Es el mismo número
  // que usa para los demás papeles que vencen: dos ventanas distintas para la
  // misma idea terminan siempre desalineadas (CLAUDE.md §7.12).
  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('dias_aviso_vencimiento_documentos')
    .eq('id', req.usuarioAsistente.prestadoraId)
    .maybeSingle();

  const { data: matriculas, error } = await supabase
    .from('matriculas_asistente')
    .select('id, tipo, numero_matricula, vigente_desde, vigente_hasta, archivo_url, verificada_at, cargada_por_el_asistente, created_at')
    .eq('asistente_id', req.usuarioAsistente.id)
    .order('vigente_desde', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    estado,
    matriculas: matriculas ?? [],
    diasAviso: prestadora?.dias_aviso_vencimiento_documentos ?? null,
  });
});

// ---------------------------------------------------------------------------
// Cargar la Matrícula
//
// Llega en un solo envío —los datos y el archivo juntos— para que no pueda
// quedar a mitad de camino: un archivo subido sin su fila sería un papel
// suelto en el depósito que nadie va a mirar nunca.
//
// Hay Prestadoras que prefieren recibir el papel por la oficina y cargarlo
// ellas. Por eso la carga desde el teléfono se puede apagar (tarea 65). Ver
// cómo está la propia Matrícula no se apaga nunca: si la base lo está frenando
// para trabajar, tiene derecho a saber por qué.
// ---------------------------------------------------------------------------

appAsistentesMatriculaRouter.post(
  '/',
  requiereRolAsistente,
  exigeVisible('asistente_carga_su_matricula'),
  upload.single('archivo'),
  manejarErrorMulter,
  async (req, res) => {
    const { numeroMatricula, vigenteDesde, vigenteHasta } = req.body;

    const estado = await estadoDelAsistente(req.usuarioAsistente.id);
    // El tipo no lo elige el Asistente: lo dice su tipo de Asistente en el
    // catálogo. Dejarlo elegir sería dejarlo cargar la Matrícula equivocada y
    // seguir trabado sin entender por qué.
    if (!estado || estado.requiere_matricula !== true || !estado.tipo_matricula) {
      return res.status(400).json({ error: 'Este tipo de Asistente no requiere matrícula' });
    }
    if (!vigenteDesde) {
      return res.status(400).json({ error: 'Falta la fecha desde la que vale la matrícula' });
    }

    const { data: asistente } = await supabase
      .from('asistentes')
      .select('id, prestadora_id')
      .eq('id', req.usuarioAsistente.id)
      .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
      .maybeSingle();
    if (!asistente) return res.status(404).json({ error: 'Asistente no encontrado' });

    let archivoUrl = null;
    if (req.file) {
      const extension =
        req.file.mimetype === 'application/pdf' ? 'pdf' : req.file.mimetype === 'image/png' ? 'png' : 'jpg';
      const ruta = `${asistente.prestadora_id}/matriculas/${asistente.id}/matricula-${Date.now()}.${extension}`;
      const { error: errorSubida } = await supabase.storage
        .from(BUCKET)
        .upload(ruta, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      if (errorSubida) return res.status(500).json({ error: errorSubida.message });
      archivoUrl = ruta;
    }

    const { error } = await supabase.from('matriculas_asistente').insert({
      asistente_id: asistente.id,
      tipo: estado.tipo_matricula,
      numero_matricula: numeroMatricula || null,
      vigente_desde: vigenteDesde,
      vigente_hasta: vigenteHasta || null,
      archivo_url: archivoUrl,
      registrado_por: req.usuarioAsistente.id,
      cargada_por_el_asistente: true,
    });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ estado: await estadoDelAsistente(req.usuarioAsistente.id) });
  }
);

// ---------------------------------------------------------------------------
// Ver el archivo que subí
//
// El enlace dura un minuto y se arma acá, nunca en el teléfono: si la dirección
// del depósito quedara escrita en la pantalla, cualquiera que la copie entra al
// archivo de cualquier otro.
// ---------------------------------------------------------------------------

appAsistentesMatriculaRouter.get('/archivo-url', requiereRolAsistente, async (req, res) => {
  const ruta = req.query.ruta;
  if (typeof ruta !== 'string' || !ruta.includes(`/matriculas/${req.usuarioAsistente.id}/`)) {
    return res.status(400).json({ error: 'Ruta de archivo inválida' });
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 60);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ url: data.signedUrl });
});
