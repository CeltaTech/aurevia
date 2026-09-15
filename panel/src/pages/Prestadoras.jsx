import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { useTenantSession } from '../context/TenantSessionContext';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { FormField } from '../components/ui/FormField';
import { EstadoLista } from '../components/layout/EstadoLista';
import { traducirValor } from '../i18n/valores';
import { mensajeDeError, errorDeLaRespuesta } from '../lib/errores';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
  return resultado;
}

const CAMPOS_VACIOS = {
  razon_social: '',
  nombre_fantasia: '',
  identificacion_fiscal: '',
  pais: '',
  email_respuestas: '',
};

export function Prestadoras() {
  const { t } = useLocale();
  const { sesion, recargar: recargarSesion, salir } = useTenantSession();
  const [prestadoras, setPrestadoras] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(null);
  const [saliendo, setSaliendo] = useState(false);
  const [paises, setPaises] = useState([]);
  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [campos, setCampos] = useState(CAMPOS_VACIOS);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const [{ prestadoras: filas }, { paises: catalogo }] = await Promise.all([
        llamarApi('/prestadoras'),
        llamarApi('/prestadoras/paises'),
        recargarSesion(),
      ]);
      setPrestadoras(filas);
      setPaises(catalogo);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [recargarSesion, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function handleEntrar(prestadoraId) {
    setEntrando(prestadoraId);
    setError(null);
    try {
      await llamarApi('/sesion-tenant', {
        method: 'POST',
        body: JSON.stringify({ prestadora_id: prestadoraId }),
      });
      await recargarSesion();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setEntrando(null);
    }
  }

  function cambiarCampo(nombre, valor) {
    setCampos((anteriores) => ({ ...anteriores, [nombre]: valor }));
  }

  function cerrarFormulario() {
    setFormularioAbierto(false);
    setCampos(CAMPOS_VACIOS);
  }

  async function handleAlta(evento) {
    evento.preventDefault();
    setCreando(true);
    setError(null);
    setAviso(null);
    try {
      const resultado = await llamarApi('/prestadoras', {
        method: 'POST',
        body: JSON.stringify(campos),
      });
      // Si la casilla de respuestas no se pudo guardar, la Prestadora existe igual: el aviso lo
      // dice acá y no se pierde, porque ese dato se vuelve a cargar desde Configuración.
      const plantilla = resultado.casilla_respuestas_guardada ? t.prestadoras.alta_lista : t.prestadoras.alta_sin_casilla;
      setAviso({
        variante: resultado.casilla_respuestas_guardada ? 'success' : 'warning',
        texto: plantilla.replace('{prestadora}', resultado.prestadora.nombre_fantasia),
      });
      cerrarFormulario();
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setCreando(false);
    }
  }

  async function handleSalir() {
    setSaliendo(true);
    setError(null);
    try {
      await salir();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setSaliendo(false);
    }
  }

  return (
    <div>
      <h1>{t.prestadoras.titulo}</h1>
      <p className="panel-explicacion">{t.prestadoras.explicacion}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {aviso && <Alert variant={aviso.variante}>{aviso.texto}</Alert>}

      {!formularioAbierto && (
        <Button onClick={() => { setAviso(null); setFormularioAbierto(true); }} disabled={Boolean(sesion)}>
          {t.prestadoras.alta_abrir}
        </Button>
      )}

      {formularioAbierto && (
        <form onSubmit={handleAlta}>
          <h2>{t.prestadoras.alta_titulo}</h2>
          <p className="panel-explicacion">{t.prestadoras.alta_explicacion}</p>

          <FormField
            label={t.prestadoras.campo_nombre_fantasia}
            ayuda={t.prestadoras.campo_nombre_fantasia_ayuda}
            name="nombre_fantasia"
            required
            value={campos.nombre_fantasia}
            onChange={(e) => cambiarCampo('nombre_fantasia', e.target.value)}
          />

          <FormField
            label={t.prestadoras.campo_razon_social}
            ayuda={t.prestadoras.campo_razon_social_ayuda}
            name="razon_social"
            required
            value={campos.razon_social}
            onChange={(e) => cambiarCampo('razon_social', e.target.value)}
          />

          <FormField
            label={t.prestadoras.campo_identificacion_fiscal}
            ayuda={t.prestadoras.campo_identificacion_fiscal_ayuda}
            name="identificacion_fiscal"
            value={campos.identificacion_fiscal}
            onChange={(e) => cambiarCampo('identificacion_fiscal', e.target.value)}
          />

          <FormField
            label={t.prestadoras.campo_pais}
            name="pais"
            type="select"
            required
            value={campos.pais}
            onChange={(e) => cambiarCampo('pais', e.target.value)}
          >
            <option value="">{t.comun.seleccionar}</option>
            {paises.map((p) => (
              <option key={p.pais} value={p.pais}>{traducirValor(t.prestadoras, `pais_${p.pais}`)}</option>
            ))}
          </FormField>

          <FormField
            label={t.prestadoras.campo_email_respuestas}
            ayuda={t.prestadoras.campo_email_respuestas_ayuda}
            name="email_respuestas"
            type="email"
            required
            value={campos.email_respuestas}
            onChange={(e) => cambiarCampo('email_respuestas', e.target.value)}
          />

          <Button type="submit" disabled={creando}>
            {creando ? t.prestadoras.alta_creando : t.prestadoras.alta_confirmar}
          </Button>
          <Button variant="secondary" type="button" onClick={cerrarFormulario} disabled={creando}>
            {t.prestadoras.alta_cancelar}
          </Button>
        </form>
      )}

      {sesion && (
        <Alert variant="info">
          <strong>{t.prestadoras.sesion_activa_titulo}:</strong> {sesion.prestadoras?.nombre_fantasia}
          {' — '}
          {t.prestadoras.sesion_activa_expira.replace('{hora}', new Date(sesion.expira_at).toLocaleTimeString())}
          {' '}
          <Button variant="secondary" onClick={handleSalir} disabled={saliendo}>
            {saliendo ? t.prestadoras.saliendo : t.prestadoras.salir}
          </Button>
        </Alert>
      )}

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && prestadoras.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.prestadoras.col_nombre}</th>
              <th>{t.prestadoras.col_estado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {prestadoras.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre_fantasia}</td>
                <td>{traducirValor(t.prestadoras, `estado_${p.estado}`)}</td>
                <td>
                  <Button
                    variant="secondary"
                    onClick={() => handleEntrar(p.id)}
                    disabled={Boolean(sesion) || entrando === p.id}
                  >
                    {entrando === p.id ? t.prestadoras.entrando : t.prestadoras.entrar}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
