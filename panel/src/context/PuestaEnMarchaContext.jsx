import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import { useTenantSession } from './TenantSessionContext';
import { useModalidades } from './ModalidadesContext';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { llamarApiPanel } from '../lib/apiPanel';
import { llamarApiConfiguracion } from '../lib/apiConfiguracion';
import { esAdminOSuperior } from '../lib/roles';

/* La puesta en marcha de una Prestadora nueva.
   ==========================================================================

   QUÉ CONTESTA. Una sola pregunta, hecha una sola vez: qué le falta cargar a esta Prestadora
   para poder trabajar. De la respuesta cuelgan tres cosas que antes no podían existir porque
   el cálculo vivía adentro de una pantalla: la guía con los ocho pasos, la franja que los
   reclama desde cualquier pantalla del Panel, y la entrada, que mientras falte algo lleva a
   completarlo en vez de a una grilla de guardias vacía.

   POR QUÉ ES UN CONTEXTO Y NO UN COMPONENTE. Hasta ahora estos ocho pasos se calculaban
   adentro de `components/estado-actual/GuiaPrimerosPasos.jsx`, que es el único lugar que los
   mostraba. En el momento en que además hay que reclamarlos desde el Layout y decidir a dónde
   entra el Panel, ese cálculo pasa a tener tres consumidores, y copiarlo dos veces sería
   justamente lo que prohíbe el punto único de verdad (`celtatech/CLAUDE.md` §8). La pregunta se
   hace acá; las tres pantallas la consumen.

   NO HAY TABLA DE HITOS, Y NO SE VA A AGREGAR. Cada paso se deriva en vivo de los mismos datos
   que ya leen las pantallas de siempre —La Prestadora, Zonas, Lista de precios, Asistentes,
   Familias, Usuarios del Panel—. Anotar «esta Prestadora ya completó lo mínimo» en una columna
   abre la puerta a que esa columna diga que sí mientras la Prestadora borró sus zonas: dos
   fuentes de verdad para el mismo hecho, y la que miente es siempre la anotada. Derivarlo no se
   puede desactualizar.

   QUIÉN PREGUNTA. Sólo Admin_prestadora o Superadmin, que son los únicos que pueden completar
   alguno de los pasos. Con un Coordinador esto no consulta nada: no le vamos a cobrar seis
   consultas por entrar para después no mostrarle nada. */

const PuestaEnMarchaContext = createContext(null);

const COLUMNAS_LISTA_PRECIOS = 'id, activo';
const COLUMNAS_ASISTENTES = 'id, tipo_asistente_id';
const COLUMNAS_FAMILIAS = 'id, deleted_at';

/* El orden de los pasos es el orden en que se muestran y en que se reclaman, y no sale de
   ninguna tabla: cada paso es una pregunta distinta hecha a datos distintos, no un renglón
   configurable.

   POR QUÉ LA MODALIDAD VA PRIMERO. Es el paso del que dependen los otros siete: la modalidad
   decide qué pantallas existen para esa Prestadora, y por lo tanto qué significa cargar
   precios, zonas o Familias. Elegirla al final obliga a revisar hacia atrás lo ya cargado.

   `clave` nombra la clave de i18n de ese paso (`t.guia_primeros_pasos.paso_<clave>_*`), y esos
   textos incluyen la consecuencia de no completarlo: qué deja de funcionar mientras falte. Cada
   consecuencia está verificada contra el código que la produce, no supuesta — la de los tipos
   de Asistente sale de `backend/src/routes/panelCuentas.js:194`, donde el tipo es lo que decide
   si a esa persona se le exige matrícula, y la de las zonas de
   `backend/src/routes/configuracionPublica.js:17`, que es de donde el formulario público saca
   las que puede ofrecer. */
