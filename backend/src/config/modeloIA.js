// Punto único de verdad del modelo de IA que usa el motor
// ============================================================================
//
// La regla de la empresa lo pide con estas palabras: «El nombre del modelo de IA vive en un solo
// lugar, sobreescribible por variable de entorno. Nunca escrito a mano en cada archivo que lo
// usa» (`celtatech/CLAUDE.md` §8). Todo lo que habla con el modelo —`alertasIA.js`,
// `iaWhatsapp.js`, `importacionIA.js` y `reporteIA.js`— lo toma de acá y no lo escribe a mano:
// escrito en cada uno, cambiarlo sería acordarse de cuatro archivos, y olvidarse de uno dejaría a
// una parte del motor hablando con otro modelo sin que nada avisara.
//
// ----------------------------------------------------------------------------
// Por qué se puede cambiar desde afuera
// ----------------------------------------------------------------------------
//
// Un modelo nuevo sale y hay que probarlo antes de dejarlo puesto. Con la variable de entorno se
// lo prueba en un ambiente sin tocar el código ni publicar una versión, y se vuelve atrás sacando
// la variable. Sin ella, cada prueba sería un despliegue.
//
// Lo que la variable **no** hace es elegir proveedor: el motor habla con Anthropic y sólo con
// Anthropic (`@anthropic-ai/sdk`). Poner acá el nombre de un modelo de otra empresa no lo cambia,
// lo rompe.
//
// ----------------------------------------------------------------------------
// Lo que hay que mirar al cambiarlo
// ----------------------------------------------------------------------------
//
// El consumo de cada llamada queda medido en tokens, con el nombre del modelo al lado
// (`utils/registrarUsoIA.js`). Al cambiar de modelo no hay nada que configurar: el medidor anota
// igual, y el nombre nuevo aparece en el conteo desde la primera llamada.

/** El nombre del modelo escrito en el código. Es el que se usa si nadie pone la variable. */
const MODELO_POR_DEFECTO = 'claude-sonnet-5';

/**
 * El modelo con el que habla el motor.
 *
 * Se sobreescribe con la variable de entorno `MODELO_IA`. Una variable vacía o con espacios se
 * trata como si no estuviera: es el caso corriente de un archivo de entorno con el renglón puesto
 * y sin completar, y dejar que eso mande le pediría a Anthropic un modelo sin nombre.
 */
export const MODELO_IA = (process.env.MODELO_IA ?? '').trim() || MODELO_POR_DEFECTO;
