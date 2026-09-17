// ---------------------------------------------------------------------------
// copias_entre_apps.mjs — la lista de archivos que existen más de una vez
//
// Este archivo no hace nada solo: es la lista que usan los otros dos.
//   - scripts/sincronizar_copias.mjs  copia el original encima de las copias.
//   - scripts/verificar_identidad.mjs falla el build si alguna se despegó.
//
// POR QUÉ HAY COPIAS Y NO UN IMPORT COMPARTIDO
// Cada carpeta de acá se despliega por su cuenta y sin ver el resto del repo:
// `railway up` sube solo backend/, y cada frontend se sube a Cloudflare Pages
// desde su propia carpeta. Un archivo compartido arriba de todas no viajaría.
// La regla 12 de CLAUDE.md pide un solo punto de verdad; cuando la plataforma
// no lo permite, el punto de verdad es el original y las copias se mantienen
// honestas por máquina, nunca a mano.
//
// CÓMO SE AGREGA UN GRUPO NUEVO
// Se escribe acá abajo y listo: los dos scripts lo toman solos.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export const GRUPOS = [
  {
    que: 'la identidad del producto',
    original: 'backend/src/config/identidadProducto.js',
    copias: [
      'panel/src/config/identidadProducto.js',
      'pwa-asistentes/src/config/identidadProducto.js',
      'pwa-familias/src/config/identidadProducto.js',
      'sitio-web/src/config/identidadProducto.js',
    ],
  },
  {
    que: 'de qué avisa el canal en vivo',
    original: 'backend/src/avisosEnVivo/asuntos.js',
    copias: ['panel/src/lib/asuntosEnVivo.js'],
  },
  {
    que: 'la llave que guarda el teléfono, del lado del navegador',
    original: 'pwa-asistentes/src/lib/llaveDelDispositivo.js',
    copias: ['pwa-familias/src/lib/llaveDelDispositivo.js'],
  },
  {
    que: 'la pantalla de las llaves guardadas en los aparatos',
    original: 'pwa-asistentes/src/components/LlavesDeEsteAparato.jsx',
    copias: ['pwa-familias/src/components/LlavesDeEsteAparato.jsx'],
  },
  {
    que: 'el traductor de mensajes de error',
    original: 'panel/src/lib/errores.js',
    copias: ['pwa-asistentes/src/lib/errores.js', 'pwa-familias/src/lib/errores.js'],
  },
  {
    que: 'la regla de cuándo algo está por vencer',
    original: 'panel/src/lib/reglaVencimientos.js',
    copias: ['pwa-asistentes/src/lib/reglaVencimientos.js', 'backend/src/utils/reglaVencimientos.js'],
  },
  {
    que: 'cuánto pesa cada cosa al ordenar candidatos, y las tres formas armadas',
    original: 'panel/src/lib/perfilesDeCandidatos.js',
    copias: ['backend/src/utils/perfilesDeCandidatos.js'],
  },
  {
    que: 'en qué modalidad de trabajo está cada Asistente',
    original: 'panel/src/lib/modalidades.js',
    copias: ['backend/src/utils/modalidades.js'],
  },
  {
    que: 'quién tiene que entrar con segundo factor',
    original: 'panel/src/lib/reglaMfaObligatorio.js',
    copias: ['backend/src/utils/reglaMfaObligatorio.js'],
  },
  {
    que: 'qué escala legal estaba vigente a la fecha del hecho',
    original: 'panel/src/lib/escalasLegales.js',
    copias: ['backend/src/utils/escalasLegales.js'],
  },
  {
    que: 'el domicilio en un renglón, armado a partir de sus partes',
    original: 'backend/src/utils/domicilioEscrito.js',
    copias: ['panel/src/lib/domicilioEscrito.js'],
  },
  {
    que: 'con qué se mide el trabajo de cada Asistente, y qué es una hora extra',
    original: 'panel/src/lib/formaDePago.js',
    copias: ['backend/src/utils/formaDePago.js'],
  },
  {
    que: 'cada cuánto cobra cada Asistente, y desde qué día hasta qué día va su período',
    original: 'panel/src/lib/frecuenciaDePago.js',
    copias: ['backend/src/utils/frecuenciaDePago.js'],
  },
  {
    que: 'a qué plazo paga cada Familia, y qué se corrige de una factura ya emitida',
    original: 'panel/src/lib/facturacionDeFamilias.js',
    copias: ['backend/src/utils/facturacionDeFamilias.js'],
  },
  {
    que: 'qué datos salen hacia el software de facturación y cuáles vuelven de él',
    original: 'panel/src/lib/intercambioDeFacturacion.js',
    copias: ['backend/src/utils/intercambioDeFacturacion.js'],
  },
  {
    que: 'cuánto se le paga a un Asistente por un mes',
    original: 'panel/src/lib/calcularLiquidacion.js',
    copias: ['backend/src/utils/calcularLiquidacion.js'],
  },
  {
    que: 'en qué orden sube una alarma que no se resuelve, y a qué escalones ya llegó',
    original: 'panel/src/lib/ordenDeLaEscalada.js',
    copias: ['backend/src/utils/ordenDeLaEscalada.js'],
  },
  {
    que: 'la marca de la Prestadora y qué funciones tiene encendidas',
    original: 'pwa-familias/src/context/PerfilContext.jsx',
    copias: ['pwa-asistentes/src/context/PerfilContext.jsx'],
  },
  {
    que: 'cómo se muestra el tipo de un Asistente',
    original: 'panel/src/lib/tipoDeAsistente.js',
    copias: ['pwa-asistentes/src/lib/tipoDeAsistente.js', 'pwa-familias/src/lib/tipoDeAsistente.js'],
  },
  {
    que: 'las cuentas de fecha y hora de una guardia',
    original: 'panel/src/lib/horarios.js',
    copias: [
      'pwa-familias/src/lib/horarios.js',
      'pwa-asistentes/src/lib/horarios.js',
      'backend/src/utils/horarios.js',
    ],
  },
  {
    que: 'quiénes son el equipo de un Paciente',
    original: 'panel/src/lib/equipoDelPaciente.js',
    copias: ['backend/src/utils/equipoDelPaciente.js'],
  },
  {
    que: 'si el Asistente está de licencia el día de una guardia',
    original: 'panel/src/lib/ausenciaQueTapa.js',
    copias: ['backend/src/utils/ausenciaQueTapa.js'],
  },
  {
    que: 'si una ausencia llegó con tiempo o de golpe',
    original: 'panel/src/lib/avisoDeAusencia.js',
    copias: ['backend/src/utils/avisoDeAusencia.js'],
  },
  {
    que: 'cuándo un turno vacío se vuelve un incidente grave y cómo puede cerrarse',
    original: 'panel/src/lib/incidenteTurnoSinCubrir.js',
    copias: ['backend/src/utils/incidenteTurnoSinCubrir.js'],
  },
  {
    que: 'qué se registra cuando no va nadie: el consentimiento de la Familia y el familiar que se quedó',
    original: 'panel/src/lib/pacienteSolo.js',
    copias: ['backend/src/utils/pacienteSolo.js'],
  },
  {
    que: 'qué significa que alguien se haga cargo de una alarma y cuánto dura esa toma',
    original: 'panel/src/lib/alarmasTomadas.js',
    copias: ['backend/src/utils/alarmasTomadas.js'],
  },
  {
    que: 'cómo se llama y dónde se guarda cada documento generado del legajo',
    original: 'panel/src/lib/documentosDeCese.js',
    copias: ['backend/src/utils/documentosDeCese.js'],
  },
  {
    que: 'qué fotos verifican la identidad de un Asistente y dónde se guardan',
    original: 'panel/src/lib/fotosDeIdentidad.js',
    copias: ['backend/src/utils/fotosDeIdentidad.js'],
  },
  {
    que: 'los resultados de una referencia laboral y cuándo alcanzan las verificadas',
    original: 'panel/src/lib/referenciasLaborales.js',
    copias: ['backend/src/utils/referenciasLaborales.js'],
  },
  {
    que: 'cuándo una guardia quedó sin cerrar',
    original: 'panel/src/lib/guardiaSinCerrar.js',
    copias: ['pwa-asistentes/src/lib/guardiaSinCerrar.js'],
  },
  {
    que: 'qué signos vitales se toman y cuándo un valor quedó fuera de rango',
    original: 'panel/src/lib/signosVitales.js',
    copias: ['pwa-familias/src/lib/signosVitales.js', 'pwa-asistentes/src/lib/signosVitales.js'],
  },
  {
    que: 'quién de los roles del Panel es la administración de la Prestadora',
    original: 'panel/src/lib/roles.js',
    copias: ['backend/src/utils/roles.js'],
  },
  {
    que: 'qué se admite como cobro de una Familia',
    original: 'panel/src/lib/cobrosDeFamilia.js',
    copias: ['backend/src/utils/cobrosDeFamilia.js'],
  },
  {
    que: 'cuán lejos del domicilio se puede marcar y que cuente como haber llegado',
    original: 'panel/src/lib/toleranciaCheckin.js',
    copias: ['backend/src/utils/toleranciaCheckin.js'],
  },
  {
    que: 'a qué hora se estima que llega quien ya salió, y desde cuántos minutos eso se avisa',
    original: 'panel/src/lib/llegadaEstimada.js',
    copias: ['backend/src/utils/llegadaEstimada.js'],
  },
  {
    que: 'de dónde salió cada alerta temprana de guardia',
    original: 'panel/src/lib/fuentesAlertaTemprana.js',
    copias: ['backend/src/utils/fuentesAlertaTemprana.js'],
  },
  {
    que: 'cómo se avisa que el Paciente está en un domicilio temporal',
    original: 'pwa-asistentes/src/components/DomicilioTemporal.jsx',
    copias: ['pwa-familias/src/components/DomicilioTemporal.jsx'],
  },
  {
    que: 'cómo se le entrega una dirección al mapa del teléfono',
    original: 'pwa-asistentes/src/lib/enlaceAlMapa.js',
    copias: ['pwa-familias/src/lib/enlaceAlMapa.js'],
  },
  {
    que: 'el domicilio escrito de forma que abra el mapa del teléfono',
    original: 'pwa-asistentes/src/components/EnlaceAlMapa.jsx',
    copias: ['pwa-familias/src/components/EnlaceAlMapa.jsx'],
  },
  {
    que: 'la escala de ánimo del reporte y su cara',
    original: 'pwa-asistentes/src/lib/animoDelReporte.js',
    copias: ['pwa-familias/src/lib/animoDelReporte.js'],
  },
  {
    que: 'el arranque de cada aplicación',
    original: 'panel/src/main.jsx',
    copias: ['pwa-asistentes/src/main.jsx', 'pwa-familias/src/main.jsx'],
  },
  {
    que: 'la conexión con la base desde el navegador',
    original: 'panel/src/lib/supabaseClient.js',
    copias: ['pwa-asistentes/src/lib/supabaseClient.js', 'pwa-familias/src/lib/supabaseClient.js'],
  },
  {
    que: 'de dónde saca un componente la identidad del producto',
    original: 'panel/src/config/useIdentidad.js',
    copias: ['pwa-asistentes/src/config/useIdentidad.js', 'pwa-familias/src/config/useIdentidad.js'],
  },
  {
    que: 'cómo se muestra un valor guardado en la base cuando falta su traducción',
    original: 'panel/src/i18n/valores.js',
    copias: ['pwa-asistentes/src/i18n/valores.js', 'pwa-familias/src/i18n/valores.js'],
  },
  {
    que: 'la marca de la Prestadora guardada para cuando la aplicación no está abierta',
    original: 'pwa-familias/src/lib/marcaGuardada.js',
    copias: ['pwa-asistentes/src/lib/marcaGuardada.js'],
  },
  {
    que: 'cómo se rellenan los huecos de un texto traducido',
    original: 'panel/src/lib/textos.js',
    copias: ['pwa-asistentes/src/lib/textos.js', 'pwa-familias/src/lib/textos.js'],
  },
  {
    que: 'la sesión de quien entró a la aplicación',
    original: 'pwa-familias/src/context/AuthContext.jsx',
    copias: ['pwa-asistentes/src/context/AuthContext.jsx'],
  },
  {
    que: 'el permiso y el alta para recibir avisos en el celular',
    original: 'pwa-familias/src/lib/push.js',
    copias: ['pwa-asistentes/src/lib/push.js'],
  },
  {
    que: 'los colores y medidas del sistema de diseño de las dos aplicaciones',
    original: 'pwa-familias/src/styles/variables.css',
    copias: ['pwa-asistentes/src/styles/variables.css'],
  },
  {
    que: 'por qué motivos se puede entrar sin comprobar el pase de guardia',
    original: 'pwa-asistentes/src/lib/motivosSinComprobar.js',
    copias: ['backend/src/utils/motivosSinComprobar.js'],
  },
  {
    que: 'por qué motivos se avisa que se va demorado',
    original: 'pwa-asistentes/src/lib/motivosDemora.js',
    copias: ['backend/src/utils/motivosDemora.js'],
  },
  {
    que: 'cómo se muestra un importe con su moneda',
    original: 'panel/src/lib/dinero.js',
    copias: ['pwa-familias/src/lib/dinero.js'],
  },
  {
    que: 'la pantalla que muestra el código de presencia para que lo lea quien llega',
    original: 'pwa-familias/src/components/CodigoDePresencia.jsx',
    copias: ['pwa-asistentes/src/components/CodigoDePresencia.jsx'],
  },
  {
    que: 'el hilo de mensajes del Marketplace',
    original: 'pwa-familias/src/components/HiloDeMensajes.jsx',
    copias: ['pwa-asistentes/src/components/HiloDeMensajes.jsx'],
  },
  {
    que: 'la lista de conversaciones del Marketplace',
    original: 'pwa-familias/src/pages/Mensajes.jsx',
    copias: ['pwa-asistentes/src/pages/Mensajes.jsx'],
  },
  {
    que: 'una conversación del Marketplace',
    original: 'pwa-familias/src/pages/Conversacion.jsx',
    copias: ['pwa-asistentes/src/pages/Conversacion.jsx'],
  },
];

// OJO CON ESTO, para no volver a averiguarlo:
//
//   - panel/src/styles/variables.css NO es copia del de las dos aplicaciones: el archivo del
//     Panel es distinto y tiene que seguir siéndolo. Solo las dos aplicaciones comparten el
//     suyo, y ese es el grupo declarado arriba. Mismo nombre, tres archivos, dos verdades.

// Todas las rutas de todos los grupos, original incluido. La usan los chequeos
// que necesitan saber qué archivos son copias.
export const TODAS_LAS_RUTAS = GRUPOS.flatMap((g) => [g.original, ...g.copias]);

/**
 * Devuelve las copias que ya no son idénticas a su original.
 * Cada elemento es { que, original, copia }.
 */
export function copiasDespegadas() {
  const despegadas = [];
  for (const grupo of GRUPOS) {
    const original = readFileSync(join(RAIZ, grupo.original), 'utf8');
    for (const copia of grupo.copias) {
      let actual = null;
      try {
        actual = readFileSync(join(RAIZ, copia), 'utf8');
      } catch {
        // no existe todavía: cuenta como despegada
      }
      if (actual !== original) despegadas.push({ que: grupo.que, original: grupo.original, copia });
    }
  }
  return despegadas;
}
