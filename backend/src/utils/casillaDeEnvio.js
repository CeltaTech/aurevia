import { supabase } from '../db/connection.js';
import { direccionRemitente } from './email.js';

// La dirección desde la que manda cada Prestadora.
//
// Cada Prestadora manda sus avisos desde una dirección suya bajo el dominio del producto
// —`cuidadosdellitoral@careonys.com`—, que sólo manda: las respuestas se reenvían a la casilla
// que ella declaró (`docs/MARCA.md`, sección 0). Acá se decide cómo se llama esa casilla.
//
// Se elige una sola vez, al darla de alta, y no cambia nunca: es la dirección que va a quedar
// guardada en el buzón de cada Familia y de cada Asistente que alguna vez recibió un correo.
//
// De dónde sale el nombre, en este orden:
//
// 1. Del dominio propio que declaró. Si la casilla de respuestas es
//    `contacto@cuidadosdellitoral.com.ar`, la Prestadora ya tiene un nombre elegido por ella
//    misma y no hace falta inventar ninguno: `cuidadosdellitoral`.
// 2. De su nombre de fantasía, si lo que declaró es una casilla gratuita. Un `gmail.com` no
//    nombra a nadie: daría la misma dirección para todas.
// 3. Del nombre con un sufijo, si el que salió ya está tomado. Dos Prestadoras no se llaman
//    igual, pero dos nombres distintos pueden dar la misma casilla —«Cuidar del Sur» y «Cuidar
//    del sur.» dan las dos `cuidar-del-sur`—, y la casilla del alta anterior no se toca.

// Quita los acentos y deja sólo lo que puede vivir a la izquierda de una arroba sin traer
// problemas: letras sin marca, números y guiones. No intenta abarcar todo lo que la norma
// permite; apunta a una dirección que alguien pueda dictar por teléfono.
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function dominioDe(email) {
  const partes = String(email ?? '').trim().toLowerCase().split('@');
  return partes.length === 2 ? partes[1] : null;
}

// La parte izquierda de la dirección común del producto. La casilla de una Prestadora no puede
// ser esa misma, porque entonces dos remitentes distintos serían la misma dirección. Se compara
// contra lo que está configurado y no contra una lista escrita acá.
function casillaDeLaDireccionComun() {
  const [local] = String(direccionRemitente() ?? '').split('@');
  return normalizar(local);
}

async function esDominioGratuito(dominio) {
  if (!dominio) return true;
  const { data, error } = await supabase
    .from('dominios_de_correo_gratuitos')
    .select('dominio')
    .eq('dominio', dominio)
    .maybeSingle();

  // Sin respuesta del catálogo no se adivina: se toma como gratuito, que es el camino que arma
  // el nombre con el nombre de fantasía. Es el que siempre da un nombre propio de esa
  // Prestadora; el otro podría darle la casilla de un dominio que no es suyo.
  if (error) {
    console.error('No se pudo consultar el catálogo de dominios de correo gratuitos:', error.message);
    return true;
  }
  return Boolean(data);
}

// El nombre que le corresponde a esta Prestadora, todavía sin comprobar si está libre.
async function nombreBase({ nombreFantasia, emailRespuestas }) {
  const dominio = dominioDe(emailRespuestas);
  if (dominio && !(await esDominioGratuito(dominio))) {
    // El primer rótulo del dominio: de `cuidadosdellitoral.com.ar` sale `cuidadosdellitoral`.
    // `www` no nombra a nadie, así que si aparece se saltea.
    const rotulos = dominio.split('.').filter((r) => r !== 'www');
    const desdeElDominio = normalizar(rotulos[0]);
    if (desdeElDominio) return desdeElDominio;
  }
  return normalizar(nombreFantasia);
}

// Las casillas ya tomadas que empiezan igual. Se consultan todas juntas y no de a una para no
// hacerle una pregunta a la base por cada intento.
async function casillasTomadas(base) {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('casilla_envio')
    .ilike('casilla_envio', `${base}%`);

  if (error) throw error;
  return new Set((data ?? []).map((fila) => String(fila.casilla_envio).toLowerCase()));
}

// Devuelve el nombre de la casilla, o `null` si no se pudo elegir ninguno. `null` no es una
// falla del alta: esa Prestadora manda desde la dirección común del producto hasta que se le
// asigne una, y eso se avisa en el Panel.
//
// La dirección entera —el nombre con el dominio— la arma `utils/email.js`, que es donde vive el
// dominio del producto. Acá sólo se elige cómo se llama.
export async function elegirCasillaDeEnvio({ nombreFantasia, emailRespuestas }) {
  const base = await nombreBase({ nombreFantasia, emailRespuestas });
  if (!base) return null;

  const tomadas = await casillasTomadas(base);
  tomadas.add(casillaDeLaDireccionComun());

  if (!tomadas.has(base)) return base;

  for (let sufijo = 2; sufijo <= 99; sufijo += 1) {
    const candidata = `${base}-${sufijo}`;
    if (!tomadas.has(candidata)) return candidata;
  }

  return null;
}
