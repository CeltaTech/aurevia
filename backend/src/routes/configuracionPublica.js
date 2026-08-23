import { Router } from 'express';
import { supabase } from '../db/connection.js';
import { resolverPrestadoraPublica } from '../middleware/resolverPrestadoraPublica.js';

// `mergeParams` para que llegue el `:prestadora` de la dirección donde se monta este router
// (server.js) — de ahí sale la Prestadora, no de un encabezado (resolverPrestadoraPublica.js).
export const configuracionPublicaRouter = Router({ mergeParams: true });

// Sin auth a propósito: el sitio público (sin login) necesita estos datos para no
// hardcodear teléfono/email/zonas (regla 1 de CLAUDE.md). Nunca expone nada de
// escalas_legales ni datos internos — solo lo que ya es público en el sitio.
// De qué Prestadora se trata lo dice la propia dirección, y un pedido que no resuelve se
// rechaza (ver backend/src/middleware/resolverPrestadoraPublica.js).
configuracionPublicaRouter.get('/', resolverPrestadoraPublica, async (req, res) => {
  const empresa = req.prestadoraPublica;
  const { data: zonas, error: errorZonas } = await supabase
    .from('zonas_cobertura')
    .select('codigo, nombre, categoria')
    .eq('activa', true)
    .eq('prestadora_id', req.prestadoraPublica.prestadora_id)
    .order('orden');

  if (errorZonas) {
    return res.status(500).json({ error: errorZonas.message });
  }

  res.json({ empresa, zonas });
});
