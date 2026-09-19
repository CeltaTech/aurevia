import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { topeDePedidos } from '../middleware/topeDePedidos.js';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { exigirLaClaveActual } from '../utils/claveActual.js';
import {
  mandarCodigoAlTelefono,
  comprobarCodigoDelTelefono,
  hayViaDeTelefono,
  telefonoAceptable,
  normalizarTelefono,
  USO_VERIFICAR,
  USO_EQUIPO_NUEVO,
} from '../utils/codigoAlTelefono.js';
import {
  equipoConocido,
  anotarEquipo,
  equiposDe,
  cerrarSesionEnTodosLosEquipos,
} from '../utils/equiposConocidos.js';
import {
  avisarDeSeguridad,
  AVISO_TELEFONO_CAMBIADO,
  AVISO_EQUIPO_NUEVO,
} from '../utils/avisoDeSeguridad.js';
import {
  registrarActividad,
  yaQuedoRegistrado,
  ACCION_VERIFICACION_DE_TELEFONO,
} from '../utils/registroDeActividad.js';

// LA SEGURIDAD DE LA PROPIA CUENTA: el teléfono, los equipos y la salida de golpe.
//
// ESTO NO APARECE EN LA CONFIGURACIÓN DE LA PRESTADORA, y no es un olvido. Cómo se entra y cómo se
// recupera la clave es igual para todas y para todos los roles: acá no hay ninguna puerta para
// encenderlo ni apagarlo, y no se agrega.
//
// A NADIE SE LE SACA NADA. Los números ya cargados están sin verificar, y así se quedan hasta que
// su dueño los verifique. Mientras tanto esa persona entra y recupera la clave por correo como
// siempre, y las vías del teléfono no se le ofrecen.
//
// NI EL NÚMERO NI EL CÓDIGO VIAJAN POR LA DIRECCIÓN WEB. Todo va en el cuerpo del pedido, incluso
// lo que sería más cómodo poner en la dirección: una dirección queda escrita en el registro del
// servidor, en el historial del navegador y en cualquier intermediario del camino
// (`docs/REGLAS_PRODUCTOS_CAREONYS.md` §4). Por eso `GET` no recibe nada.

export const panelCuentaSeguraRouter = Router();

const ACCION_CAMBIO_DE_TELEFONO = 'cambio_de_telefono';
const ACCION_EQUIPO_NUEVO = 'entrada_desde_un_equipo_nuevo';
const ACCION_CERRAR_TODO = 'cierre_de_sesion_de_todos_los_equipos';

async function miCuenta(usuarioPanel) {
  const { data } = await supabase
    .from('usuarios')
    .select('id, rol, nombre, email, telefono, telefono_verificado_en, prestadora_id')
    .eq('id', usuarioPanel.id)
    .maybeSingle();
  return data ?? null;
}

// Cómo está la cuenta. No devuelve el número: la pantalla no lo necesita para nada de lo que
// ofrece, y un número que no viaja es un número que no se filtra.
panelCuentaSeguraRouter.get('/', requiereRolPanel, async (req, res) => {
  try {
    const cuenta = await miCuenta(req.usuarioPanel);
    if (!cuenta) throw new ErrorConMotivo('no_encontrado');

    res.json({
      telefonoCargado: Boolean(cuenta.telefono),
      telefonoVerificado: Boolean(cuenta.telefono_verificado_en),
      viaDeTelefono: await hayViaDeTelefono(cuenta.prestadora_id),
      equipos: (await equiposDe(cuenta.id)).map((equipo) => ({
        id: equipo.id,
        desde: equipo.primera_entrada_en,
        ultima: equipo.ultima_entrada_en,
      })),
    });
  } catch (err) {
    responderError(res, err);
  }
});

// Pedir el código para verificar el número que la cuenta ya tiene cargado.
//
// EL CÓDIGO SALE POR LA MISMA VÍA QUE SE ESTÁ VERIFICANDO. Mandarlo a otro lado probaría que esa
// persona lee el otro lado, no que este número es suyo.
panelCuentaSeguraRouter.post(
  '/telefono/codigo',
  requiereRolPanel,
  topeDePedidos({ nombre: 'codigo_al_telefono' }),
  async (req, res) => {
    try {
      const cuenta = await miCuenta(req.usuarioPanel);
      if (!cuenta) throw new ErrorConMotivo('no_encontrado');
      if (!cuenta.telefono) throw new ErrorConMotivo('telefono_invalido');

      const { vence } = await mandarCodigoAlTelefono({ usuario: cuenta, uso: USO_VERIFICAR });
      res.json({ ok: true, vence });
    } catch (err) {
      responderError(res, err);
    }
  },
);

