import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { EstadoLista } from '../layout/EstadoLista';
import { diaDelMomento, horaDelMomento } from '../../lib/horarios';
import { con } from '../../lib/textos';
import { mensajeDeError } from '../../lib/errores';

/* LOS CONSENTIMIENTOS QUE TODAVÍA VALEN

   Un registro que no lee nadie no sirve de nada. Esta sección muestra los consentimientos cuyo
   plazo todavía no venció: son las casas donde, ahora mismo, la Familia aceptó que la persona
   atendida quede sola un rato.

   NO SE PUEDE CERRAR NI EDITAR NADA DESDE ACÁ, Y ES A PROPÓSITO. Un consentimiento es el registro
   de una conversación que ya ocurrió: no se revoca apretando un botón en el Panel, se revoca
   hablando de nuevo con la Familia, y eso es otro registro. Lo único que lo termina es que llegue
   su hora.

   LOS VENCIDOS NO SE MUESTRAN. Ya no hay nada que hacer con ellos y llenarían la pantalla. Siguen
   escritos: lo que se mira acá es lo que está pasando hoy, no el archivo. */

const TABLA = 'consentimientos_paciente_solo';

export function ConsentimientosVigentes() {
  const { t, locale } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { data, error: errorConsentimientos } = await supabase
        .from(TABLA)
        .select('id, paciente_id, quien_consintio, medio, desde_at, hasta_at, nota')
        .gte('hasta_at', new Date().toISOString())
        .order('hasta_at', { ascending: true });
      if (errorConsentimientos) throw errorConsentimientos;

      const registros = data ?? [];
      const ids = [...new Set(registros.map((c) => c.paciente_id).filter(Boolean))];
      // El nombre se pide aparte porque la fila guarda el identificador. Uno que no vuelva no se
      // inventa: se dibuja un guión.
      const { data: pacientes, error: errorPacientes } = ids.length
        ? await supabase.from('pacientes').select('id, nombre').in('id', ids)
        : { data: [], error: null };
      if (errorPacientes) throw errorPacientes;
      const nombresPorId = Object.fromEntries((pacientes ?? []).map((p) => [p.id, p.nombre]));

      setFilas(registros.map((c) => ({ ...c, paciente_nombre: nombresPorId[c.paciente_id] || '—' })));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => { recargar(); }, [recargar]);

  return (
    <>
      <h2>{t.continuidad.consentimientos_titulo}</h2>
      <p className="panel-explicacion">{t.continuidad.consentimientos_explicacion}</p>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filas.length === 0}
        recargar={recargar}
        mensajeVacio={t.continuidad.consentimientos_vacio}
      >
        {filas.map((c) => (
          <div key={c.id} className="panel-guardia-card guardia-ausente">
            <div>
              <strong>{t.continuidad.col_paciente}: {c.paciente_nombre}</strong>
              <div>{t.continuidad.paciente_solo_quien}: {c.quien_consintio}</div>
              <div>
                {t.continuidad.paciente_solo_medio}:{' '}
                {t.continuidad[`paciente_solo_medio_${c.medio}`] ?? t.continuidad.paciente_solo_medio_desconocido}
              </div>
              {/* Hasta cuándo vale, que es lo único que hay que mirar para saber si todavía
                  alcanza. Con día y hora: un plazo de ocho horas dicho sólo por el día no dice
                  nada. */}
              <div className="panel-guardia-alerta">
                {con(t.continuidad.consentimientos_vale_hasta, {
                  dia: diaDelMomento(c.hasta_at) || '—',
                  hora: horaDelMomento(c.hasta_at, locale) || '—',
                })}
              </div>
              {c.nota && <div>{t.continuidad.paciente_solo_nota}: {c.nota}</div>}
            </div>
          </div>
        ))}
      </EstadoLista>
    </>
  );
}
