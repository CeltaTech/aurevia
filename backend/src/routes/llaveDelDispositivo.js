/**
 * Entrar con huella o con cara, y administrar las llaves del propio teléfono.
 * ==========================================================================
 *
 * Lo que decide está en `../utils/llaveDelDispositivo.js`, con sus pruebas. Acá está lo que
 * ejecuta: pedirle a la base, hablar con la librería que verifica firmas, y emitir la sesión.
 *
 * SON DOS PUERTAS DISTINTAS, Y SE MONTAN DISTINTO:
 *
 *   - `llaveDelDispositivoRouter` va sin sesión, porque quien está entrando todavía no tiene
 *     ninguna. Es la puerta de calle.
 *   - `routerDeLlavesConSesion(rol)` se monta adentro de cada aplicación, detrás del middleware de
 *     su rol: agregar una llave, ver las propias y darlas de baja son cosas de alguien que ya
 *     entró.
 *
 * NO SE PREGUNTA EL CORREO PARA ENTRAR, Y ESO ES LA DIFERENCIA. La llave se crea «detectable»
 * (`residentKey: 'required'`), así que el teléfono sabe cuál ofrecer sin que nadie le diga de
 * quién es. Preguntar el correo antes convertiría a la pantalla de ingreso en una lista de quién
 * tiene cuenta y quién no, que es justo lo que `celtatech/CLAUDE.md` §6 prohíbe.
 *
 * Y POR ESO TAMPOCO SE EXPLICA QUÉ SALIÓ MAL. La llave que no existe, la que fue revocada y la que
 * apunta a otra persona salen las tres como el mismo aviso, igual que la entrada con contraseña no
 * dice cuál de los dos campos estaba mal.
 */
import { Router } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

import { supabase } from '../db/connection.js';
import { correoDe } from '../utils/correoDeUnaPersona.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { IDENTIDAD } from '../config/identidadProducto.js';
import { topeDePedidos } from '../middleware/topeDePedidos.js';
import {
  MINUTOS_DE_VIDA_DEL_DESAFIO,
  comoSeVeLaLlave,
  desafioVencido,
  dondeViveLaApp,
  elContadorRetrocedio,
  porQueNoAbre,
  rolesConLlaveDeDispositivo,
} from '../utils/llaveDelDispositivo.js';

/** El aviso único que ve la pantalla cuando no se pudo entrar. Nunca dice por qué. */
const NO_SE_PUDO_ENTRAR = 'llave_no_sirve';

function rolValido(rol) {
  return rolesConLlaveDeDispositivo().includes(rol);
}

/** Guarda un desafío nuevo y lo devuelve. Vence solo, y se gasta al usarse. */
async function guardarDesafio(desafio, { para, rol, usuarioId = null, prestadoraId = null }) {
  const venceEn = new Date(Date.now() + MINUTOS_DE_VIDA_DEL_DESAFIO * 60 * 1000).toISOString();
  const { error } = await supabase.from('desafios_de_llave').insert({
    desafio,
    para,
    rol,
    usuario_id: usuarioId,
    prestadora_id: prestadoraId,
    vence_en: venceEn,
  });
  if (error) throw new Error(error.message);
}

/**
 * Busca el desafío, comprueba que sirva y lo marca usado en el mismo movimiento.
 *
 * El `usado_en IS NULL` va adentro del `update` y no antes: así dos pedidos que llegan juntos con
 * la misma firma no pasan los dos. El que llega segundo no encuentra nada que actualizar.
 */
async function gastarDesafio(desafio, { para, rol }) {
  const { data: fila } = await supabase
    .from('desafios_de_llave')
    .select('id, para, rol, usuario_id, prestadora_id, vence_en, usado_en')
    .eq('desafio', desafio)
    .maybeSingle();

  if (!fila) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
  if (fila.para !== para || fila.rol !== rol) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
  if (fila.usado_en) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
  if (desafioVencido(fila.vence_en)) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);

  const { data: gastado } = await supabase
    .from('desafios_de_llave')
    .update({ usado_en: new Date().toISOString() })
    .eq('id', fila.id)
    .is('usado_en', null)
    .select('id')
    .maybeSingle();
  if (!gastado) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);

  return fila;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// LA PUERTA DE CALLE: entrar sin haber entrado
