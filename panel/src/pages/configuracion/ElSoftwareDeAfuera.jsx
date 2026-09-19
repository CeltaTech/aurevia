import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { esAdminDePrestadora } from '../../lib/roles';

// CON QUÉ SOFTWARE DE AFUERA SE CONECTA LA PRESTADORA.
//
// Dos conexiones: la del software de facturación y la del de créditos y cobranzas. Careonys no
// hace ninguna de las dos tareas —son software aparte, comprado por la Prestadora— y acá se anota
// nada más que cuál es el suyo y con qué credencial se entra.
//
// LA CREDENCIAL NO VUELVE. Se escribe, se guarda en la caja fuerte de la base y de ahí no sale
// nunca más: ni entera, ni tapada, ni a medias. El casillero arranca vacío siempre, y lo único
// que la pantalla sabe es si hay una cargada o no. Para cambiarla se escribe una nueva.
//
// Y cambiar de software obliga a traer una credencial nueva, porque la anterior es la llave de
// otra puerta: dejarla haría creer que la conexión funciona cuando ya no entra a ningún lado.

export function ElSoftwareDeAfuera() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const puedeCargar = esAdminDePrestadora(usuario?.rol);

  const [catalogo, setCatalogo] = useState([]);
  const [conexiones, setConexiones] = useState([]);
  // Lo que se está escribiendo, por clase: con qué software quedó elegido y la credencial nueva.
  const [borrador, setBorrador] = useState({});
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(null);
  const [guardado, setGuardado] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const datos = await llamarApi('/software-externo');
      setCatalogo(datos.catalogo ?? []);
      setConexiones(datos.conexiones ?? []);
      setBorrador(
        Object.fromEntries(
          (datos.conexiones ?? []).map((una) => [una.clase, { software: una.software ?? '', credencial: '' }])
        )
      );
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function cambiar(clase, campo, valor) {
    setBorrador((previo) => ({ ...previo, [clase]: { ...previo[clase], [campo]: valor } }));
    setGuardado(null);
  }

  // La misma condición que comprueba el motor: hace falta credencial cuando todavía no hay
  // ninguna, y también cuando se cambió de software.
  function faltaLaCredencial(conexion) {
    const escrito = borrador[conexion.clase] ?? {};
    if (escrito.credencial) return false;
    return !conexion.credencial_cargada || escrito.software !== conexion.software;
  }

  async function guardar(conexion) {
    const escrito = borrador[conexion.clase] ?? {};
    setGuardando(conexion.clase);
    setError(null);
    try {
      await llamarApi(`/software-externo/${conexion.clase}`, {
        method: 'PUT',
        body: JSON.stringify({ software: escrito.software, credencial: escrito.credencial }),
      });
      setGuardado(conexion.clase);
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(null);
    }
  }

  return (
    <>
      <h2>{t.configuracion.software_externo_titulo}</h2>
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && catalogo.length === 0}
        recargar={recargar}
        mensajeVacio={t.configuracion.software_externo_sin_catalogo}
      >
        <div>
          {error && <Alert variant="error">{error}</Alert>}
          {!puedeCargar && <Alert variant="info">{t.configuracion.software_externo_solo_admin}</Alert>}

          {conexiones.map((conexion) => {
            const opciones = catalogo.filter((uno) => uno.clase === conexion.clase);
            const escrito = borrador[conexion.clase] ?? {};
            return (
              <section key={conexion.clase}>
                <h3>{t.configuracion[`software_externo_${conexion.clase}`]}</h3>

                {opciones.length === 0 ? (
                  <Alert variant="info">{t.configuracion.software_externo_sin_catalogo}</Alert>
                ) : (
                  <>
                    <Alert variant="info">
                      {conexion.credencial_cargada
                        ? t.configuracion.software_externo_credencial_cargada
                        : t.configuracion.software_externo_credencial_sin_cargar}
                    </Alert>

                    <FormField
                      label={t.configuracion.software_externo_cual}
                      name={`software-${conexion.clase}`}
                      type="select"
                      value={escrito.software ?? ''}
                      disabled={!puedeCargar || guardando === conexion.clase}
                      onChange={(e) => cambiar(conexion.clase, 'software', e.target.value)}
                    >
                      <option value="">{t.configuracion.software_externo_elegir}</option>
                      {opciones.map((uno) => (
                        <option key={uno.clave} value={uno.clave}>
                          {uno.nombre}
                        </option>
                      ))}
                    </FormField>

                    <FormField
                      label={
                        conexion.credencial_cargada
                          ? t.configuracion.software_externo_credencial_reemplazar
                          : t.configuracion.software_externo_credencial
                      }
                      name={`credencial-${conexion.clase}`}
                      type="password"
                      autoComplete="new-password"
                      value={escrito.credencial ?? ''}
                      disabled={!puedeCargar || guardando === conexion.clase}
                      onChange={(e) => cambiar(conexion.clase, 'credencial', e.target.value)}
                    />

                    {guardado === conexion.clase && (
                      <Alert variant="info">
                        {t.comun.guardar} <span aria-hidden="true">✓</span>
                      </Alert>
                    )}

                    <Button
                      onClick={() => guardar(conexion)}
                      disabled={
                        !puedeCargar ||
                        guardando === conexion.clase ||
                        !escrito.software ||
                        faltaLaCredencial(conexion)
                      }
                    >
                      {guardando === conexion.clase ? t.comun.guardando : t.comun.guardar}
                    </Button>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </EstadoLista>
    </>
  );
}
