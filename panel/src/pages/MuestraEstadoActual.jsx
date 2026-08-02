import { useMemo, useState } from 'react';
import { FranjaExcepciones } from '../components/estado-actual/FranjaExcepciones';
import { GrillaGuardias } from './guardias/GrillaGuardias';
import { BarraAccionesMasivas } from './guardias/BarraAccionesMasivas';
import { filtrarPorExcepcion } from '../lib/excepciones';
import { hoyISO, sumarDias } from '../lib/horarios';
import { SelectoresPreferencias } from '../components/layout/SelectoresPreferencias';

/* BANCO DE PRUEBAS DEL ESTADO ACTUAL — herramienta de desarrollo, no es producto.
   ====================================================================================

   Para qué está. Las tres piezas nuevas del Estado actual —la franja de contadores, la grilla
   de guardias y la barra de acciones de a muchos— se pueden mirar acá sin entrar al Panel:
   sin usuario, sin contraseña y sin tocar la base de datos de nadie. Todas las guardias que
   se ven abajo están inventadas en este mismo archivo.

   Por qué hace falta. Estas piezas cambian de aspecto según la hora: un hueco de mañana se
   ve rojo y el mismo hueco dentro de tres semanas se ve naranja. Para comprobar que los once
   casos se dibujan bien haría falta esperar semanas, o ensuciar la base con guardias falsas.
   Acá las fechas se arman relativas al día de hoy, así los once casos aparecen siempre.

   Por qué no debilita la seguridad. Vale exactamente lo mismo que para `Muestra.jsx`: no
   consulta nada, y `App.jsx` la monta solo cuando `import.meta.env.DEV` es verdadero — es
   decir, únicamente mientras el Panel corre en la computadora de quien lo desarrolla. Al
   compilar para publicar, el compilador borra el bloque entero y esta pantalla no viaja al
   servidor. No hay ningún interruptor que alguien pueda dejar mal puesto.

   Sobre el idioma. Los títulos de esta pantalla están escritos a mano, igual que en
   `Muestra.jsx`, y por el mismo motivo: la regla 1 de `CLAUDE.md` §7 protege el texto del
   producto, y esto no es producto. Todo lo que la pantalla DEMUESTRA —los nombres de los
   siete contadores, los textos de la grilla— sale de los archivos de traducción reales. */

const HOY = hoyISO();
const dia = (n) => sumarDias(HOY, n);

// Nombres de fantasía. Ninguna persona real, ninguna Prestadora real (`CLAUDE.md` §6).
const ASISTENTES = [
  { id: 'a1', nombre: 'Ana Ficticia', estado: 'activo', horas_semanales: 48 },
  { id: 'a2', nombre: 'Bruno Inventado', estado: 'activo', horas_semanales: 36 },
  { id: 'a3', nombre: 'Carla Imaginaria', estado: 'activo', horas_semanales: 48 },
];

const ahoraHora = new Date().getHours();
const hh = (n) => `${String(((n % 24) + 24) % 24).padStart(2, '0')}:00`;

/* Las once situaciones del semáforo, una por guardia, armadas para que se den de verdad y no
   por un estado escrito a mano. Las horas se calculan alrededor de la hora actual: así la
   guardia "en curso" está realmente en curso a cualquier hora en que se abra esta pantalla. */
const GUARDIAS = [
  // Huecos: uno para mañana (urgente, dentro de las 48 h) y otro para dentro de tres semanas.
  { id: 'g1', asistente_id: null, paciente_id: 'p1', paciente_nombre: 'Paciente Uno',
    fecha: dia(1), hora_inicio: '08:00', hora_fin: '16:00', estado: 'programada' },
  { id: 'g2', asistente_id: null, paciente_id: 'p2', paciente_nombre: 'Paciente Dos',
    fecha: dia(6), hora_inicio: '22:00', hora_fin: '06:00', estado: 'programada' },

  // Ofrecida con plazo que todavía corre, y ofrecida con el plazo ya vencido.
  { id: 'g3', asistente_id: null, paciente_id: 'p3', paciente_nombre: 'Paciente Tres',
    fecha: dia(3), hora_inicio: '14:00', hora_fin: '22:00', estado: 'programada',
    ofrecida_at: new Date().toISOString(),
    oferta_limite_at: new Date(Date.now() + 36e5).toISOString() },
  { id: 'g4', asistente_id: null, paciente_id: 'p1', paciente_nombre: 'Paciente Uno',
    fecha: dia(2), hora_inicio: '06:00', hora_fin: '14:00', estado: 'programada',
    ofrecida_at: new Date(Date.now() - 864e5).toISOString(),
    oferta_limite_at: new Date(Date.now() - 36e5).toISOString() },

  // En curso de verdad: empezó hace dos horas y termina dentro de seis.
  { id: 'g5', asistente_id: 'a1', asistente_nombre: 'Ana Ficticia', paciente_id: 'p1',
    paciente_nombre: 'Paciente Uno', fecha: HOY, hora_inicio: hh(ahoraHora - 2),
    hora_fin: hh(ahoraHora + 6), estado: 'programada',
    checkin_at: new Date(Date.now() - 2 * 36e5).toISOString() },

  // Llegó tarde: tendría que haber entrado hace tres horas y no marcó.
  { id: 'g6', asistente_id: 'a2', asistente_nombre: 'Bruno Inventado', paciente_id: 'p2',
    paciente_nombre: 'Paciente Dos', fecha: HOY, hora_inicio: hh(ahoraHora - 3),
    hora_fin: hh(ahoraHora + 5), estado: 'programada' },

  // Sin cerrar: entró, terminó hace rato y nunca marcó la salida.
  { id: 'g7', asistente_id: 'a3', asistente_nombre: 'Carla Imaginaria', paciente_id: 'p3',
    paciente_nombre: 'Paciente Tres', fecha: dia(-1), hora_inicio: '08:00', hora_fin: '16:00',
    estado: 'programada', checkin_at: new Date(Date.now() - 30 * 36e5).toISOString() },

  // Ausente, completada y cancelada: los tres casos ya cerrados.
  { id: 'g8', asistente_id: 'a1', asistente_nombre: 'Ana Ficticia', paciente_id: 'p2',
    paciente_nombre: 'Paciente Dos', fecha: dia(-1), hora_inicio: '22:00', hora_fin: '06:00',
    estado: 'ausente' },
  { id: 'g9', asistente_id: 'a2', asistente_nombre: 'Bruno Inventado', paciente_id: 'p1',
    paciente_nombre: 'Paciente Uno', fecha: dia(-1), hora_inicio: '06:00', hora_fin: '14:00',
    estado: 'completada' },
  { id: 'g10', asistente_id: 'a3', asistente_nombre: 'Carla Imaginaria', paciente_id: 'p3',
    paciente_nombre: 'Paciente Tres', fecha: dia(4), hora_inicio: '10:00', hora_fin: '18:00',
    estado: 'cancelada' },

  // Programada normal, y dos que se pisan en la línea de tiempo para ver los carriles.
  { id: 'g11', asistente_id: 'a1', asistente_nombre: 'Ana Ficticia', paciente_id: 'p3',
    paciente_nombre: 'Paciente Tres', fecha: dia(2), hora_inicio: '09:00', hora_fin: '17:00',
    estado: 'programada' },
  { id: 'g12', asistente_id: 'a1', asistente_nombre: 'Ana Ficticia', paciente_id: 'p2',
    paciente_nombre: 'Paciente Dos', fecha: dia(2), hora_inicio: '13:00', hora_fin: '21:00',
    estado: 'programada' },
];

