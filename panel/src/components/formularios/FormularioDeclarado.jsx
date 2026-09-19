// El motor que dibuja un formulario declarado.
//
// **Esta pantalla no sabe qué está pidiendo.** No tiene escrito ni un casillero, ni una etiqueta,
// ni una validación: lee la declaración que salió de la base y dibuja lo que ahí diga. Agregar un
// dato es agregar un renglón en la declaración, no publicar una versión nueva del Panel.
//
// **Debajo de un casillero no va nada.** No hay línea de ayuda, no hay párrafo de aclaración y no
// hay globo al pasar el puntero — ni siquiera `title`, que es el globo del navegador. Un casillero
// se explica solo: lleva su etiqueta y nada más. Lo único que puede aparecer debajo es el motivo
// por el que se rechazó lo que se cargó, y aparece sólo cuando se rechazó.
//
// **Y lo que la pantalla controla no es lo que decide.** Acá se controla para que quien carga vea
// lo que falta sin esperar al servidor; el que decide es el servidor, que vuelve a controlar con
// este mismo motor antes de dejar guardar nada.

import { useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { useDeclaracionDeFormulario } from '../../hooks/useDeclaracionDeFormulario';
import { controlarRespuesta } from '../../lib/apiFormularios';
import { mensajeDeError } from '../../lib/errores';
import {
  campoEsObligatorio,
  campoEstaVisible,
  seccionEsObligatoria,
  textoDeclarado,
  validarFormulario,
} from '../../lib/motorDeFormularios';

/* Cómo se dibuja cada tipo declarado. Es lo único que traduce la declaración a una caja de la
   pantalla, y por eso está escrito una sola vez: repartido campo por campo, un tipo terminaría
   dibujándose distinto en dos formularios. */
const CAJA_POR_TIPO = {
  texto: { tipo: 'text' },
  texto_largo: { tipo: 'textarea' },
  fecha: { tipo: 'date' },
  anio: { tipo: 'number' },
  mes_anio: { tipo: 'month' },
  casilla: { tipo: 'checkbox' },
  archivo: { tipo: 'file' },
  telefono: { tipo: 'tel' },
  lista: { tipo: 'select' },
  lista_multiple: { tipo: 'select', multiple: true },
};

function valorDelEvento(campo, evento) {
  if (campo.tipo === 'casilla') return evento.target.checked;
  if (campo.tipo === 'archivo') return evento.target.files?.[0] ?? null;
  if (campo.tipo === 'lista_multiple') return [...evento.target.selectedOptions].map((o) => o.value);
  return evento.target.value;
}

function bloquesDe(seccion, respuesta) {
  const cargado = respuesta?.[seccion.clave];
  if (seccion.repetible) return Array.isArray(cargado) ? cargado : [{}];
  return [cargado && typeof cargado === 'object' ? cargado : {}];
}

/** Un casillero suelto. */
function CasilleroDeclarado({ campo, bloque, contexto, opciones, idioma, t, motivo, alCambiar }) {
  if (!campoEstaVisible(campo, bloque, contexto)) return null;

  const caja = CAJA_POR_TIPO[campo.tipo] ?? CAJA_POR_TIPO.texto;
  const obligatorio = campoEsObligatorio(campo, bloque, contexto);
  const etiqueta = textoDeclarado(campo.etiqueta, idioma);
  const valor = bloque[campo.clave];

  // Lo que se admite subir sale de la declaración, que es la misma lista que controla el
  // servidor. Escrita a mano acá, el día que cambie la declaración la pantalla ofrecería otra cosa.
  const extras = {};
  if (campo.tipo === 'archivo' && Array.isArray(campo.formatos)) {
    extras.accept = campo.formatos.map((formato) => `.${formato}`).join(',');
  }
  if (campo.maximo && caja.tipo !== 'file' && caja.tipo !== 'checkbox') extras.maxLength = campo.maximo;
  if (caja.multiple) extras.multiple = true;

  return (
    <>
      <FormField
        label={etiqueta}
        name={campo.clave}
        type={caja.tipo}
        required={obligatorio}
        error={motivo ? t.formularios[motivo] : ''}
        {...(campo.tipo === 'casilla'
          ? { checked: Boolean(valor) }
          : campo.tipo === 'archivo'
            ? {}
            : { value: caja.multiple ? (Array.isArray(valor) ? valor : []) : (valor ?? '') })}
        {...extras}
        onChange={(evento) => alCambiar(campo.clave, valorDelEvento(campo, evento))}
      >
        {caja.tipo === 'select' && (
          <>
            {!caja.multiple && <option value="" />}
            {(opciones ?? []).map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>{opcion.texto}</option>
            ))}
          </>
        )}
      </FormField>

      {/* Lo que vence pide además hasta cuándo vale. Es un casillero más, no una aclaración. */}
      {campo.vigencia && (
        <FormField
          label={t.formularios.vigente_hasta}
          name={`${campo.clave}_vigente_hasta`}
          type="date"
          required={obligatorio}
          value={bloque[`${campo.clave}_vigente_hasta`] ?? ''}
          onChange={(evento) => alCambiar(`${campo.clave}_vigente_hasta`, evento.target.value)}
        />
      )}
    </>
  );
}

