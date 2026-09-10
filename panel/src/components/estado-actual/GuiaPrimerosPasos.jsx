import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { useTenantSession } from '../../context/TenantSessionContext';
import { useModalidades } from '../../context/ModalidadesContext';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { useZonasCobertura } from '../../hooks/useZonasCobertura';
import { useSupabaseTable } from '../../hooks/useSupabaseTable';
import { llamarApiPanel } from '../../lib/apiPanel';
import { llamarApiConfiguracion } from '../../lib/apiConfiguracion';
import { mensajeDeError } from '../../lib/errores';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PropuestaDesdePlanilla } from './PropuestaDesdePlanilla';

/* La guía de primeros pasos de una Prestadora nueva (pendiente #139).
   ==========================================================================

   POR QUÉ EXISTE. Una Prestadora recién creada entraba al Estado actual —la pantalla de
   entrada del Panel, ver App.jsx— y se encontraba una grilla de guardias vacía, sin ningún
   indicio de qué cargar primero. Todo lo que se muestra acá se deriva en vivo de los mismos
   datos que ya leen otras pantallas (La Prestadora, Zonas, Lista de precios, Asistentes,
   Familias, Usuarios del Panel) — nunca de una tabla de "hitos" nueva, para no duplicar la
   fuente de verdad de «¿esta Prestadora ya cargó su primer X?» (`celtatech/CLAUDE.md`, punto
   único de verdad).

   GUÍA HAY UNA SOLA. Hasta el 2026-09-09 hubo dos: ésta y un `OnboardingChecklist` adentro de
   `pages/Dashboard.jsx`, con otros cuatro pasos —modalidad, Asistente, Familia, equipo— y en
   otra pantalla, `/resumen-del-mes`, que dejó de ser la de entrada. Eran el mismo componente
   escrito dos veces y le mostraban a la misma Prestadora dos listas distintas de «primeros
   pasos» según en qué pantalla estuviera. Se fundieron acá: los ocho pasos, una sola vez, en
   la pantalla de entrada. El paso «primer Asistente» estaba en las dos y quedó uno solo.

   POR QUÉ «ELEGIR MODALIDAD» VA PRIMERO. Es el paso del que dependen los otros siete: la
   modalidad decide qué pantallas existen para esa Prestadora, y por lo tanto qué significa
   cargar precios, zonas o Familias. Elegirla al final obliga a revisar hacia atrás lo que ya
   se cargó; elegirla primero deja el resto de la guía hablando de lo que esa Prestadora
   efectivamente va a usar.

   Y LEE PLANILLAS. Lo que la Prestadora ya tiene escrito no se vuelve a tipear: la lectura de
   planilla del producto —la misma de la pantalla de importación— cuelga acá abajo, en
   `PropuestaDesdePlanilla`, y propone la configuración inicial a partir del archivo. No crea
   nada: quien confirma sigue siendo una persona, en la pantalla de importación.

   QUIÉN LA VE. Solo Admin_prestadora o Superadmin (candado igual al de Configuración, ver
   `soloAdministracion` en el motor) — el Coordinador nunca la ve, ni siquiera cuando falta
   algo, porque no puede completar ninguno de los pasos. Ese candado se aplica en
   `EstadoActual.jsx`, que es quien decide si monta este componente: acá adentro no hace falta
   repetir la pregunta por el rol.

   ADMIN_PRESTADORA VS. SUPERADMIN DE VISITA. Quien entra con su propia Prestadora puede tocar
   cada paso; un Superadmin mirando por una sesión de soporte técnico ve exactamente lo mismo
   pero sin botones de acción — la guía es de la Prestadora que visita, no un trabajo para él. */

const COLUMNAS_LISTA_PRECIOS = 'id, activo';
const COLUMNAS_ASISTENTES = 'id, tipo_asistente_id';
const COLUMNAS_FAMILIAS = 'id, deleted_at';