// Escribir el código. Acá el número pasa de ser un dato tecleado a ser una llave.
panelCuentaSeguraRouter.post(
  '/telefono/confirmar',
  requiereRolPanel,
  topeDePedidos({ nombre: 'codigo_al_telefono' }),
  async (req, res) => {
    try {
      const { codigo } = req.body ?? {};
      if (!codigo) throw new ErrorConMotivo('faltan_datos');

      const cuenta = await miCuenta(req.usuarioPanel);
      if (!cuenta) throw new ErrorConMotivo('no_encontrado');

      const usado = await comprobarCodigoDelTelefono({
        usuarioId: cuenta.id,
        uso: USO_VERIFICAR,
        codigo,
      });

      // Se marca verificado sólo si el número sigue siendo el mismo al que se le mandó el código.
      // Entre el pedido y la respuesta el número pudo haber cambiado, y marcar entonces daría por
      // verificado un número que nadie comprobó.
      if (normalizarTelefono(usado.telefono) !== normalizarTelefono(cuenta.telefono)) {
        throw new ErrorConMotivo('codigo_incorrecto');
      }

      const { error } = await supabase
        .from('usuarios')
        .update({ telefono_verificado_en: new Date().toISOString() })
        .eq('id', cuenta.id);
      if (error) throw new Error(error.message);

      await registrarActividad(req.usuarioPanel, ACCION_VERIFICACION_DE_TELEFONO, {
        tablaAfectada: 'usuarios',
        registroId: cuenta.id,
        detalle: { via: 'whatsapp' },
      });
      yaQuedoRegistrado(res);

      res.json({ ok: true });
    } catch (err) {
      responderError(res, err);
    }
  },
);

// Cambiar el número.
//
// LAS TRES COSAS VAN JUNTAS Y NINGUNA SIRVE SOLA: hace falta la clave actual, el número nuevo nace
// sin verificar, y el código se manda al número nuevo, que es el que se está verificando. Sin la
// primera, quien se sienta en una máquina abierta se queda con la cuenta; sin la segunda, el número
// nuevo heredaría la confianza del viejo; sin la tercera, verificar no probaría nada.
panelCuentaSeguraRouter.post(
  '/telefono/cambiar',
  requiereRolPanel,
  topeDePedidos({ nombre: 'codigo_al_telefono' }),
  async (req, res) => {
    try {
      const { claveActual, telefono } = req.body ?? {};
      if (!claveActual || !telefono) throw new ErrorConMotivo('faltan_datos');
      if (!telefonoAceptable(telefono)) throw new ErrorConMotivo('telefono_invalido');

      const cuenta = await miCuenta(req.usuarioPanel);
      if (!cuenta) throw new ErrorConMotivo('no_encontrado');

      await exigirLaClaveActual({ email: cuenta.email, clave: claveActual });

      const numero = normalizarTelefono(telefono);
      // `telefono_verificado_en` se pone en nulo acá **y** lo pone en nulo un disparador de la base.
      // No es una copia por descuido: el motor escribe con la llave maestra, y la red de abajo es la
      // que sigue estando el día que otro camino toque esta columna sin acordarse.
      const { error } = await supabase
        .from('usuarios')
        .update({ telefono: numero, telefono_verificado_en: null })
        .eq('id', cuenta.id);
      if (error) throw new Error(error.message);

      await registrarActividad(req.usuarioPanel, ACCION_CAMBIO_DE_TELEFONO, {
        tablaAfectada: 'usuarios',
        registroId: cuenta.id,
        camposCambiados: ['telefono'],
      });
      yaQuedoRegistrado(res);

      // El aviso va al correo y no al teléfono: si el número cambió porque alguien se lo llevó,
      // avisar por el teléfono sería avisarle justamente a esa persona.
      await avisarDeSeguridad(AVISO_TELEFONO_CAMBIADO, cuenta);

      // Y el código sale para el número nuevo. Que no salga no deshace el cambio: el número quedó
      // cargado y sin verificar, que es un estado perfectamente válido.
      let vence = null;
      try {
        ({ vence } = await mandarCodigoAlTelefono({
          usuario: { ...cuenta, telefono: numero },
          uso: USO_VERIFICAR,
        }));
      } catch (e) {
        console.warn('panelCuentaSegura: el número cambió pero el código no salió:', e.message);
      }

      res.json({ ok: true, vence });
    } catch (err) {
      responderError(res, err);
    }
  },
);

