import { describe, expect, it } from 'vitest';
import {
  MOTIVO_SOLICITUD,
  PESOS_SOLICITUD,
  asistentesParaSolicitud,
} from '../asistentesParaSolicitud';
import { nombranLoMismo } from '../textoComparable';
import { T } from '../../i18n/translations';

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

// Datos inventados, como manda CLAUDE.md §6: ninguna persona real entra en una prueba.
const SOLICITUD = {
  id: 1,
  localidad: 'San Isidro',
  tipo_servicio: 'Cuidado domiciliario',
};

const asistente = (extra) => ({
  id: extra.id ?? 'a',
  nombre: extra.nombre ?? 'Nombre Inventado',
  estado: 'activo',
  zonas: ['San Isidro'],
  especialidades: ['Cuidado domiciliario'],
  ...extra,
});

const clavesDe = (fila) => [...fila.aFavor, ...fila.enContra];

describe('asistentesParaSolicitud', () => {
  it('pone primero a quien cubre la zona, hace el servicio y se ofrece', () => {
    const encaja = asistente({ id: 'encaja', nombre: 'Aaa' });
    const lejos = asistente({ id: 'lejos', nombre: 'Bbb', zonas: ['Bahía Blanca'] });
    const orden = asistentesParaSolicitud(SOLICITUD, [lejos, encaja]);
    expect(orden.map((f) => f.asistente.id)).toEqual(['encaja', 'lejos']);
    expect(orden[0].aFavor).toEqual([
      MOTIVO_SOLICITUD.CUBRE_LA_ZONA,
      MOTIVO_SOLICITUD.TIENE_LA_ESPECIALIDAD,
      MOTIVO_SOLICITUD.SE_OFRECE,
    ]);
    expect(orden[0].puntaje).toBe(
      PESOS_SOLICITUD.zona + PESOS_SOLICITUD.especialidad + PESOS_SOLICITUD.disponible,
    );
  });

  // Lo mismo que hace `candidatos.js`: quien no encaja queda al fondo con el motivo, porque una
  // lista que esconde gente deja sin respuesta a quien pregunta por qué no está fulana.
  it('deja en la lista a quien no encaja, con el motivo', () => {
    const [fila] = asistentesParaSolicitud(SOLICITUD, [
      asistente({ zonas: ['Bahía Blanca'], especialidades: ['Kinesiología'] }),
    ]);
    expect(fila.enContra).toContain(MOTIVO_SOLICITUD.OTRA_ZONA);
    expect(fila.enContra).toContain(MOTIVO_SOLICITUD.OTRA_ESPECIALIDAD);
  });

  it('saca de la lista a quien ya no trabaja en la Prestadora', () => {
    const plantel = [
      asistente({ id: 'sigue' }),
      asistente({ id: 'inactivo', estado: 'inactivo' }),
      asistente({ id: 'cesado', estado: 'cesado' }),
    ];
    expect(asistentesParaSolicitud(SOLICITUD, plantel).map((f) => f.asistente.id)).toEqual([
      'sigue',
    ]);
  });

  // Que la ficha no tenga el dato y que la ficha diga otra cosa son dos cosas distintas, y
  // contarlas como una sería afirmar algo que nadie cargó.
  it('distingue la ficha sin datos cargados de la ficha que dice otra cosa', () => {
    const [sinNada] = asistentesParaSolicitud(SOLICITUD, [
      asistente({ zonas: [], especialidades: null }),
    ]);
    expect(sinNada.enContra).toContain(MOTIVO_SOLICITUD.SIN_ZONAS_CARGADAS);
    expect(sinNada.enContra).toContain(MOTIVO_SOLICITUD.SIN_ESPECIALIDADES_CARGADAS);
    expect(sinNada.enContra).not.toContain(MOTIVO_SOLICITUD.OTRA_ZONA);
  });

  it('dice quién se apagó de las ofertas, y no lo esconde', () => {
    const [fila] = asistentesParaSolicitud(SOLICITUD, [
      asistente({ disponible_para_ofertas: false }),
    ]);
    expect(fila.enContra).toContain(MOTIVO_SOLICITUD.NO_SE_OFRECE);
    expect(fila.puntaje).toBe(PESOS_SOLICITUD.zona + PESOS_SOLICITUD.especialidad);
  });

  // La columna llegó después: una ficha vieja, o una consulta que no la pidió, no significa que
  // esa persona se haya puesto no disponible.
  it('no da por apagado a quien llegó sin esa columna', () => {
    const [fila] = asistentesParaSolicitud(SOLICITUD, [asistente({})]);
    expect(fila.aFavor).toContain(MOTIVO_SOLICITUD.SE_OFRECE);
  });

  it('no cruza lo que la Solicitud dejó en blanco', () => {
    const [fila] = asistentesParaSolicitud({ localidad: '', tipo_servicio: '' }, [asistente({})]);
    expect(clavesDe(fila)).toEqual([MOTIVO_SOLICITUD.SE_OFRECE]);
  });

  it('la zona pesa más que la especialidad', () => {
    const misma = asistente({ id: 'zona', nombre: 'Zzz', especialidades: ['Kinesiología'] });
    const especialista = asistente({ id: 'especialidad', nombre: 'Aaa', zonas: ['Bahía Blanca'] });
    const orden = asistentesParaSolicitud(SOLICITUD, [especialista, misma]);
    expect(orden.map((f) => f.asistente.id)).toEqual(['zona', 'especialidad']);
  });

  it('desempata por nombre, para que la lista no baile entre dos recargas', () => {
    const orden = asistentesParaSolicitud(SOLICITUD, [
      asistente({ id: 'b', nombre: 'Bbb' }),
      asistente({ id: 'a', nombre: 'Aaa' }),
    ]);
    expect(orden.map((f) => f.asistente.id)).toEqual(['a', 'b']);
  });

  it('no se cae sin Solicitud ni sin plantel', () => {
    expect(asistentesParaSolicitud(null, [asistente({})])).toEqual([]);
    expect(asistentesParaSolicitud(SOLICITUD, undefined)).toEqual([]);
  });
});

describe('nombranLoMismo', () => {
  it('acerca lo que dos personas escribieron distinto', () => {
    expect(nombranLoMismo('Enfermería', 'ENFERMERIA')).toBe(true);
    expect(nombranLoMismo('San Isidro', 'san  isidro.')).toBe(true);
  });

  it('acepta que una punta escriba de más', () => {
    expect(nombranLoMismo('Zona Norte', 'Norte')).toBe(true);
    expect(nombranLoMismo('Cuidado domiciliario nocturno', 'Cuidado domiciliario')).toBe(true);
  });

  it('no coincide con nada cuando falta el dato', () => {
    expect(nombranLoMismo('', 'San Isidro')).toBe(false);
    expect(nombranLoMismo(null, undefined)).toBe(false);
  });

  it('no junta dos cosas distintas', () => {
    expect(nombranLoMismo('San Isidro', 'Bahía Blanca')).toBe(false);
  });
});

describe('los motivos existen en los tres idiomas', () => {
  it.each(IDIOMAS)('%s explica cada motivo de la sugerencia', (idioma) => {
    const textos = T[idioma].solicitudes.sugeridos;
    expect(textos).toBeTruthy();
    for (const clave of Object.values(MOTIVO_SOLICITUD)) {
      expect(typeof textos[`motivo_${clave}`], `falta motivo_${clave} en ${idioma}`).toBe('string');
      expect(textos[`motivo_${clave}`].length).toBeGreaterThan(0);
    }
  });
});