function armarPasos({ modalidades, empresa, zonas, precios, gente, familias, hayCoordinador }) {
  // «Sus tipos de Asistente» se da por resuelto mientras no haya ningún Asistente sin
  // clasificar — el mismo criterio que usa `pages/Asistentes.jsx` (`sinTipo`). Con cero
  // Asistentes cargados el paso queda resuelto: los cuatro tipos de fábrica ya sirven sin que
  // la Prestadora toque nada, así que exigir un tipo propio acá dejaría a muchas Prestadoras
  // legítimas sin poder completar nunca este paso.
  const sinTipo = gente.filter((a) => !a.tipo_asistente_id);

  return [
    {
      clave: 'modalidad',
      hecho: modalidades.includes('directa') || modalidades.includes('marketplace'),
      ruta: '/configuracion',
    },
    {
      clave: 'datos',
      hecho: Boolean(empresa?.telefono) && Boolean(empresa?.email),
      ruta: '/configuracion/prestadora',
    },
    { clave: 'zonas', hecho: zonas.length > 0, ruta: '/configuracion/prestadora' },
    { clave: 'precios', hecho: precios.some((p) => p.activo), ruta: '/lista-precios' },
    { clave: 'gente', hecho: gente.length > 0, ruta: '/asistentes' },
    { clave: 'tipos', hecho: sinTipo.length === 0, ruta: '/asistentes' },
    { clave: 'familia', hecho: familias.some((f) => !f.deleted_at), ruta: '/familias' },
    { clave: 'equipo', hecho: hayCoordinador, ruta: '/usuarios-panel' },
  ];
}

export function PuestaEnMarchaProvider({ children }) {
  const { usuario } = useAuth();
  const { sesion } = useTenantSession();
  const { modalidades, cargado: modalidadesCargadas } = useModalidades();
  const prestadoraId = usePrestadoraActual();

  // Un Superadmin mirando por una sesión de soporte ve el estado de la Prestadora que visita,
  // pero la guía no es un trabajo para él: los botones de acción no se le muestran.
  const informativo = sesion !== null;
  const corresponde = esAdminOSuperior(usuario?.rol) && Boolean(prestadoraId);

  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [datos, setDatos] = useState(null);

  const cargar = useCallback(async () => {
    if (!corresponde || !modalidadesCargadas) return;
    setEstado('cargando');

    // Las seis preguntas van juntas: son independientes entre sí y encadenarlas sólo haría
    // esperar seis veces seguidas a quien está entrando al Panel.
    const [empresa, equipo, zonas, precios, gente, familias] = await Promise.all([
      llamarApiConfiguracion('/empresa').then((r) => r?.empresa ?? null),
      llamarApiPanel('/usuarios').then((r) => r?.usuarios ?? []),
      supabase.from('zonas_cobertura').select('id').eq('prestadora_id', prestadoraId).eq('activa', true),
      supabase.from('lista_precios').select(COLUMNAS_LISTA_PRECIOS),
      supabase.from('asistentes').select(COLUMNAS_ASISTENTES),
      supabase.from('familias').select(COLUMNAS_FAMILIAS),
    ]).catch(() => null);

    if (!empresa && !equipo) {
      // Nada de lo que muestra la guía es indispensable para trabajar, así que una consulta
      // fallida no se convierte en un cartel de error encima de la pantalla de entrada: se deja
      // el estado en error, y quien lo consume decide no mostrar nada.
      setEstado('error');
      return;
    }

    setDatos({
      empresa,
      hayCoordinador: (equipo ?? []).some((u) => u.rol === 'coordinador'),
      zonas: zonas?.data ?? [],
      precios: precios?.data ?? [],
      gente: gente?.data ?? [],
      familias: familias?.data ?? [],
    });
    setEstado('listo');
  }, [corresponde, modalidadesCargadas, prestadoraId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const valor = useMemo(() => {
    if (!corresponde) {
      // Con un Coordinador no falta nada que él pueda completar, y eso es lo mismo que decir
      // que para él la puesta en marcha no existe: ni franja, ni redirección, ni guía.
      return { estado: 'listo', pasos: [], faltan: [], completos: true, informativo, recargar: cargar };
    }
    if (estado !== 'listo' || !datos) {
      // Mientras no se sabe, no falta nada. Es el sentido seguro: lo contrario haría aparecer
      // la franja de reclamo por un instante en cada carga, y mandaría a completar su
      // configuración a una Prestadora que ya la tiene completa.
      return { estado, pasos: [], faltan: [], completos: true, informativo, recargar: cargar };
    }
    const pasos = armarPasos({ ...datos, modalidades });
    const faltan = pasos.filter((p) => !p.hecho);
    return { estado, pasos, faltan, completos: faltan.length === 0, informativo, recargar: cargar };
  }, [corresponde, estado, datos, modalidades, informativo, cargar]);

  return <PuestaEnMarchaContext.Provider value={valor}>{children}</PuestaEnMarchaContext.Provider>;
}

export function usePuestaEnMarcha() {
  const ctx = useContext(PuestaEnMarchaContext);
  if (!ctx) throw new Error('usePuestaEnMarcha debe usarse dentro de PuestaEnMarchaProvider');
  return ctx;
}