export function MuestraEstadoActual() {
  const [filtro, setFiltro] = useState(null);
  const [vista, setVista] = useState('asistente');
  const [zoom, setZoom] = useState('semana');
  const [dia0, setDia0] = useState(HOY);
  const [seleccionadas, setSeleccionadas] = useState(() => new Set());
  const [ultimaAccion, setUltimaAccion] = useState(null);

  // El reloj se congela una sola vez. Si cada contador mirase su propio `new Date()`, dos
  // números de la misma franja podrían estar hablando de momentos distintos.
  const ctx = useMemo(
    () => ({
      ahora: new Date(),
      asistentesConPapelPorVencer: new Set(['a2']),
      asistentesConPapelVencido: new Set(['a3']),
      guardiasSinReporte: new Set(['g9']),
      diasAviso: 30,
    }),
    []
  );

  const visibles = useMemo(
    () => (filtro ? filtrarPorExcepcion(GUARDIAS, filtro, ctx) : GUARDIAS),
    [filtro, ctx]
  );

  // La grilla manda la guardia entera; acá se guarda solo el id, igual que en el Estado actual.
  function alternar(guardia) {
    const id = guardia?.id ?? guardia;
    setSeleccionadas((previas) => {
      const nuevas = new Set(previas);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.add(id);
      return nuevas;
    });
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Banco de pruebas del Estado actual</h1>
          <p className="panel-explicacion" style={{ margin: 0 }}>
            Datos inventados. No consulta la base. Solo existe en desarrollo.
          </p>
        </div>
        <SelectoresPreferencias />
      </header>

      <FranjaExcepciones
        guardias={GUARDIAS}
        ctx={ctx}
        excepcionActiva={filtro}
        onElegir={setFiltro}
      />

      <GrillaGuardias
        guardias={visibles}
        desde={dia(-2)}
        hasta={dia(6)}
        vista={vista}
        onVista={setVista}
        zoom={zoom}
        onZoom={setZoom}
        diaElegido={dia0}
        onDiaElegido={setDia0}
        ctx={ctx}
        seleccionadas={seleccionadas}
        onAlternarSeleccion={alternar}
        onAbrir={(g) => setUltimaAccion(`abrir ${g.id}`)}
        onMover={(m) => setUltimaAccion(`mover ${JSON.stringify(m)}`)}
      />

      <BarraAccionesMasivas
        seleccionadas={Array.from(seleccionadas)
          .map((id) => GUARDIAS.find((g) => g.id === id))
          .filter(Boolean)}
        asistentes={ASISTENTES}
        onAplicar={async (orden) => {
          setUltimaAccion(`aplicar ${JSON.stringify(orden)}`);
          return { ok: seleccionadas.size, total: seleccionadas.size };
        }}
        onLimpiar={() => setSeleccionadas(new Set())}
      />

      {/* Un hueco abre el panel lateral para cubrirlo; una guardia cubierta abre su detalle.
          Acá no se muestra ninguno de los dos —los dos consultan la base y este banco no
          consulta nada—, pero el nombre de la acción queda escrito abajo para poder comprobar
          que tocar cada tipo de guardia dispara lo que corresponde. */}

      {/* Lo que la pantalla real haría contra la base, acá solo se escribe. Sirve para
          comprobar que arrastrar un chip manda las horas correctas sin guardar nada. */}
      {ultimaAccion && (
        <pre
          style={{
            marginTop: '1.5rem',
            fontSize: '0.75rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {ultimaAccion}
        </pre>
      )}
    </div>
  );
}