// ¿Desde este aparato se entró antes?
//
// LA MARCA VA EN EL CUERPO Y NO EN LA DIRECCIÓN, y no es una credencial: sola no deja entrar a
// nadie. Se mira **después** de que la sesión ya está hecha, y lo único que decide es si hace falta
// pedir el segundo factor.
panelCuentaSeguraRouter.post('/equipo/reconocer', requiereRolPanel, async (req, res) => {
  try {
    const { marca } = req.body ?? {};
    const cuenta = await miCuenta(req.usuarioPanel);
    if (!cuenta) throw new ErrorConMotivo('no_encontrado');

    if (await equipoConocido({ usuarioId: cuenta.id, marca })) {
      await anotarEquipo({ usuario: cuenta, marca });
      return res.json({ equipoNuevo: false, requiereCodigo: false, marca });
    }

    // Equipo nuevo. Si esta persona tiene el número verificado y su Prestadora tiene por dónde
    // mandar, se le pide el código. Si no, entra igual y se le avisa por correo: a nadie se le saca
    // nada, y el aviso es lo que le permite darse cuenta si no fue ella.
    const puedePedirse = Boolean(cuenta.telefono_verificado_en)
      && await hayViaDeTelefono(cuenta.prestadora_id);

    if (!puedePedirse) {
      const marcaNueva = await anotarEquipo({ usuario: cuenta, marca: null });
      await avisarDeSeguridad(AVISO_EQUIPO_NUEVO, cuenta);
      await registrarActividad(req.usuarioPanel, ACCION_EQUIPO_NUEVO, {
        tablaAfectada: 'equipos_conocidos',
      });
      yaQuedoRegistrado(res);
      return res.json({ equipoNuevo: true, requiereCodigo: false, marca: marcaNueva });
    }

    const { vence } = await mandarCodigoAlTelefono({ usuario: cuenta, uso: USO_EQUIPO_NUEVO });
    return res.json({ equipoNuevo: true, requiereCodigo: true, vence });
  } catch (err) {
    responderError(res, err);
  }
});

// El código del equipo nuevo. Recién acá el aparato queda anotado.
panelCuentaSeguraRouter.post(
  '/equipo/confirmar',
  requiereRolPanel,
  topeDePedidos({ nombre: 'codigo_al_telefono' }),
  async (req, res) => {
    try {
      const { codigo } = req.body ?? {};
      if (!codigo) throw new ErrorConMotivo('faltan_datos');

      const cuenta = await miCuenta(req.usuarioPanel);
      if (!cuenta) throw new ErrorConMotivo('no_encontrado');

      await comprobarCodigoDelTelefono({ usuarioId: cuenta.id, uso: USO_EQUIPO_NUEVO, codigo });

      const marca = await anotarEquipo({ usuario: cuenta, marca: null });
      await avisarDeSeguridad(AVISO_EQUIPO_NUEVO, cuenta);
      await registrarActividad(req.usuarioPanel, ACCION_EQUIPO_NUEVO, {
        tablaAfectada: 'equipos_conocidos',
        detalle: { via: 'whatsapp' },
      });
      yaQuedoRegistrado(res);

      res.json({ ok: true, marca });
    } catch (err) {
      responderError(res, err);
    }
  },
);

// Cerrar la sesión en todos los equipos.
//
// ES LO PRIMERO QUE NECESITA ALGUIEN A QUIEN LE ROBARON EL TELÉFONO, y hasta acá no existía:
// cambiar la clave no cerraba las sesiones que ya estaban abiertas. Se hace desde otro equipo y con
// la clave, que son las dos condiciones que quien tiene el aparato robado no cumple.
panelCuentaSeguraRouter.post('/cerrar-sesiones', requiereRolPanel, async (req, res) => {
  try {
    const { claveActual } = req.body ?? {};
    if (!claveActual) throw new ErrorConMotivo('faltan_datos');

    const cuenta = await miCuenta(req.usuarioPanel);
    if (!cuenta) throw new ErrorConMotivo('no_encontrado');

    await exigirLaClaveActual({ email: cuenta.email, clave: claveActual });

    // El renglón se escribe antes de cerrar: después de cerrar, la sesión con la que se está
    // escribiendo ya no vale.
    await registrarActividad(req.usuarioPanel, ACCION_CERRAR_TODO, {
      tablaAfectada: 'equipos_conocidos',
      registroId: cuenta.id,
    });
    yaQuedoRegistrado(res);

    await cerrarSesionEnTodosLosEquipos(cuenta.id);

    res.json({ ok: true });
  } catch (err) {
    responderError(res, err);
  }
});