export function GuiaPrimerosPasos() {
  const { t } = useLocale();
  const { sesion } = useTenantSession();
  const { tieneModalidad, cargado: modalidadesCargadas } = useModalidades();
  const prestadoraId = usePrestadoraActual();
  const informativo = sesion !== null;

  const zonas = useZonasCobertura(prestadoraId);
  const precios = useSupabaseTable('lista_precios', { orderBy: 'created_at', select: COLUMNAS_LISTA_PRECIOS });
  const gente = useSupabaseTable('asistentes', { orderBy: 'created_at', select: COLUMNAS_ASISTENTES });
  const familias = useSupabaseTable('familias', { orderBy: 'created_at', select: COLUMNAS_FAMILIAS });

  const [empresaEstado, setEmpresaEstado] = useState('cargando');
  const [empresaError, setEmpresaError] = useState(null);
  const [empresa, setEmpresa] = useState(null);

  const cargarEmpresa = useCallback(async () => {
    setEmpresaEstado('cargando');
    setEmpresaError(null);
    try {
      const resultado = await llamarApiConfiguracion('/empresa');
      setEmpresa(resultado?.empresa ?? null);
      setEmpresaEstado('listo');
    } catch (err) {
      setEmpresaError(mensajeDeError(err, t));
      setEmpresaEstado('error');
    }
  }, [t]);

  useEffect(() => {
    cargarEmpresa();
  }, [cargarEmpresa]);

  // Quién es parte del equipo de esta Prestadora sale de la misma ruta que usa la pantalla de
  // Usuarios del Panel, por `lib/apiPanel.js`. Antes el Resumen del mes repetía acá el `fetch`,
  // la sesión y los encabezados; ese camino está escrito una sola vez y se reutiliza.
  const [equipoEstado, setEquipoEstado] = useState('cargando');
  const [equipoError, setEquipoError] = useState(null);
  const [equipoTieneCoordinador, setEquipoTieneCoordinador] = useState(false);

  const cargarEquipo = useCallback(async () => {
    setEquipoEstado('cargando');
    setEquipoError(null);
    try {
      const resultado = await llamarApiPanel('/usuarios');
      setEquipoTieneCoordinador((resultado?.usuarios ?? []).some((u) => u.rol === 'coordinador'));
      setEquipoEstado('listo');
    } catch (err) {
      setEquipoError(mensajeDeError(err, t));
      setEquipoEstado('error');
    }
  }, [t]);

  useEffect(() => {
    cargarEquipo();
  }, [cargarEquipo]);

  function recargarTodo() {
    cargarEmpresa();
    cargarEquipo();
    zonas.recargar();
    precios.recargar();
    gente.recargar();
    familias.recargar();
  }

  const estados = [
    empresaEstado,
    equipoEstado,
    zonas.estado,
    precios.estado,
    gente.estado,
    familias.estado,
    modalidadesCargadas ? 'listo' : 'cargando',
  ];
  const estado = estados.includes('error') ? 'error' : estados.includes('cargando') ? 'cargando' : 'listo';

  if (estado === 'cargando') {
    return <p className="estado-cargando">{t.comun.cargando}</p>;
  }

  if (estado === 'error') {
    return (
      <Alert variant="error">
        {empresaError ||
          equipoError ||
          zonas.error ||
          precios.error ||
          gente.error ||
          familias.error ||
          t.comun.error_generico}{' '}
        <Button variant="secondary" onClick={recargarTodo}>
          {t.comun.reintentar}
        </Button>
      </Alert>
    );
  }

  // «Sus tipos de Asistente» se da por resuelto mientras no haya ningún Asistente sin
  // clasificar todavía — el mismo criterio que ya usa `pages/Asistentes.jsx` (`sinTipo`) para
  // ofrecer pasarlos al catálogo. Con cero Asistentes cargados el paso queda resuelto: los
  // cuatro tipos de fábrica ya sirven sin que la Prestadora toque nada (ver
  // `pages/configuracion/TiposAsistenteTab.jsx`), así que exigir un tipo propio acá dejaría a
  // muchas Prestadoras legítimas sin poder completar nunca este paso.
  const sinTipo = gente.filas.filter((a) => !a.tipo_asistente_id);

  // El orden de esta lista es el orden en que se muestra la guía, y no sale de ninguna tabla:
  // no hay catálogo de pasos en la base, porque cada paso es una pregunta distinta hecha a
  // datos distintos (ver arriba) y no un renglón configurable. Primero la modalidad, por el
  // motivo escrito en la cabecera del archivo.
  const pasos = [
    {
      key: 'modalidad',
      hecho: tieneModalidad('directa') || tieneModalidad('marketplace'),
      ruta: '/configuracion',
      titulo: t.guia_primeros_pasos.paso_modalidad_titulo,
      explicacion: t.guia_primeros_pasos.paso_modalidad_explicacion,
      cta: t.guia_primeros_pasos.paso_modalidad_cta,
    },
    {
      key: 'datos',
      hecho: Boolean(empresa?.telefono) && Boolean(empresa?.email),
      ruta: '/configuracion/prestadora',
      titulo: t.guia_primeros_pasos.paso_datos_titulo,
      explicacion: t.guia_primeros_pasos.paso_datos_explicacion,
      cta: t.guia_primeros_pasos.paso_datos_cta,
    },
    {
      key: 'zonas',
      hecho: zonas.filas.length > 0,
      ruta: '/configuracion/prestadora',
      titulo: t.guia_primeros_pasos.paso_zonas_titulo,
      explicacion: t.guia_primeros_pasos.paso_zonas_explicacion,
      cta: t.guia_primeros_pasos.paso_zonas_cta,
    },
    {
      key: 'precios',
      hecho: precios.filas.some((p) => p.activo),
      ruta: '/lista-precios',
      titulo: t.guia_primeros_pasos.paso_precios_titulo,
      explicacion: t.guia_primeros_pasos.paso_precios_explicacion,
      cta: t.guia_primeros_pasos.paso_precios_cta,
    },
    {
      key: 'gente',
      hecho: gente.filas.length > 0,
      ruta: '/asistentes',
      titulo: t.guia_primeros_pasos.paso_gente_titulo,
      explicacion: t.guia_primeros_pasos.paso_gente_explicacion,
      cta: t.guia_primeros_pasos.paso_gente_cta,
    },
    {
      key: 'tipos',
      hecho: sinTipo.length === 0,
      ruta: '/asistentes',
      titulo: t.guia_primeros_pasos.paso_tipos_titulo,
      explicacion: t.guia_primeros_pasos.paso_tipos_explicacion,
      cta: t.guia_primeros_pasos.paso_tipos_cta,
    },
    {
      key: 'familia',
      hecho: familias.filas.some((f) => !f.deleted_at),
      ruta: '/familias',
      titulo: t.guia_primeros_pasos.paso_familia_titulo,
      explicacion: t.guia_primeros_pasos.paso_familia_explicacion,
      cta: t.guia_primeros_pasos.paso_familia_cta,
    },
    {
      key: 'equipo',
      hecho: equipoTieneCoordinador,
      ruta: '/usuarios-panel',
      titulo: t.guia_primeros_pasos.paso_equipo_titulo,
      explicacion: t.guia_primeros_pasos.paso_equipo_explicacion,
      cta: t.guia_primeros_pasos.paso_equipo_cta,
    },
  ];

  const completados = pasos.filter((p) => p.hecho).length;
  // Se apaga sola cuando ya está todo — es la condición de cierre del pendiente #139: sin
  // botón de «descartar» a mano, porque no hay nada para descartar una vez que no falta nada.
  if (completados === pasos.length) return null;

  const porcentaje = Math.round((completados / pasos.length) * 100);

  return (
    <div className="onboarding-checklist">
      <div className="onboarding-checklist-header">
        <h2>{informativo ? t.guia_primeros_pasos.titulo_informativo : t.guia_primeros_pasos.titulo}</h2>
        <span className="onboarding-checklist-fraccion">
          {t.guia_primeros_pasos.completados.replace('{n}', completados).replace('{total}', pasos.length)}
        </span>
      </div>
      <div className="onboarding-checklist-barra">
        <div className="onboarding-checklist-barra-relleno" style={{ width: `${porcentaje}%` }} />
      </div>
      <ul className="onboarding-checklist-pasos">
        {pasos.map((paso) => (
          <li key={paso.key} className={`onboarding-paso${paso.hecho ? ' onboarding-paso-hecho' : ''}`}>
            <div className="onboarding-paso-info">
              <span className="onboarding-paso-titulo">{paso.titulo}</span>
              <span className="onboarding-paso-explicacion">{paso.explicacion}</span>
            </div>
            {paso.hecho ? (
              <span className="badge badge-exito">{t.guia_primeros_pasos.paso_completado}</span>
            ) : (
              !informativo && (
                <Link to={paso.ruta} className="btn btn-secondary">
                  {paso.cta}
                </Link>
              )
            )}
          </li>
        ))}
      </ul>
      {/* Sólo para quien puede completar los pasos: un Superadmin de visita mira, no trabaja. */}
      {!informativo && <PropuestaDesdePlanilla />}
    </div>
  );
}
