import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { TONO, claseBadgeTono } from '../lib/tonos';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { SelectoresPreferencias } from '../components/layout/SelectoresPreferencias';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { useModalAccesible } from '../hooks/useModalAccesible';

/* PANTALLA DE MUESTRA DEL SISTEMA DE DISEÑO — herramienta de desarrollo, no es producto.
   ====================================================================================

   Qué es. Una sola pantalla donde están dibujadas todas las piezas visuales del Panel:
   los cinco tonos de señal, los cuatro estados de una lista, la tabla, los botones, los
   avisos y los carteles. Sirve para dos cosas:

     · mirar el sistema de diseño entero de una vez, en claro y en oscuro, sin tener que
       navegar diez pantallas buscando dónde aparece cada cosa;
     · comprobar que un cambio de color o de espaciado no rompió nada, sin entrar al
       producto ni tocar datos de nadie.

   No pide usuario ni contraseña, y no puede filtrar datos de ninguna Prestadora, porque
   no consulta la base: todo lo que se ve acá está inventado en este mismo archivo.

   POR QUÉ NO DEBILITA LA SEGURIDAD. No es una puerta de atrás al Panel: es una pantalla
   aparte que no lee nada. Y ni siquiera existe en lo que se publica — `App.jsx` la monta
   solo cuando `import.meta.env.DEV` es verdadero, que es únicamente mientras el Panel
   corre en la computadora de quien lo desarrolla. Al compilar para publicar, esa condición
   es falsa, el compilador borra el bloque entero y esta pantalla no viaja al servidor.
   No hay ningún interruptor que alguien pueda dejar mal puesto.

   SOBRE EL IDIOMA. La regla 1 de `CLAUDE.md` §7 prohíbe escribir texto visible a mano, y
   acá hay títulos escritos a mano. No es una excepción a la regla: la regla protege el
   texto del PRODUCTO, y esto no es producto — es una herramienta de trabajo que nunca ve
   una Prestadora, igual que un banco de pruebas. Lo que sí importa es que todo lo que esta
   pantalla DEMUESTRA sale de las fuentes reales: los colores de `variables.css`, los tonos
   de `lib/tonos.js` y los carteles de lista vacía de los archivos de traducción. Si mañana
   se cambia un color o un texto de esos, esta pantalla lo refleja sola. */

// Filas inventadas. Ningún dato real de ninguna Prestadora, Familia, Paciente ni Asistente
// (`CLAUDE.md` §6). Los nombres son de fantasía y los tonos cubren los cinco casos.
const FILAS_DE_MENTIRA = [
  { id: 1, nombre: 'Ana Ficticia', detalle: 'Guardia de mañana', tono: TONO.EXITO, estado: 'Al día' },
  { id: 2, nombre: 'Bruno Inventado', detalle: 'Guardia de tarde', tono: TONO.ATENCION, estado: 'Falta el papel' },
  { id: 3, nombre: 'Carla Imaginaria', detalle: 'Guardia de noche', tono: TONO.CRITICO, estado: 'Vencido' },
  { id: 4, nombre: 'Darío Supuesto', detalle: 'Sin asignar', tono: TONO.INFO, estado: 'Aviso enviado' },
  { id: 5, nombre: 'Elena Hipotética', detalle: '—', tono: TONO.NEUTRO, estado: 'Sin datos' },
];

const TONOS_EXPLICADOS = [
  [TONO.EXITO, 'Está bien, no hay nada que hacer'],
  [TONO.ATENCION, 'Falta algo, mirálo. NO es un error'],
  [TONO.CRITICO, 'Está mal, alguien tiene que actuar'],
  [TONO.INFO, 'Es un dato, ni bueno ni malo'],
  [TONO.NEUTRO, 'No hay información, o no aplica'],
];

function Bloque({ titulo, ayuda, children }) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2>{titulo}</h2>
      {ayuda && <p className="panel-explicacion">{ayuda}</p>}
      {children}
    </section>
  );
}

