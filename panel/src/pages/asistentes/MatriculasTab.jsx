import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { claseBadge } from '../../lib/tonos';
import { con } from '../../lib/textos';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { COLUMNAS_ESTADO_MATRICULA } from '../../lib/matricula';
import { URGENCIA, diasParaVencer, urgenciaDeVencimiento } from '../../lib/reglaVencimientos';

/* La solapa de Matrículas de un Asistente.
   ==========================================================================

   QUÉ CAMBIÓ Y POR QUÉ. Antes esta pantalla era una lista de papeles: se cargaban y quedaban
   ahí. Ahora la Matrícula decide si la persona puede o no tomar guardias —la base lo hace
   cumplir—, así que esta pantalla tiene que contestar tres cosas y no una:

     1. ¿Está bloqueado ahora mismo, y por qué? Arriba de todo, antes de la lista.
     2. ¿Cómo se destraba? Cargando la Matrícula, renovándola o verificándola, según el caso.
     3. ¿Quién la verificó y cómo? Porque "verificada" sin decir quién ni cómo no sirve de nada
        el día que alguien tenga que responder por eso.

   EL TIPO YA NO SE ESCRIBE A MANO. Antes era un campo de texto libre, y ahí estaba el
   problema: si alguien escribía "enfermería" y el catálogo decía "enfermeria", la regla no
   encontraba la Matrícula y bloqueaba a una persona que sí la tenía. Ahora se elige de la
   lista de tipos que el catálogo declara. */

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/medicacion${path}`, {
    ...opciones,
    headers: {
      ...(opciones.body && !(opciones.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(resultado.error || 'Error de red');
  return resultado;
}

/** Los tres métodos que la base acepta. El orden es de más a menos directo. */
const METODOS = ['documento_a_la_vista', 'constancia_del_organismo', 'registro_oficial_en_linea'];

function estaVigente(fila) {
  const hoy = new Date().toISOString().slice(0, 10);
  return !fila.vigente_hasta || fila.vigente_hasta >= hoy;
}

export function MatriculasTab({ asistente }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const tm = t.matricula;
  const tmat = t.asistentes.matriculas;

  const [matriculas, setMatriculas] = useState([]);
  const [estadoMatricula, setEstadoMatricula] = useState(null);
  const [tiposDeMatricula, setTiposDeMatricula] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [revocandoId, setRevocandoId] = useState(null);
  const [abriendoId, setAbriendoId] = useState(null);
  const [verificando, setVerificando] = useState(null); // la fila que se está verificando

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    // Tres cosas juntas: los papeles, cómo quedó la persona según la base, y qué tipos de
    // Matrícula existen para elegir. Van juntas porque sin las tres la pantalla no puede
    // decir nada útil, y pedirlas de a una haría parpadear la pantalla tres veces.
    const [ms, em, tp] = await Promise.all([
      supabase
        .from('matriculas_asistente')
        .select('*')
        .eq('asistente_id', asistente.id)
        .order('vigente_desde', { ascending: false }),
      supabase
        .from('estado_matricula_asistente')
        .select(COLUMNAS_ESTADO_MATRICULA)
        .eq('asistente_id', asistente.id)
        .maybeSingle(),
      supabase
        .from('tipos_asistente')
        .select('tipo_matricula')
        .eq('requiere_matricula', true)
        .eq('activo', true)
        .not('tipo_matricula', 'is', null),
    ]);

    const fallo = ms.error || tp.error;
    if (fallo) {
      setError(mensajeDeError(fallo, t));
      setEstado('error');
      return;
    }

    setMatriculas(ms.data ?? []);
    setEstadoMatricula(em.data ?? null);
    setTiposDeMatricula([...new Set((tp.data ?? []).map((x) => x.tipo_matricula))].sort());
    setEstado('listo');
  }, [asistente.id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /* El cartel de arriba. Es lo primero que se lee y lo único que hace falta leer cuando algo
     está mal: qué pasa y qué hacer. El motivo lo dice la base, no esta pantalla. */
  const avisoArriba = useMemo(() => {
    if (!estadoMatricula) return null;

    const motivo = estadoMatricula.motivo_bloqueo;
    if (motivo) {
      return {
        variant: 'error',
        titulo: tm.bloqueo_titulo,
        detalle: [tm[`bloqueo_${motivo}`], tm[`que_hacer_${motivo}`]].filter(Boolean).join(' '),
      };
    }

    if (estadoMatricula.requiere_matricula !== true) return null;

    const dias = diasParaVencer(estadoMatricula.vigente_hasta);
    const urgencia = urgenciaDeVencimiento(dias);
    if (urgencia === URGENCIA.NINGUNA) return null;

    let detalle = con(tm.vence_en_dias, { dias });
    if (dias < 0) detalle = con(tm.vencio_hace_dias, { dias: -dias });
    else if (dias === 0) detalle = tm.vence_hoy;
    else if (dias === 1) detalle = tm.vence_manana;

    return {
      variant: urgencia === URGENCIA.AVISO ? 'info' : 'warning',
      titulo: detalle,
      detalle: tm.que_hacer_vencida,
    };
  }, [estadoMatricula, tm]);

  async function revocar(fila) {
    setRevocandoId(fila.id);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('matriculas_asistente')
      .update({ vigente_hasta: new Date().toISOString().slice(0, 10) })
      .eq('id', fila.id);
    setRevocandoId(null);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  async function verArchivo(fila) {
    setAbriendoId(fila.id);
    setError(null);
    try {
      const { url } = await llamarApi(`/archivo-url?ruta=${encodeURIComponent(fila.archivo_url)}`);
      window.open(url, '_blank', 'noreferrer');
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setAbriendoId(null);
    }
  }

  return (
    <div>
      <h2>{tmat.titulo}</h2>
      <p className="panel-explicacion">{tmat.explicacion}</p>

      {avisoArriba && (
        <Alert variant={avisoArriba.variant}>
          <strong>{avisoArriba.titulo}</strong> {avisoArriba.detalle}
        </Alert>
      )}
      {error && <Alert variant="error">{error}</Alert>}

      <div className="panel-filtros">
        <Button onClick={() => setMostrarNueva(true)} disabled={tiposDeMatricula.length === 0}>
          {tmat.nueva}
        </Button>
      </div>
      {tiposDeMatricula.length === 0 && estado === 'listo' && (
        <p className="panel-explicacion">{tmat.sin_tipos_de_matricula}</p>
      )}

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && matriculas.length === 0} recargar={recargar} mensajeVacio={tmat.sin_matriculas}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{tmat.col_tipo}</th>
              <th>{tmat.col_matricula}</th>
              <th>{tmat.col_desde}</th>
              <th>{tmat.col_hasta}</th>
              <th>{tmat.col_estado}</th>
              <th>{tmat.col_verificacion}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {matriculas.map((fila) => {
              const vigente = estaVigente(fila);
              return (
                <tr key={fila.id}>
                  <td>{t.tipos_asistente[`matricula_${fila.tipo}`] ?? fila.tipo}</td>
                  <td>{fila.numero_matricula || '—'}</td>
                  <td>{fila.vigente_desde}</td>
                  <td>{fila.vigente_hasta || '—'}</td>
                  <td>
                    <span className={claseBadge(vigente ? 'vigente' : 'vencida')}>
                      {vigente ? tmat.estado_vigente : tmat.estado_historico}
                    </span>
                  </td>
                  <td>
                    {fila.verificada_at ? (
                      <span className={claseBadge('vigente')}>
                        {con(tm.verificada_el, { fecha: fila.verificada_at.slice(0, 10) })}
                      </span>
                    ) : (
                      <span className={claseBadge('vencida')}>{tm.sin_verificar}</span>
                    )}
                  </td>
                  <td>
                    {fila.archivo_url && (
                      <>
                        <button onClick={() => verArchivo(fila)} disabled={abriendoId === fila.id}>
                          {tmat.ver_archivo}
                        </button>{' '}
                      </>
                    )}
                    {vigente && !fila.verificada_at && (
                      <>
                        <button onClick={() => setVerificando(fila)}>{tm.verificar}</button>{' '}
                      </>
                    )}
                    {vigente && (
                      <button onClick={() => revocar(fila)} disabled={revocandoId === fila.id}>
                        {revocandoId === fila.id ? t.comun.guardando : tmat.revocar}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>

      {mostrarNueva && (
        <NuevaMatriculaModal
          asistente={asistente}
          usuario={usuario}
          tipos={tiposDeMatricula}
          tipoSugerido={estadoMatricula?.tipo_matricula ?? ''}
          onClose={() => setMostrarNueva(false)}
          onCreada={() => {
            setMostrarNueva(false);
            recargar();
          }}
        />
      )}

      {verificando && (
        <VerificarMatriculaModal
          fila={verificando}
          usuario={usuario}
          onClose={() => setVerificando(null)}
          onVerificada={() => {
            setVerificando(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

function NuevaMatriculaModal({ asistente, usuario, tipos, tipoSugerido, onClose, onCreada }) {
  const { t } = useLocale();
  const tmat = t.asistentes.matriculas;
  // Si el tipo de este Asistente ya dice qué Matrícula le hace falta, viene elegida: es la que
  // se va a cargar en el 99% de los casos, y dejarla en blanco sería pedir un clic de más.
  const [tipo, setTipo] = useState(tipos.includes(tipoSugerido) ? tipoSugerido : '');
  const [numeroMatricula, setNumeroMatricula] = useState('');
  const [vigenteDesde, setVigenteDesde] = useState('');
  const [vigenteHasta, setVigenteHasta] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      let archivoUrl = null;
      if (archivo) {
        const formData = new FormData();
        formData.append('archivo', archivo);
        const resultado = await llamarApi(`/matriculas/${asistente.id}/archivo`, { method: 'POST', body: formData });
        archivoUrl = resultado.archivoUrl;
      }
      const { error: errorInsert } = await supabase.from('matriculas_asistente').insert({
        asistente_id: asistente.id,
        tipo,
        numero_matricula: numeroMatricula || null,
        vigente_desde: vigenteDesde,
        vigente_hasta: vigenteHasta || null,
        archivo_url: archivoUrl,
        registrado_por: usuario.id,
      });
      if (errorInsert) throw errorInsert;
      onCreada();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tmat.nueva}</h2>
        {error && <Alert variant="error">{error}</Alert>}

        <label htmlFor="tipo-matricula">{tmat.col_tipo}</label>
        <select
          id="tipo-matricula"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          required
        >
          <option value="">{tmat.tipo_placeholder}</option>
          {tipos.map((v) => (
            <option key={v} value={v}>
              {t.tipos_asistente[`matricula_${v}`] ?? v}
            </option>
          ))}
        </select>

        <FormField label={tmat.col_matricula} name="numero_matricula" value={numeroMatricula} onChange={(e) => setNumeroMatricula(e.target.value)} />
        <FormField label={tmat.col_desde} name="vigente_desde" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} required />
        {/* Sin fecha de vencimiento, la Matrícula no vence nunca. Es válido —hay títulos que no
            caducan— y por eso el campo no es obligatorio. */}
        <FormField label={tmat.col_hasta} name="vigente_hasta" type="date" value={vigenteHasta} onChange={(e) => setVigenteHasta(e.target.value)} />
        <label>{tmat.archivo}</label>
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !tipo || !vigenteDesde}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Verificar es afirmar algo con el nombre propio: "yo vi esta Matrícula y los datos coinciden".
   Por eso se pide cómo se comprobó y se pide confirmación (regla 4 de CLAUDE.md §7): la base
   guarda quién, cuándo y de qué manera, y esas tres cosas van juntas o no va ninguna. */
function VerificarMatriculaModal({ fila, usuario, onClose, onVerificada }) {
  const { t } = useLocale();
  const tm = t.matricula;
  const [metodo, setMetodo] = useState(METODOS[0]);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleVerificar() {
    setGuardando(true);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('matriculas_asistente')
      .update({
        verificada_at: new Date().toISOString(),
        verificada_por: usuario.id,
        metodo_verificacion: metodo,
        nota_verificacion: nota || null,
      })
      .eq('id', fila.id);
    setGuardando(false);
    if (errorUpdate) {
      setError(mensajeDeError(errorUpdate, t));
      return;
    }
    onVerificada();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tm.verificar}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <p className="panel-explicacion">{tm.confirmar_verificar}</p>

        <label htmlFor="metodo-verificacion">{tm.metodo}</label>
        <select id="metodo-verificacion" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
          {METODOS.map((m) => (
            <option key={m} value={m}>
              {tm[`metodo_${m}`]}
            </option>
          ))}
        </select>

        <FormField label={tm.nota_verificacion} name="nota_verificacion" value={nota} onChange={(e) => setNota(e.target.value)} />

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleVerificar} disabled={guardando}>
            {guardando ? t.comun.guardando : tm.verificar}
          </Button>
        </div>
      </div>
    </div>
  );
}
