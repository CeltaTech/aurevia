import test from 'node:test';
import assert from 'node:assert/strict';

import { aviso, CLAVES_DE_AVISO, IDIOMAS_DEL_CATALOGO } from '../avisos.js';
import {
  IDIOMA_POR_DEFECTO,
  IDIOMAS_SOPORTADOS,
  normalizarIdioma,
  idiomaDePais,
  idiomaDelDestinatario,
} from '../idiomas.js';
// El nombre del producto no se escribe a mano en ningún lado, tampoco acá.
import { IDENTIDAD } from '../../config/identidadProducto.js';

// Lo que hace falta para armar cada aviso. No se usa para comprobar qué dice —eso lo decide quien
// escribe el catálogo— sino para poder llamarlos a todos y ver que ninguno se rompe ni deja un
// «undefined» a la vista en alguno de los tres idiomas.
const DATOS = {
  origen_de_alerta: { fuente: 'aviso_telefonico' },
  guardia_sin_cerrar: {
    fecha: '2026-10-07', horaInicio: '08:00', horaFin: '16:00',
    pacientes: ['Elena', 'Alberto'], asistente: 'Marta', minutosDeAtraso: 40,
    salidaMarcada: true, veces: 2,
  },
  guardia_sin_cerrar_grave: {
    fecha: '2026-10-07', horaInicio: '08:00', horaFin: '16:00',
    pacientes: ['Elena'], asistente: 'Marta', minutosDeAtraso: 300, salidaMarcada: false,
  },
  guardia_sin_cerrar_respaldo: { fecha: '2026-10-07', horaInicio: '08:00', horaFin: '16:00', minutosDeAtraso: 90 },
  escalada_a_respaldo: {},
  alerta_temprana_sin_resolver: { guardiaId: 'g-1', origen: 'un origen', motivo: 'no contesta', minutos: 30 },
  alerta_temprana_respaldo: { guardiaId: 'g-1', minutos: 30 },
  aviso_demora_asistente: { fecha: '2026-10-07', horaInicio: '08:00', origen: 'un origen', motivo: 'tránsito' },
  incidente_relevo_sin_resolver: { guardiaId: 'g-1', nivel: 2, minutos: 45 },
  incidente_relevo_respaldo: { guardiaId: 'g-1', minutos: 45 },
  incidente_relevo_fase_automatica: { guardiaId: 'g-1', minutosUmbral: 60 },
  continuidad_de_guardia: {},
  guardia_sin_cubrir: {
    fecha: '2026-10-07', horaInicio: '08:00', horaFin: '16:00', pacientes: ['Elena'],
    yaEmpezo: false, horas: 5,
    busqueda: { ofrecida: true, invitados: 3, sinContestar: 1, aceptaron: 0 },
    veces: 1,
  },
  alerta_ia_coordinador: { esRoja: true },
  alerta_ia_familia: { esRoja: false },
  vencimiento_documentos: {
    etiqueta: 'Carnet sanitario', dias: 30,
    documentos: [{ nombre: 'Marta', fechaVencimiento: '2026-11-01' }],
  },
  mfa_codigo_recuperacion: { codigo: '123456', minutos: 10, producto: IDENTIDAD.nombre },
  codigo_instruccion_circulo: { codigo: '123456', minutos: 10, remite: 'Cuidados del Sur' },
  activacion_cuenta: {
    nombre: 'Elena', link: 'https://ejemplo/activar', dias: 7,
    empresa: 'Cuidados del Sur', producto: IDENTIDAD.nombre, conMarcaDelProducto: true,
  },
  estado_postulacion: { empresa: 'Cuidados del Sur', nombre: 'Marta', estado: 'aprobado' },
  nueva_postulacion_asistente: {
    nombre: 'Marta', dni: '11222333', telefono: '1150000000', email: 'marta@ejemplo',
    especialidades: 'Acompañante', zonas: 'Sur', disponibilidad: 'Mañanas',
    situacionFiscal: 'Monotributo',
  },
  nueva_solicitud_servicio: {
    nombre: 'Elena', telefono: '1150000000', email: 'elena@ejemplo', localidad: 'Quilmes',
    tipoServicio: 'Acompañamiento', modalidad: 'Por hora', diasHorario: 'Lunes a viernes',
    descripcion: 'Dos turnos por semana',
  },
  mensaje_del_coordinador: {},
  guardia_asignada: { fecha: '2026-10-07', horaInicio: '08:00' },
  recordatorio_de_guardia: { fecha: '2026-10-07', horaInicio: '08:00' },
  fin_periodo_sin_cargo: { dia: '7/10/2026', importe: '4500.00 ARS' },
  cobro_no_realizado: { importe: '4500.00 ARS', dia: '7/10/2026' },
};