export function Muestra() {
  const modal = useModalAccesible(() => setModalAbierto(false));
  const { t } = useLocale();
  // El mismo hook que usan las once listas del Panel: así el vacío de abajo es el de verdad,
  // no una imitación.
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '' });
  const [modalAbierto, setModalAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const filasVisibles = FILAS_DE_MENTIRA.filter(
    (fila) => !f.busqueda || fila.nombre.toLowerCase().includes(f.busqueda.toLowerCase())
  );

  return (
    <div className="panel-content" style={{ maxWidth: '68rem', margin: '0 auto' }}>
      <header
        className="panel-header"
        style={{ marginBottom: '2rem', paddingInline: 0, borderRadius: 0 }}
      >
        <span className="panel-usuario">Muestra del sistema de diseño</span>
        <SelectoresPreferencias />
      </header>

      <Alert variant="info">
        Esta pantalla no existe en el Panel publicado. Es una herramienta de desarrollo: no
        pide contraseña porque no consulta la base, todo lo que se ve acá está inventado.
      </Alert>

      <Bloque
        titulo="Los cinco tonos de señal"
        ayuda="No hay un sexto. Los colores salen de variables.css; qué estado del negocio cae en cada tono lo decide lib/tonos.js, y ninguna pantalla más."
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>Cartel</th>
              <th>Nombre del tono</th>
              <th>Qué quiere decir</th>
            </tr>
          </thead>
          <tbody>
            {TONOS_EXPLICADOS.map(([tono, significado]) => (
              <tr key={tono}>
                <td>
                  <span className={claseBadgeTono(tono)}>ejemplo</span>
                </td>
                <td>{tono}</td>
                <td>{significado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Bloque>

      <Bloque
        titulo="Una lista de verdad"
        ayuda="Usa el mismo hook de filtros y el mismo componente de estados que las once listas del Panel. Escribí algo que no exista para ver el vacío de 'el filtro no encontró nada'; borralo para volver."
      >
        <div className="panel-filtros">
          <input
            type="text"
            placeholder={t.comun.buscar}
            aria-label={t.comun.buscar}
            value={f.busqueda}
            onChange={(e) => set('busqueda', e.target.value)}
          />
        </div>

        <EstadoLista
          estado="listo"
          error={null}
          vacio={filasVisibles.length === 0}
          recargar={() => {}}
          filtrado={hayFiltros}
          onLimpiarFiltros={limpiar}
        >
          <table className="panel-tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Detalle</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.map((fila) => (
                <tr key={fila.id}>
                  <td>{fila.nombre}</td>
                  <td>{fila.detalle}</td>
                  <td>
                    <span className={claseBadgeTono(fila.tono)}>{fila.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </EstadoLista>
      </Bloque>

      <Bloque
        titulo="Los otros tres estados de una lista"
        ayuda="Cargando, error y el vacío de 'todavía no hay nada'. Los textos salen de los archivos de traducción, así que cambian con el idioma que elijas arriba."
      >
        <div style={{ display: 'grid', gap: '1rem' }}>
          <EstadoLista estado="cargando" />
          <EstadoLista estado="error" error="Ejemplo de error de conexión" recargar={() => {}} />
          <EstadoLista
            estado="listo"
            vacio
            filtrado={false}
            accionVacio={<Button>Cargar el primero</Button>}
          />
        </div>
      </Bloque>

      <Bloque
        titulo="Botones"
        ayuda="El botón que dispara una operación se deshabilita mientras está en curso (regla 5), para que nadie mande dos veces lo mismo."
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button>Principal</Button>
          <Button variant="secondary">Secundario</Button>
          <Button disabled>Deshabilitado</Button>
          <Button
            disabled={enviando}
            onClick={() => {
              setEnviando(true);
              setTimeout(() => setEnviando(false), 1200);
            }}
          >
            {enviando ? t.comun.cargando : 'Probar el bloqueo al enviar'}
          </Button>
          <Button variant="secondary" onClick={() => setModalAbierto(true)}>
            Abrir un modal
          </Button>
        </div>
      </Bloque>

      <Bloque titulo="Avisos">
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <Alert variant="info">Un dato que conviene saber.</Alert>
          <Alert variant="warning">Algo que hay que mirar antes de seguir.</Alert>
          <Alert variant="error">Algo salió mal.</Alert>
        </div>
      </Bloque>

      <Bloque
        titulo="Tarjetas de número"
        ayuda="Borde de un pixel, nunca una barra gruesa de color al costado: esa barra queda reservada para los estados de guardia."
      >
        <div className="panel-kpis">
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">128</div>
            <div className="panel-kpi-etiqueta">Guardias del mes</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">3</div>
            <div className="panel-kpi-etiqueta">Sin cubrir</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">97%</div>
            <div className="panel-kpi-etiqueta">Cobertura</div>
          </div>
        </div>
      </Bloque>

      {modalAbierto && (
        <div className="panel-modal-fondo" onClick={() => setModalAbierto(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
            <h2 id={modal.idTitulo}>Ejemplo de modal</h2>
            <p className="panel-explicacion">
              El velo de atrás también es un token, así que se oscurece solo cuando la
              pantalla está en modo oscuro.
            </p>
            <div className="panel-modal-acciones">
              <Button variant="secondary" onClick={() => setModalAbierto(false)}>
                {t.comun.cerrar}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
