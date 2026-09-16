// A dónde van a parar las respuestas.
//
// Cada Prestadora manda sus avisos desde una dirección suya bajo el dominio del producto
// (`utils/casillaDeEnvio.js`). Esa dirección **sólo manda**: no hay ninguna casilla detrás, así
// que quien le conteste a un aviso le estaría escribiendo a un buzón que no existe. Para que esa
// respuesta llegue, el correo que entra a esa dirección se reenvía a la casilla que la Prestadora
// declaró como suya (`docs/MARCA.md`, sección 0).
//
// El reenvío lo hace Cloudflare Email Routing sobre el mismo dominio, y no cuesta nada: es parte
// del dominio que ya está ahí. No es el mismo servicio que despacha los envíos —eso es el
// despachante de `utils/email.js`—, y no se mezclan: uno saca correo, el otro lo hace entrar.
//
// Cloudflare no reenvía a una dirección hasta que su dueño la confirma con un clic en un correo
// que le llega. Es del lado de ellos y no se puede saltear: mientras no esté confirmada, las
// respuestas no llegan. Por eso ese estado se consulta y se muestra, en vez de darlo por hecho.
//
// Todo esto es opcional: sin las tres variables cargadas, el motor no intenta nada y la
// Prestadora se da de alta igual. Lo que pasa entonces es que las respuestas se pierden, y eso
// se avisa en el Panel.

import { supabase } from '../db/connection.js';

// La dirección del servicio. Se puede apuntar a otro servidor para probar, igual que la de
// geocodificación: vacía significa la de verdad.
function api() {
  return process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
}

function credencial() {
  return process.env.CLOUDFLARE_EMAIL_ROUTING_TOKEN || null;
}

function cuenta() {
  return process.env.CLOUDFLARE_ACCOUNT_ID || null;
}

function zona() {
  return process.env.CLOUDFLARE_ZONE_ID || null;
}

export function hayReenvioConfigurado() {
  return Boolean(credencial() && cuenta() && zona());
}

// Del error sale el número y nada más. El cuerpo de la respuesta de Cloudflare repite lo que se
// mandó —las dos direcciones—, y eso no va a ningún registro (`celtatech/CLAUDE.md` §6).
async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${api()}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${credencial()}`,
      'Content-Type': 'application/json',
      ...opciones.headers,
    },
  });

  if (!respuesta.ok) {
    throw new Error(`Cloudflare rechazó el pedido de reenvío (${respuesta.status})`);
  }

  const cuerpo = await respuesta.json();
  return cuerpo?.result ?? null;
}

// Da de alta la casilla de destino. Cloudflare le manda ahí el correo de confirmación, y ése es
// el único momento en que sale: si la dirección ya estaba dada de alta, contesta que ya existe y
// no vuelve a mandar nada. Ese caso no es una falla —es el de una persona que administra dos
// Prestadoras con el mismo correo—, así que se sigue de largo.
async function anotarDestino(emailRespuestas) {
  try {
    await pedir(`/accounts/${cuenta()}/email/routing/addresses`, {
      method: 'POST',
      body: JSON.stringify({ email: emailRespuestas }),
    });
  } catch (error) {
    console.error('La casilla de respuestas no se pudo anotar como destino:', error.message);
  }
}

// ¿El dueño de esa casilla ya confirmó que quiere recibir ahí? Se pregunta en el momento en vez
// de guardarse: el clic lo da una persona cuando quiere, así que un valor guardado en el alta
// diría «sin confirmar» para siempre.
export async function respuestasConfirmadas(emailRespuestas) {
  if (!hayReenvioConfigurado() || !emailRespuestas) return false;

  try {
    const destinos = await pedir(`/accounts/${cuenta()}/email/routing/addresses?per_page=50`);
    const buscada = String(emailRespuestas).trim().toLowerCase();
    const destino = (destinos ?? []).find((d) => String(d.email).toLowerCase() === buscada);
    return Boolean(destino?.verified);
  } catch (error) {
    console.error('No se pudo consultar si la casilla de respuestas está confirmada:', error.message);
    return false;
  }
}

// Abre el reenvío de una Prestadora: lo que entre a su dirección de envío sale hacia la casilla
// que declaró. Devuelve el identificador que Cloudflare le da a esa regla, que es con lo que
// después se la corta, o `null` si no se pudo abrir.
//
// Que no se pueda abrir no detiene el alta: la Prestadora entra, manda sus avisos, y lo único
// que falta es que las respuestas vuelvan. Eso se avisa en el Panel, nunca por correo, porque
// lo que falló es justamente el correo.
export async function abrirReenvioDeRespuestas({ direccionDeEnvio, emailRespuestas }) {
  if (!hayReenvioConfigurado() || !direccionDeEnvio || !emailRespuestas) return null;
  try {
    await anotarDestino(emailRespuestas);

    const regla = await pedir(`/zones/${zona()}/email/routing/rules`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Respuestas de ${direccionDeEnvio}`,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: direccionDeEnvio }],
        actions: [{ type: 'forward', value: [emailRespuestas] }],
      }),
    });

    return regla?.tag ?? null;
  } catch (error) {
    console.error('No se pudo abrir el reenvío de las respuestas:', error.message);
    return null;
  }
}

// Deja el reenvío de una Prestadora apuntando a la casilla que declaró, y lo anota en su fila,
// que es con lo que después se lo corta. Pasa en dos momentos —cuando se la da de alta, y cuando
// cambia su casilla desde el Panel— y por eso está escrito una sola vez.
//
// Cambiar de casilla no es agregar una: el reenvío anterior sigue mandando a la vieja si nadie
// lo corta, así que primero se corta y después se abre el nuevo.
//
// Nunca falla hacia afuera. Devuelve el identificador de la regla nueva, o `null` si no se pudo
// abrir; con `null` la Prestadora manda igual y lo único que se pierde son las respuestas, cosa
// que se avisa en el Panel.
export async function apuntarReenvioDeRespuestas({
  prestadoraId,
  direccionDeEnvio,
  emailRespuestas,
  reglaAnterior = null,
}) {
  if (reglaAnterior) await cortarReenvioDeRespuestas(reglaAnterior);

  const regla = await abrirReenvioDeRespuestas({ direccionDeEnvio, emailRespuestas });

  // Sin regla nueva y sin regla vieja no hay nada que anotar: escribir `null` sobre `null` sería
  // un pedido a la base que no cambia nada.
  if (prestadoraId && (regla || reglaAnterior)) {
    const { error } = await supabase
      .from('prestadoras')
      .update({ regla_reenvio: regla ?? null })
      .eq('id', prestadoraId);

    // El reenvío quedó como tenía que quedar y el motor no sabe con qué cortarlo. Se avisa acá y
    // no se deshace nada: las respuestas están llegando, que es lo que la Prestadora necesita.
    if (error) console.error('Quedó un reenvío sin anotar en la Prestadora:', error.message);
  }

  return regla;
}

// Corta el reenvío. Se llama cuando la Prestadora se va, y también cuando un alta se deshace a
// mitad de camino: la regla ya quedó creada del lado de Cloudflare y ahí no se borra sola.
//
// Nunca falla hacia afuera. Una regla que quedó abierta manda correo a una casilla que ya no
// espera nada; frenar por eso la baja de una Prestadora sería peor.
export async function cortarReenvioDeRespuestas(regla) {
  if (!hayReenvioConfigurado() || !regla) return false;

  try {
    await pedir(`/zones/${zona()}/email/routing/rules/${regla}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    console.error('Quedó abierto un reenvío de respuestas que había que cortar:', error.message);
    return false;
  }
}
