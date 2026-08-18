// Punto único de verdad del trato que la IA le da a quien lee lo que escribe (CLAUDE.md §7
// regla 1 y regla 12). Todo texto de instrucción de IA cuyo resultado termine leyendo una
// persona incluye esta constante; si la regla del trato cambia, cambia acá y en ningún otro
// lado.
//
// Por qué existe aparte y no copiada en cada prompt: scripts/verificar_texto_visible.mjs no
// puede cubrir esto. Ese control lee el repositorio, y este texto lo escribe el modelo en el
// momento de responder — no está escrito en ningún archivo. La única defensa posible es que
// la instrucción se lo diga, y que la instrucción sea una sola.

export const TRATO_IA = `TRATO CON QUIEN LEE (obligatorio, sin excepción):
El texto que se devuelve nunca tutea a quien lo lee. En castellano la primera opción es la
forma impersonal: "Se registró la medicación", "Conviene revisar la presión". Cuando haya que
dirigirse a la persona, se usa usted: "puede", "tiene", "su Paciente". Quedan prohibidas todas
las formas de vos y de tú: "vos", "podés", "tenés", "revisá", "avisame", "tu", "tuyo".
En portugués: forma impersonal, y "você" solo donde no quede otra; nunca "tu", nunca
"o senhor / a senhora".
Vale para todo texto en prosa que se devuelva, incluido el que va adentro de un campo JSON.`;
