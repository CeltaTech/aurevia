import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { requierePermiso } from '../utils/permisos.js';
import { topeDePedidos } from '../middleware/topeDePedidos.js';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import {
  habilitarCambioDeClave,
  confirmarTelefonoDeLaCuenta,
  puedeHabilitar,
  minutosDeLaHabilitacion,
} from '../utils/habilitarCambioDeClave.js';
import { pedirRecuperacionDeClave } from '../utils/recuperacionDeClave.js';
import { avisarDeSeguridad, AVISO_CAMBIO_HABILITADO } from '../utils/avisoDeSeguridad.js';
import { registrarActividad, yaQuedoRegistrado } from '../utils/registroDeActividad.js';

// LA PRESTADORA HABILITA UN CAMBIO DE CLAVE. NO ELIGE NINGUNA CLAVE Y NO VE NINGUNA.
//
// QUÉ RESUELVE. Alguien llama porque no puede entrar: perdió el teléfono, cambió de número, no le
// llega el correo. Hasta acá no había ninguna salida que no fuera que otra persona le pusiera una
// clave, que es exactamente lo que no se hace. Lo que se abre es una puerta que dura poco y sirve
// una vez: la persona elige su clave, sola, en su pantalla.
//
// LA ACCIÓN ENTRA POR EL CATÁLOGO DE PERMISOS como cualquier otra, y sale reservada a la
// administración. Que la coordinadora la tenga lo decide cada Prestadora desde Configuración.
//
// SE HABILITA HACIA ABAJO Y NUNCA A UNO MISMO, y eso no es configurable: está en
// `utils/habilitarCambioDeClave.js` y además en un disparador de la base.
//
// NADA SENSIBLE VIAJA POR LA DIRECCIÓN WEB: ni el correo que se busca, ni el número, ni nada. Por
// eso la búsqueda es `POST` y no `GET`.

export const panelHabilitarClaveRouter = Router();

const ACCION = 'habilitar_cambio_de_clave';
const ACCION_HABILITAR = 'habilitacion_de_cambio_de_clave';
const ACCION_CONFIRMAR_TELEFONO = 'confirmacion_de_telefono_por_la_prestadora';

const TOPE_DE_LA_BUSQUEDA = 20;

/**
 * A quién se está por atender.
 *
 * SE BUSCA POR CUERPO Y DENTRO DE LA PRESTADORA DE LA SESIÓN. La lista sale ya filtrada por quién
 * puede habilitar a quién: mostrar a alguien que después no se va a poder habilitar es ofrecer un
 * botón que no funciona.
 *
 * NO DEVUELVE NINGÚN NÚMERO DE TELÉFONO, sólo si hay uno cargado y si está verificado. Quien atiende
 * el llamado no necesita leerlo: lo que hace es reconocer a la persona, no comprobar un número.
 */
panelHabilitarClaveRouter.post(
  '/buscar',
  requiereRolPanel,
  requierePermiso(ACCION),
  async (req, res) => {
    try {
      const texto = String(req.body?.texto ?? '').trim();
      if (texto.length < 3) throw new ErrorConMotivo('faltan_datos');

      const patron = `%${texto.replace(/[%_]/g, '')}%`;
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, email, rol, telefono, telefono_verificado_en')
        .eq('prestadora_id', req.usuarioPanel.prestadoraId)
        .or(`nombre.ilike.${patron},email.ilike.${patron}`)
        .limit(TOPE_DE_LA_BUSQUEDA);
      if (error) throw new Error(error.message);

      const alcanzables = (data ?? [])
        .filter((cuenta) => cuenta.id !== req.usuarioPanel.id)
        .filter((cuenta) => puedeHabilitar(req.usuarioPanel.rol, cuenta.rol));

      res.json({
        cuentas: await Promise.all(alcanzables.map((cuenta) => conFoto(cuenta))),
        minutos: minutosDeLaHabilitacion(),
      });
    } catch (err) {
      responderError(res, err);
    }
  },
);

// La foto de la ficha, cuando la hay. Es lo que le permite a quien atiende reconocer a quien llama,
// y sale de la ficha del Asistente, que es donde vive: el Legajo no guarda ninguna.
async function conFoto(cuenta) {
  const { data } = await supabase
    .from('asistentes')
    .select('foto_url')
    .eq('usuario_id', cuenta.id)
    .maybeSingle();

  return {
    id: cuenta.id,
    nombre: cuenta.nombre,
    email: cuenta.email,
    rol: cuenta.rol,
    telefonoCargado: Boolean(cuenta.telefono),
    telefonoVerificado: Boolean(cuenta.telefono_verificado_en),
    foto: data?.foto_url ?? null,
  };
}

/**
 * Abrir la puerta.
 *
 * Son dos cosas y van juntas: queda anotada la habilitación, y sale el enlace para elegir la clave
 * nueva, que es lo que la persona necesita para usarla. El enlace va al correo de la cuenta y a
 * ningún otro lado: quien atiende el llamado no lo ve, no lo puede copiar y no lo puede leer.
 */
panelHabilitarClaveRouter.post(
  '/',
  requiereRolPanel,
  requierePermiso(ACCION),
  topeDePedidos({ nombre: 'habilitar_cambio_de_clave' }),
  async (req, res) => {
    try {
      const { usuarioId } = req.body ?? {};
      if (!usuarioId) throw new ErrorConMotivo('faltan_datos');

      const cuenta = await habilitarCambioDeClave({ quien: req.usuarioPanel, usuarioId });

      await registrarActividad(req.usuarioPanel, ACCION_HABILITAR, {
        tablaAfectada: 'cambios_de_clave_habilitados',
        registroId: cuenta.id,
      });
      yaQuedoRegistrado(res);

      // El aviso sale igual que la puerta: al correo de esa persona. Es la única forma que tiene de
      // enterarse si nadie llamó en su nombre.
      await avisarDeSeguridad(AVISO_CAMBIO_HABILITADO, cuenta);
      await pedirRecuperacionDeClave(cuenta.email, cuenta.prestadora_id);

      res.json({ ok: true, minutos: minutosDeLaHabilitacion() });
    } catch (err) {
      responderError(res, err);
    }
  },
);

/**
 * Confirmar que el número que la cuenta tiene cargado es de esa persona.
 *
 * ES EL ATAJO PARA QUIEN CAMBIÓ DE NÚMERO y no puede esperar a que se le crea. No cambia el número:
 * cambiarlo es de su dueño, con su clave actual, desde su propia pantalla.
 */
panelHabilitarClaveRouter.post(
  '/telefono',
  requiereRolPanel,
  requierePermiso(ACCION),
  topeDePedidos({ nombre: 'habilitar_cambio_de_clave' }),
  async (req, res) => {
    try {
      const { usuarioId } = req.body ?? {};
      if (!usuarioId) throw new ErrorConMotivo('faltan_datos');

      const cuenta = await confirmarTelefonoDeLaCuenta({ quien: req.usuarioPanel, usuarioId });

      await registrarActividad(req.usuarioPanel, ACCION_CONFIRMAR_TELEFONO, {
        tablaAfectada: 'telefonos_confirmados_por_la_prestadora',
        registroId: cuenta.id,
      });
      yaQuedoRegistrado(res);

      res.json({ ok: true });
    } catch (err) {
      responderError(res, err);
    }
  },
);