// Sin esto, un aviso que existe en castellano y no en portugués saldría en castellano sin que
// nadie se entere: el catálogo contestaría igual y nadie vería el hueco hasta que lo lea alguien
// que no habla castellano.
test('los tres idiomas tienen exactamente las mismas claves', () => {
  assert.deepEqual([...IDIOMAS_DEL_CATALOGO].sort(), [...IDIOMAS_SOPORTADOS].sort());
  for (const idioma of IDIOMAS_DEL_CATALOGO) {
    for (const clave of CLAVES_DE_AVISO) {
      assert.doesNotThrow(() => aviso(clave, idioma, DATOS[clave]), `falta ${clave} en ${idioma}`);
    }
  }
});

test('la lista de datos de prueba cubre todas las claves del catálogo', () => {
  assert.deepEqual([...CLAVES_DE_AVISO].sort(), Object.keys(DATOS).sort());
});

test('ningún aviso deja un hueco a la vista en ninguno de los tres idiomas', () => {
  for (const idioma of IDIOMAS_DEL_CATALOGO) {
    for (const clave of CLAVES_DE_AVISO) {
      for (const [parte, texto] of Object.entries(aviso(clave, idioma, DATOS[clave]))) {
        assert.equal(typeof texto, 'string', `${clave}.${parte} en ${idioma} no es texto`);
        assert.ok(texto.length > 0, `${clave}.${parte} en ${idioma} está vacío`);
        assert.ok(!texto.includes('undefined'), `${clave}.${parte} en ${idioma} dice «undefined»`);
        assert.ok(!texto.includes('[object Object]'), `${clave}.${parte} en ${idioma} muestra un objeto`);
      }
    }
  }
});

test('un idioma que no está en el catálogo cae en el de por defecto', () => {
  assert.deepEqual(
    aviso('continuidad_de_guardia', 'fr-FR'),
    aviso('continuidad_de_guardia', IDIOMA_POR_DEFECTO)
  );
  assert.deepEqual(
    aviso('continuidad_de_guardia', null),
    aviso('continuidad_de_guardia', IDIOMA_POR_DEFECTO)
  );
});

test('los tres idiomas dicen cosas distintas', () => {
  const titulos = IDIOMAS_DEL_CATALOGO.map((i) => aviso('continuidad_de_guardia', i).titulo);
  assert.equal(new Set(titulos).size, IDIOMAS_DEL_CATALOGO.length);
});

test('una clave que no existe se avisa, no se devuelve vacía', () => {
  assert.throws(() => aviso('un_aviso_que_no_existe', 'es-AR'), /un_aviso_que_no_existe/);
});

test('normalizarIdioma deja pasar los tres y devuelve el de por defecto para el resto', () => {
  for (const idioma of IDIOMAS_SOPORTADOS) assert.equal(normalizarIdioma(idioma), idioma);
  assert.equal(normalizarIdioma('fr-FR'), IDIOMA_POR_DEFECTO);
  assert.equal(normalizarIdioma(undefined), IDIOMA_POR_DEFECTO);
});

test('el idioma sale del país cuando nadie eligió uno', () => {
  assert.equal(idiomaDePais('BR'), 'pt-BR');
  assert.equal(idiomaDePais('br'), 'pt-BR');
  assert.equal(idiomaDePais(' US '), 'en');
  assert.equal(idiomaDePais('AR'), IDIOMA_POR_DEFECTO);
  // Un país sin idioma conocido no deja el aviso sin texto: sale en el de por defecto.
  assert.equal(idiomaDePais('XX'), IDIOMA_POR_DEFECTO);
  assert.equal(idiomaDePais(null), IDIOMA_POR_DEFECTO);
});

test('lo que la persona eligió gana sobre el idioma del lugar', () => {
  assert.equal(idiomaDelDestinatario('en', 'pt-BR'), 'en');
  assert.equal(idiomaDelDestinatario(null, 'pt-BR'), 'pt-BR');
  assert.equal(idiomaDelDestinatario('fr-FR', 'pt-BR'), 'pt-BR');
  assert.equal(idiomaDelDestinatario(null, null), IDIOMA_POR_DEFECTO);
});
