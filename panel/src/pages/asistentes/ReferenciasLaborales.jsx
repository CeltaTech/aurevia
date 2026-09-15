import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { RESULTADOS_DE_REFERENCIA, TOPE_DE_REFERENCIAS } from '../../lib/referenciasLaborales';
import {
  agregarReferenciaLaboral,
  anotarResultadoDeReferencia,
  verReferenciasLaborales,
} from '../../lib/referenciasGuardadasDeAsistente';

/* Las referencias laborales de un Asistente, una por una.
   ==========================================================================

   PARA QUÉ. La postulación pide hasta cinco referencias y las guarda adentro, como un documento
   que se lee entero (`docs/PRD_03_Reclutamiento.md`). Nadie podía dejar constancia de haber
   llamado a ninguna: la verificación pasaba por afuera del producto y lo único que quedaba era una
   etapa marcada a mano. Acá se llama a cada una y queda anotado qué contestó.

   NO ESTÁ ADENTRO DE NINGUNA ETAPA, por lo mismo que las dos fotos: cada Prestadora define las
   etapas de su propio proceso y les pone las claves que quiera, así que no hay ninguna clave que
   esta pantalla pueda buscar. Las referencias son de la persona, no de una etapa.

   Y EL MÍNIMO NO IMPIDE NADA. Si faltan referencias verificadas se dice, y se dice también que la
   decisión es de la Prestadora: el producto avisa, no bloquea (`celtatech/CLAUDE.md` §7). Cuántas
   se esperan sale de la configuración de esa Prestadora, y viene contado desde el motor. */

export function ReferenciasLaborales({ asistente }) {
  const { t } = useLocale();
  const tr = t.asistentes.verificacion.referencias;
  const [datos, setDatos] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(null);
  const [nueva, setNueva] = useState({ nombre: '', telefono: '', vinculo: '' });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setDatos(await verReferenciasLaborales(asistente.id));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t));
      setEstado('error');
    }
  }, [asistente.id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function anotar(referencia, cambios) {
    setGuardando(referencia.id);
    setError(null);
    try {
      await anotarResultadoDeReferencia(asistente.id, referencia.id, {
        resultado: cambios.resultado ?? referencia.resultado,
        notas: cambios.notas ?? referencia.notas,
      });
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setGuardando(null);
    }
  }

  async function agregar(evento) {
    evento.preventDefault();
    setGuardando('nueva');
    setError(null);
    try {
      await agregarReferenciaLaboral(asistente.id, nueva);
      setNueva({ nombre: '', telefono: '', vinculo: '' });
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e, t));
    } finally {
      setGuardando(null);
    }
  }

  const referencias = datos?.referencias ?? [];
  const hayLugar = referencias.length < TOPE_DE_REFERENCIAS;

  return (
    <section className="panel-card-verificacion">
      <h3>{tr.titulo}</h3>
      <p className="panel-explicacion">{tr.explicacion}</p>
      {/* Sólo cuando la carga salió bien: si el estado es de error, el cartel lo pone `EstadoLista`
          con su botón de reintentar, y los dos juntos dirían lo mismo dos veces. */}
      {error && estado === 'listo' && <Alert variant="error">{error}</Alert>}

      {/* El aviso del mínimo sólo aparece si esta Prestadora espera alguna. En cero no hay nada que
          avisar, y un cartel diciendo que se alcanzó un mínimo de cero no informa nada. */}
      {estado === 'listo' && datos?.seExigenReferencias && (
        datos.alcanza
          ? <Alert variant="info">{tr.alcanza}</Alert>
          : (
            <Alert variant="warning">
              {tr.faltan
                .replace('{{faltan}}', datos.faltan)
                .replace('{{exigidas}}', datos.exigidas)}
            </Alert>
          )
      )}

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && referencias.length === 0}
        mensajeVacio={tr.sin_referencias}
        recargar={recargar}
      >
        {referencias.map((referencia) => (
          <article key={referencia.id} className="panel-referencia-laboral">
            <h4>{referencia.nombre}</h4>
            <p className="panel-explicacion">
              {referencia.telefono}{referencia.vinculo ? ` · ${referencia.vinculo}` : ''}
            </p>
            <FormField
              label={tr.col_resultado}
              name={`resultado-${referencia.id}`}
              type="select"
              value={referencia.resultado}
              onChange={(e) => anotar(referencia, { resultado: e.target.value })}
              disabled={guardando === referencia.id}
            >
              {RESULTADOS_DE_REFERENCIA.map((opcion) => (
                <option key={opcion} value={opcion}>{tr[`resultado_${opcion}`]}</option>
              ))}
            </FormField>
            <FormField
              label={t.comun.nota_interna}
              name={`notas-${referencia.id}`}
              type="textarea"
              value={referencia.notas || ''}
              onChange={(e) => setDatos((previo) => ({
                ...previo,
                referencias: previo.referencias.map((una) => (
                  una.id === referencia.id ? { ...una, notas: e.target.value } : una
                )),
              }))}
              onBlur={() => anotar(referencia, { notas: referencia.notas || '' })}
              disabled={guardando === referencia.id}
            />
            {/* Quién la verificó no se muestra acá: adentro de una Prestadora el equipo es chico y
                el nombre no agrega nada a quien mira la ficha. Queda guardado, y sale en la
                auditoría, que es donde se pregunta quién hizo qué. */}
            {referencia.verificada_en && (
              <p className="panel-explicacion">
                {tr.verificada_por} {new Date(referencia.verificada_en).toLocaleDateString()}
              </p>
            )}
            {guardando === referencia.id && <p className="panel-explicacion">{t.comun.guardando}</p>}
          </article>
        ))}
      </EstadoLista>

      {/* El formulario queda afuera de `EstadoLista`: es la salida cuando no hay ninguna referencia
          cargada, así que tiene que verse justamente en el caso vacío. */}
      {estado === 'listo' && hayLugar && (
        <form className="panel-referencia-nueva" onSubmit={agregar}>
          <h4>{tr.agregar_titulo}</h4>
          <p className="panel-explicacion">{tr.agregar_explicacion}</p>
          <FormField
            label={tr.campo_nombre}
            name="referencia-nombre"
            value={nueva.nombre}
            onChange={(e) => setNueva((previo) => ({ ...previo, nombre: e.target.value }))}
            required
          />
          <FormField
            label={tr.campo_telefono}
            name="referencia-telefono"
            value={nueva.telefono}
            onChange={(e) => setNueva((previo) => ({ ...previo, telefono: e.target.value }))}
            required
          />
          <FormField
            label={tr.campo_vinculo}
            name="referencia-vinculo"
            value={nueva.vinculo}
            onChange={(e) => setNueva((previo) => ({ ...previo, vinculo: e.target.value }))}
          />
          <Button type="submit" variant="secondary" disabled={guardando === 'nueva'}>
            {guardando === 'nueva' ? t.comun.guardando : tr.agregar}
          </Button>
        </form>
      )}
    </section>
  );
}
