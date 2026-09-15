import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import {
  esResultadoDeReferencia,
  estadoDeLasReferencias,
  RESULTADO_PENDIENTE,
  RESULTADO_VERIFICADA,
  TOPE_DE_REFERENCIAS,
} from '../utils/referenciasLaborales.js';
import { responderError } from '../utils/errorConMotivo.js';

// Las referencias laborales de un Asistente, una por una.
//
// QUÉ RESOLVÍA MAL ESTO. La postulación pide hasta cinco referencias y las guarda adentro, como
// un documento que se lee entero. Nadie podía dejar constancia de haber llamado a ninguna: la
// verificación pasaba por afuera del producto y lo único que quedaba era una etapa marcada a mano.
//
// LO QUE ESTA RUTA NO HACE. No impide nada. Que falten referencias verificadas se ve en la
// pantalla; incorporar igual a esa persona lo decide la Prestadora, que es la que responde por
// ella (`CLAUDE.md` §7: el producto avisa, no bloquea).

export const panelReferenciasLaboralesRouter = Router();

const COLUMNAS = 'id, nombre, telefono, vinculo, resultado, notas, verificada_por, verificada_en, created_at';

async function asistenteDeLaPrestadora(asistenteId, usuarioPanel) {
  let query = supabase
    .from('asistentes')
    .select('id, prestadora_id')
    .eq('id', asistenteId);
  query = acotarAPrestadora(query, usuarioPanel);
  const { data } = await query.maybeSingle();
  return data;
}

// Cuántas espera esta Prestadora. Sin fila de configuración no se espera ninguna, y entonces no
// hay nada que avisar: el número nunca sale escrito en el código.
async function minimoDeLaPrestadora(prestadoraId) {
  const { data } = await supabase
    .from('configuracion_referencias_laborales')
    .select('minimo_verificadas')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  return data?.minimo_verificadas ?? 0;
}

// Un texto que llega de afuera: se recorta, y vacío es vacío y no una cadena de espacios.
function textoLimpio(valor) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

panelReferenciasLaboralesRouter.get(
  '/:asistenteId',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    const asistente = await asistenteDeLaPrestadora(req.params.asistenteId, req.usuarioPanel);
    if (!asistente) {
      return res.status(404).json({ error: 'asistente_no_encontrado', motivo: 'asistente_no_encontrado' });
    }

    const { data, error } = await supabase
      .from('referencias_laborales_asistente')
      .select(COLUMNAS)
      .eq('prestadora_id', asistente.prestadora_id)
      .eq('asistente_id', asistente.id)
      .order('created_at');
    if (error) return responderError(res, error);

    const referencias = data ?? [];
    const minimo = await minimoDeLaPrestadora(asistente.prestadora_id);
    res.json({ referencias, ...estadoDeLasReferencias(referencias, minimo) });
  },
);

// Una referencia cargada a mano. Hace falta para quien entró sin postulación —una Prestadora que
// llega con su plantel armado, un alta manual— y para la que la persona recuerda después.
panelReferenciasLaboralesRouter.post(
  '/:asistenteId',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    const nombre = textoLimpio(req.body?.nombre);
    const telefono = textoLimpio(req.body?.telefono);
    if (!nombre || !telefono) {
      return res.status(400).json({ error: 'faltan_datos', motivo: 'faltan_datos' });
    }

    const asistente = await asistenteDeLaPrestadora(req.params.asistenteId, req.usuarioPanel);
    if (!asistente) {
      return res.status(404).json({ error: 'asistente_no_encontrado', motivo: 'asistente_no_encontrado' });
    }

    // El tope es el mismo del formulario de postulación: por acá no se carga más de lo que por
    // allá se puede escribir. Se cuenta en el servidor porque es acá donde entra el dato.
    const { count, error: errorCuenta } = await supabase
      .from('referencias_laborales_asistente')
      .select('id', { count: 'exact', head: true })
      .eq('prestadora_id', asistente.prestadora_id)
      .eq('asistente_id', asistente.id);
    if (errorCuenta) return responderError(res, errorCuenta);
    if ((count ?? 0) >= TOPE_DE_REFERENCIAS) {
      return res.status(400).json({ error: 'demasiadas_referencias', motivo: 'demasiadas_referencias' });
    }

    const { data, error } = await supabase
      .from('referencias_laborales_asistente')
      .insert({
        prestadora_id: asistente.prestadora_id,
        asistente_id: asistente.id,
        nombre,
        telefono,
        vinculo: textoLimpio(req.body?.vinculo),
        resultado: RESULTADO_PENDIENTE,
      })
      .select(COLUMNAS)
      .single();
    if (error) return responderError(res, error);

    res.json({ ok: true, referencia: data });
  },
);

// Lo que deja alguien después de llamar: qué contestaron y qué anotó. Quién llamó y cuándo no los
// escribe la pantalla — los pone el servidor, porque son la firma de esa verificación.
panelReferenciasLaboralesRouter.patch(
  '/:asistenteId/:referenciaId',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    const { resultado } = req.body ?? {};
    if (!esResultadoDeReferencia(resultado)) {
      return res.status(400).json({ error: 'resultado_invalido', motivo: 'resultado_invalido' });
    }

    const asistente = await asistenteDeLaPrestadora(req.params.asistenteId, req.usuarioPanel);
    if (!asistente) {
      return res.status(404).json({ error: 'asistente_no_encontrado', motivo: 'asistente_no_encontrado' });
    }

    // Volver a «pendiente» borra la firma: si nadie la verificó, no puede quedar dicho que
    // alguien lo hizo.
    const esPendiente = resultado === RESULTADO_PENDIENTE;
    const cambios = {
      resultado,
      notas: textoLimpio(req.body?.notas),
      verificada_por: esPendiente ? null : req.usuarioPanel.id,
      verificada_en: esPendiente ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Los dos filtros van juntos: el de la Prestadora es el que impide tocar la referencia de un
    // Asistente ajeno aunque alguien sepa su identificador.
    const { data, error } = await supabase
      .from('referencias_laborales_asistente')
      .update(cambios)
      .eq('id', req.params.referenciaId)
      .eq('prestadora_id', asistente.prestadora_id)
      .eq('asistente_id', asistente.id)
      .select(COLUMNAS)
      .maybeSingle();
    if (error) return responderError(res, error);
    if (!data) {
      return res.status(404).json({ error: 'referencia_no_encontrada', motivo: 'referencia_no_encontrada' });
    }

    res.json({ ok: true, referencia: data, verificada: resultado === RESULTADO_VERIFICADA });
  },
);