// ────────────────────────────────────────────────────────────────────────────────────────────

export const llaveDelDispositivoRouter = Router();

// `topeDePedidos` no se puede montar acá: exige una identidad ya resuelta y, sin sesión, no hay
// ninguna. El freno de esta puerta es otro y es más duro: cada intento necesita un desafío que el
// motor emitió hace menos de dos minutos, que sirve una sola vez, y una firma que sólo puede
// producir una llave guardada en un aparato concreto.

/** Paso 1 de la entrada: el motor inventa el número que el teléfono va a firmar. */
llaveDelDispositivoRouter.post('/entrar/desafio', async (req, res) => {
  try {
    const { rol } = req.body ?? {};
    if (!rolValido(rol)) throw new ErrorConMotivo('faltan_datos');

    const { parteConfiable } = dondeViveLaApp(rol);
    const opciones = await generateAuthenticationOptions({
      rpID: parteConfiable,
      userVerification: 'required',
      // Vacío a propósito: el teléfono ofrece las llaves que tiene para este sitio. Si acá fuera
      // una lista, habría que preguntar el correo antes para armarla, y eso diría quién tiene
      // cuenta y quién no.
      allowCredentials: [],
    });

    await guardarDesafio(opciones.challenge, { para: 'entrada', rol });
    res.json(opciones);
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al preparar la entrada con llave:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

/**
 * Paso 2 de la entrada: llega la firma, y si cierra se emite la sesión.
 *
 * La sesión no la arma el motor a mano. Se le pide a Supabase un pase de un solo uso
 * (`generateLink`) y el navegador lo canjea con `verifyOtp`, que es el mismo camino que usa
 * cualquier enlace de entrada por correo. Así la sesión nace donde nacen todas y el motor no tiene
 * que firmar nada por su cuenta.
 */
llaveDelDispositivoRouter.post('/entrar', async (req, res) => {
  try {
    const { rol, respuesta } = req.body ?? {};
    if (!rolValido(rol) || !respuesta?.id) throw new ErrorConMotivo('faltan_datos');

    const { origen, parteConfiable } = dondeViveLaApp(rol);

    const { data: llave } = await supabase
      .from('llaves_de_dispositivo')
      .select('id, usuario_id, prestadora_id, rol, credencial_id, clave_publica, contador, transportes, revocada_en')
      .eq('credencial_id', respuesta.id)
      .eq('rol', rol)
      .maybeSingle();

    const motivo = porQueNoAbre(llave);
    if (motivo) {
      // El motivo queda del lado de adentro. Hacia afuera va siempre el mismo aviso.
      console.warn(`Entrada con llave rechazada (${motivo})`);
      throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
    }

    const desafio = leerDesafio(respuesta);
    await gastarDesafio(desafio, { para: 'entrada', rol });

    const verificacion = await verifyAuthenticationResponse({
      response: respuesta,
      expectedChallenge: desafio,
      expectedOrigin: origen,
      expectedRPID: parteConfiable,
      requireUserVerification: true,
      credential: {
        id: llave.credencial_id,
        publicKey: isoBase64URL.toBuffer(llave.clave_publica),
        counter: Number(llave.contador),
        transports: llave.transportes ?? undefined,
      },
    });
    if (!verificacion.verified) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);

    const contadorNuevo = verificacion.authenticationInfo?.newCounter ?? 0;
    if (elContadorRetrocedio(Number(llave.contador), contadorNuevo)) {
      // Dos aparatos con la misma llave. No se deja entrar, y la llave queda revocada: si es una
      // copia, deja de servir; si es la original, quien la tenga la vuelve a dar de alta con su
      // contraseña, que es una molestia mucho más chica que la alternativa.
      console.warn('Entrada con llave rechazada (contador hacia atras): llave revocada');
      await supabase
        .from('llaves_de_dispositivo')
        .update({ revocada_en: new Date().toISOString() })
        .eq('id', llave.id);
      throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
    }

    await supabase
      .from('llaves_de_dispositivo')
      .update({ contador: contadorNuevo, ultimo_uso_en: new Date().toISOString() })
      .eq('id', llave.id);

    // El rol sale de la ficha y el correo de la cuenta: son dos tablas distintas, porque
    // `usuarios` no guarda el correo (ver `correoDeUnaPersona.js`).
    const { data: persona } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', llave.usuario_id)
      .maybeSingle();
    const email = await correoDe(llave.usuario_id);
    if (!email || persona?.rol !== rol) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);

    const { data: pase, error: errorPase } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (errorPase || !pase?.properties?.hashed_token) {
      throw new Error(errorPase?.message || 'no se pudo emitir el pase de entrada');
    }

    res.json({ email, pase: pase.properties.hashed_token });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al entrar con llave:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

/** El desafío viaja adentro de lo que el navegador firmó, en base64url. */
function leerDesafio(respuesta) {
  const datos = respuesta?.response?.clientDataJSON;
  if (!datos) throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
  try {
    const { challenge } = JSON.parse(isoBase64URL.toUTF8String(datos));
    if (!challenge) throw new Error('sin desafio');
    return challenge;
  } catch {
    throw new ErrorConMotivo(NO_SE_PUDO_ENTRAR);
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// ADENTRO DE CADA APLICACIÓN: agregar, ver y sacar llaves propias
// ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * El mismo juego de rutas para las dos aplicaciones, montado dos veces con el rol de cada una.
 *
 * Se escribe una sola vez porque es la misma decisión en los dos lados
 * (`celtatech/CLAUDE.md` §8, «ningún patrón repetido sin punto único de verdad»). Lo único que
 * cambia es de qué propiedad sale la persona, porque cada middleware de rol deja la suya.
 */
export function routerDeLlavesConSesion(rol) {
  if (!rolValido(rol)) throw new Error(`El rol «${rol}» no tiene llave de dispositivo`);
  const router = Router();

  const quienEs = (req) => (rol === 'asistente' ? req.usuarioAsistente : req.usuarioFamilia);

  /** Las llaves propias que siguen vivas. Sin la credencial ni la clave, que no hacen falta. */
  router.get('/', async (req, res) => {
    try {
      const persona = quienEs(req);
      const { data, error } = await supabase
        .from('llaves_de_dispositivo')
        .select('id, creada_en, ultimo_uso_en')
        .eq('usuario_id', persona.id)
        .eq('prestadora_id', persona.prestadoraId)
        .is('revocada_en', null)
        .order('creada_en', { ascending: false });
      if (error) throw new Error(error.message);
      res.json({ llaves: (data ?? []).map(comoSeVeLaLlave) });
    } catch (err) {
      console.error('Error al listar llaves de dispositivo:', err.message);
      res.status(500).json({ error: 'error_interno' });
    }
  });

  /** Paso 1 del alta: el número que el teléfono va a firmar con la llave nueva. */
  router.post('/desafio', topeDePedidos({ nombre: 'alta_llave_dispositivo' }), async (req, res) => {
    try {
      const persona = quienEs(req);
      const { parteConfiable } = dondeViveLaApp(rol);

      const { data: perfil } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', persona.id)
        .maybeSingle();
      const correo = await correoDe(persona.id);
      if (!correo) throw new ErrorConMotivo('faltan_datos');

      const { data: yaTiene } = await supabase
        .from('llaves_de_dispositivo')
        .select('credencial_id, transportes')
        .eq('usuario_id', persona.id)
        .is('revocada_en', null);

      const opciones = await generateRegistrationOptions({
        rpName: IDENTIDAD.nombre,
        rpID: parteConfiable,
        userID: new TextEncoder().encode(persona.id),
        userName: correo,
        userDisplayName: perfil?.nombre || correo,
        attestationType: 'none',
        // Que el mismo teléfono no quede con dos llaves para la misma persona: no sumaría nada y
        // la pantalla mostraría dos renglones que nadie sabe distinguir.
        excludeCredentials: (yaTiene ?? []).map((l) => ({
          id: l.credencial_id,
          transports: l.transportes ?? undefined,
        })),
        authenticatorSelection: {
          // Detectable, para que después se pueda entrar sin escribir el correo. Y con
          // verificación del dueño, que es lo que hace que la llave se abra con huella o con cara
          // y no con sólo tener el aparato en la mano.
          residentKey: 'required',
          userVerification: 'required',
        },
      });

      await guardarDesafio(opciones.challenge, {
        para: 'alta',
        rol,
        usuarioId: persona.id,
        prestadoraId: persona.prestadoraId,
      });
      res.json(opciones);
    } catch (err) {
      if (err instanceof ErrorConMotivo) return responderError(res, err);
      console.error('Error al preparar el alta de una llave:', err.message);
      res.status(500).json({ error: 'error_interno' });
    }
  });

  /** Paso 2 del alta: llega la llave nueva y se guarda su mitad pública. */
  router.post('/', topeDePedidos({ nombre: 'alta_llave_dispositivo' }), async (req, res) => {
    try {
      const persona = quienEs(req);
      const { respuesta } = req.body ?? {};
      if (!respuesta?.id) throw new ErrorConMotivo('faltan_datos');

      const { origen, parteConfiable } = dondeViveLaApp(rol);
      const desafio = leerDesafio(respuesta);
      const fila = await gastarDesafio(desafio, { para: 'alta', rol });
      // El desafío es de quien lo pidió, y de nadie más: sin esto, alguien podría hacerse dar uno
      // y presentarlo desde otra sesión.
      if (fila.usuario_id !== persona.id) throw new ErrorConMotivo('llave_no_sirve');

      const verificacion = await verifyRegistrationResponse({
        response: respuesta,
        expectedChallenge: desafio,
        expectedOrigin: origen,
        expectedRPID: parteConfiable,
        requireUserVerification: true,
      });
      const credencial = verificacion?.registrationInfo?.credential;
      if (!verificacion.verified || !credencial) throw new ErrorConMotivo('llave_no_sirve');

      // Vuelve la fila que quedó guardada, y no la que se mandó: la pantalla la agrega a su lista
      // sin volver a pedirla entera, y lo que muestra es lo que la base escribió de verdad. Pasa
      // por el mismo filtro que la lista, así que de acá tampoco sale la credencial ni la llave.
      const { data, error } = await supabase
        .from('llaves_de_dispositivo')
        .insert({
          prestadora_id: persona.prestadoraId,
          usuario_id: persona.id,
          rol,
          credencial_id: credencial.id,
          clave_publica: isoBase64URL.fromBuffer(credencial.publicKey),
          contador: credencial.counter ?? 0,
          transportes: credencial.transports ?? null,
        })
        .select('id, creada_en, ultimo_uso_en')
        .single();
      if (error) throw new Error(error.message);

      res.status(201).json({ llave: comoSeVeLaLlave(data) });
    } catch (err) {
      if (err instanceof ErrorConMotivo) return responderError(res, err);
      console.error('Error al guardar una llave de dispositivo:', err.message);
      res.status(500).json({ error: 'error_interno' });
    }
  });

  /**
   * La baja. No borra: marca. Y filtra por la persona de la sesión, así que el identificador de
   * una llave ajena no alcanza para sacarla.
   */
  router.delete('/:id', topeDePedidos({ nombre: 'baja_llave_dispositivo' }), async (req, res) => {
    try {
      const persona = quienEs(req);
      const { data, error } = await supabase
        .from('llaves_de_dispositivo')
        .update({ revocada_en: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('usuario_id', persona.id)
        .eq('prestadora_id', persona.prestadoraId)
        .is('revocada_en', null)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new ErrorConMotivo('no_encontrado');
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ErrorConMotivo) return responderError(res, err);
      console.error('Error al dar de baja una llave de dispositivo:', err.message);
      res.status(500).json({ error: 'error_interno' });
    }
  });

  return router;
}