export function FormularioDeclarado({
  clave,
  contexto = {},
  opcionesPorLista = {},
  valorInicial = {},
  alGuardar,
}) {
  const { locale, t } = useLocale();
  const { declaracion, estado, error } = useDeclaracionDeFormulario(clave);
  const [respuesta, setRespuesta] = useState(valorInicial);
  const [faltantes, setFaltantes] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [errorAlGuardar, setErrorAlGuardar] = useState('');

  // Lo que falló, buscable por sección, repetición y casillero, para colgar cada motivo del
  // casillero que lo provocó y no de un renglón suelto al final.
  const motivoDe = useMemo(() => {
    const porCasillero = new Map();
    for (const falta of faltantes) porCasillero.set(`${falta.seccion}|${falta.indice}|${falta.campo}`, falta.motivo);
    return (seccion, indice, campo) => porCasillero.get(`${seccion}|${indice}|${campo}`) ?? '';
  }, [faltantes]);

  function cambiarBloque(seccion, indice, clave, valor) {
    setRespuesta((anterior) => {
      const bloques = bloquesDe(seccion, anterior).map((bloque, i) => (i === indice ? { ...bloque, [clave]: valor } : bloque));
      return { ...anterior, [seccion.clave]: seccion.repetible ? bloques : bloques[0] };
    });
  }

  function agregarRenglon(seccion) {
    setRespuesta((anterior) => ({ ...anterior, [seccion.clave]: [...bloquesDe(seccion, anterior), {}] }));
  }

  function quitarRenglon(seccion, indice) {
    setRespuesta((anterior) => {
      const quedan = bloquesDe(seccion, anterior).filter((_, i) => i !== indice);
      return { ...anterior, [seccion.clave]: quedan.length > 0 ? quedan : [{}] };
    });
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErrorAlGuardar('');

    // Primero acá, para que se vea todo lo que falta de una sola vez y sin ir hasta el servidor.
    const enPantalla = validarFormulario(declaracion, respuesta, { contexto, opcionesPorLista });
    setFaltantes(enPantalla);
    if (enPantalla.length > 0) return;

    setGuardando(true);
    try {
      // Y después allá, que es donde se decide.
      const veredicto = await controlarRespuesta(clave, respuesta, contexto);
      if (!veredicto.ok) {
        setFaltantes(veredicto.faltantes);
        return;
      }
      await alGuardar?.(veredicto.respuesta);
    } catch (errorDeEnvio) {
      setErrorAlGuardar(mensajeDeError(errorDeEnvio, t, 'formulario declarado'));
    } finally {
      setGuardando(false);
    }
  }

  if (estado === 'cargando') return <p>{t.comun.cargando}</p>;
  if (estado === 'error') return <Alert variant="error">{error}</Alert>;
  if (estado === 'vacio') return <Alert variant="info">{t.formularios.sin_formulario}</Alert>;

  return (
    <form onSubmit={enviar} noValidate>
      <h2>{textoDeclarado(declaracion.titulo, locale)}</h2>

      {declaracion.secciones.map((seccion) => {
        const bloques = bloquesDe(seccion, respuesta);
        const exigida = seccionEsObligatoria(seccion, respuesta, contexto);
        const campos = seccion.campos ?? [];
        const tope = Number(seccion.maximo_repeticiones ?? 0);

        return (
          <section key={seccion.clave}>
            <h3>
              {textoDeclarado(seccion.titulo, locale)}
              {exigida && <span className="required">*</span>}
            </h3>

            {bloques.map((bloque, indice) => (
              <div key={`${seccion.clave}-${indice}`}>
                {campos.map((campo) => (
                  <CasilleroDeclarado
                    key={campo.clave}
                    campo={campo}
                    bloque={bloque}
                    contexto={contexto}
                    opciones={campo.lista_de_opciones ? opcionesPorLista[campo.lista_de_opciones] : null}
                    idioma={locale}
                    t={t}
                    motivo={motivoDe(seccion.clave, indice, campo.clave)}
                    alCambiar={(claveDelCampo, valor) => cambiarBloque(seccion, indice, claveDelCampo, valor)}
                  />
                ))}

                {seccion.repetible && bloques.length > 1 && (
                  <Button variant="secondary" disabled={guardando} onClick={() => quitarRenglon(seccion, indice)}>
                    {t.formularios.quitar_renglon}
                  </Button>
                )}
              </div>
            ))}

            {seccion.repetible && (tope === 0 || bloques.length < tope) && (
              <Button variant="secondary" disabled={guardando} onClick={() => agregarRenglon(seccion)}>
                {t.formularios.agregar_renglon}
              </Button>
            )}
          </section>
        );
      })}

      {faltantes.length > 0 && <Alert variant="error">{t.formularios.formulario_incompleto}</Alert>}
      {errorAlGuardar && <Alert variant="error">{errorAlGuardar}</Alert>}

      {/* El botón se apaga mientras el envío corre: nunca dos envíos. */}
      <Button type="submit" disabled={guardando}>
        {guardando ? t.comun.guardando : t.comun.guardar}
      </Button>
    </form>
  );
}
