import { Router } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import { extensionDeArchivo } from '../utils/archivosSubidos.js';

export const panelAusenciasRouter = Router();

const BUCKET = 'certificados-medicos';
const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];
const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter(req, file, cb) {
    cb(null, TIPOS_PERMITIDOS.includes(file.mimetype));
  },
});

function clienteR2() {
  return new S3Client({
    endpoint: process.env.R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function ausenciaDeLaPrestadora(ausenciaId, usuarioPanel) {
  let query = supabase.from('ausencias').select('id, prestadora_id, asistente_id').eq('id', ausenciaId);
  query = acotarAPrestadora(query, usuarioPanel);
  const { data } = await query.maybeSingle();
  return data;
}

function manejarErrorMulter(err, req, res, next) {
  if (err) {
    return res.status(400).json({ error: 'Archivo no permitido (solo PDF, JPG o PNG, hasta 10 MB)' });
  }
  next();
}

panelAusenciasRouter.post(
  '/:id/certificado',
  requiereRolPanel,
  exigirOrganizacionActiva,
  upload.single('archivo'),
  manejarErrorMulter,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo faltante o de tipo no permitido (solo PDF, JPG o PNG, hasta 10 MB)' });
    }

    const ausencia = await ausenciaDeLaPrestadora(req.params.id, req.usuarioPanel);
    if (!ausencia) {
      return res.status(404).json({ error: 'Ausencia no encontrada' });
    }

    const extension = extensionDeArchivo(req.file.mimetype);
    const ruta = `${ausencia.prestadora_id}/${ausencia.id}/certificado.${extension}`;

    const { error: errorSubida } = await supabase.storage
      .from(BUCKET)
      .upload(ruta, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (errorSubida) {
      return res.status(500).json({ error: errorSubida.message });
    }

    try {
      await clienteR2().send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: `certificados-medicos-mirror/${ruta}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
    } catch (errorMirror) {
      // El mirror a R2 es un resguardo adicional (docs/PLAN_CONTINUIDAD_PROVEEDORES.md
      // punto 1) — no bloquea la operación principal si falla, pero queda logueado sin
      // exponer el contenido del archivo (Regla 7).
      console.error('Error al espejar certificado médico a R2:', errorMirror.message);
    }

    // El archivo ya está subido: lo único que falta es que la ausencia lo apunte. Si esa fila ya
    // no está, el certificado queda arriba sin dueño y nadie lo va a encontrar nunca — así que
    // eso se dice, no se contesta que salió todo bien.
    const { data: apuntada, error: errorUpdate } = await supabase
      .from('ausencias')
      .update({ certificado_url: ruta })
      .eq('id', ausencia.id)
      .select('id');
    if (errorUpdate) {
      return res.status(500).json({ error: errorUpdate.message });
    }
    if (!apuntada?.length) {
      return res.status(404).json({ error: 'No se encontró esa ausencia' });
    }

    res.json({ ok: true });
  },
);

panelAusenciasRouter.get('/:id/certificado-url', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  const ausencia = await ausenciaDeLaPrestadora(req.params.id, req.usuarioPanel);
  if (!ausencia) {
    return res.status(404).json({ error: 'Ausencia no encontrada' });
  }

  const { data: fila } = await supabase.from('ausencias').select('certificado_url').eq('id', ausencia.id).single();
  if (!fila?.certificado_url) {
    return res.status(404).json({ error: 'Esta ausencia no tiene certificado cargado' });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fila.certificado_url, 60);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ url: data.signedUrl });
});
