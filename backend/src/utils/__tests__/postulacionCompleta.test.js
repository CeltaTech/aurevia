/**
 * Pruebas de lo que se comprueba antes de guardar una postulación.
 *
 * Cuentas puras: no arrancan el servidor ni la base. Todos los datos son inventados.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { aniosCumplidos, cuilValido, revisarPostulacion } from '../postulacionCompleta.js';

const HOY = '2026-09-15';

// Persona inventada. El CUIL lleva el dígito verificador que le corresponde a ese documento.
const COMPLETA = {
  nombre: 'Ada Ponce',
  dni: '30111222',
  telefono: '+54 9 11 5555 0000',
  email: 'ada.ponce@ejemplo.test',
  especialidades: 'Cuidado de adultos mayores',
  zonas: 'Zona Norte',
  disponibilidad: 'Lunes a viernes, mañana',
  situacion_fiscal: 'monotributo',
  fecha_nacimiento: '1990-03-20',
};

const OPCIONES = [
  { grupo: 'genero', clave: 'femenino', activo: true },
  { grupo: 'nacionalidad', clave: 'argentina', activo: true },
  { grupo: 'tipo_registro_afip', clave: 'monotributo_social', activo: true },
  { grupo: 'experiencia_clinica_patologias', clave: 'demencias', activo: true },
  { grupo: 'experiencia_clinica_cuidado_directo', clave: 'higiene', activo: true },
  { grupo: 'genero', clave: 'retirada', activo: false },
];

function revisar(extra = {}, contexto = {}) {
  return revisarPostulacion({ ...COMPLETA, ...extra }, { opciones: OPCIONES, hoy: HOY, ...contexto });
}

describe('aniosCumplidos', () => {
  it('cuenta los años cumplidos', () => {
    assert.equal(aniosCumplidos('1990-03-20', HOY), 36);
  });

  it('el día antes del cumpleaños todavía no los cumplió', () => {
    assert.equal(aniosCumplidos('2008-09-16', HOY), 17);
  });

  it('el mismo día del cumpleaños ya los cumplió', () => {
    assert.equal(aniosCumplidos('2008-09-15', HOY), 18);
  });
});

describe('cuilValido', () => {
  it('acepta el CUIL que le corresponde al documento', () => {
    assert.equal(cuilValido('27-30111222-5', '30111222'), true);
  });

  it('lo acepta igual escrito sin guiones', () => {
    assert.equal(cuilValido('27301112225', '30111222'), true);
  });

  it('rechaza un dígito verificador que no cierra', () => {
    assert.equal(cuilValido('27-30111222-9', '30111222'), false);
  });

  it('rechaza un CUIL que cierra bien pero es de otro documento', () => {
    assert.equal(cuilValido('27-30111223-3', '30111223'), true);
    assert.equal(cuilValido('27-30111223-3', '30111222'), false);
  });
});

describe('revisarPostulacion', () => {
  it('con lo obligatorio escrito, pasa y devuelve los datos listos', () => {
    const { error, datos } = revisar();
    assert.equal(error, null);
    assert.equal(datos.nombre, 'Ada Ponce');
    assert.equal(datos.fecha_nacimiento, '1990-03-20');
    assert.deepEqual(datos.estudios, []);
    assert.equal(datos.disponible_urgencias, false);
  });

  it('sin fecha de nacimiento no entra', () => {
    assert.equal(revisar({ fecha_nacimiento: undefined }).error, 'campos_obligatorios_faltantes');
  });

  it('una fecha que no existe se rechaza', () => {
    assert.equal(revisar({ fecha_nacimiento: '1990-02-31' }).error, 'fecha_nacimiento_invalida');
  });

  it('con edad mínima vigente, quien no la alcanza queda afuera', () => {
    const { error } = revisar({ fecha_nacimiento: '2008-09-16' }, { edadMinima: 18 });
    assert.equal(error, 'menor_de_edad');
  });

  it('y quien la alcanza justo ese día entra', () => {
    assert.equal(revisar({ fecha_nacimiento: '2008-09-15' }, { edadMinima: 18 }).error, null);
  });

  it('sin edad mínima vigente no se inventa ninguna: nadie se rechaza por edad', () => {
    assert.equal(revisar({ fecha_nacimiento: '2012-01-01' }).error, null);
  });

  it('el CUIL es optativo, pero si viene tiene que cerrar', () => {
    assert.equal(revisar({ cuil: '' }).error, null);
    assert.equal(revisar({ cuil: '27-30111222-9' }).error, 'cuil_invalido');
  });

  it('el CUIL se guarda en sus once dígitos, sin guiones', () => {
    assert.equal(revisar({ cuil: '27-30111222-5' }).datos.cuil, '27301112225');
  });

  it('una opción que no está en el catálogo de la Prestadora no entra', () => {
    assert.equal(revisar({ genero: 'femenino' }).error, null);
    assert.equal(revisar({ genero: 'inventado' }).error, 'genero_no_es_una_opcion');
    assert.equal(revisar({ nacionalidad: 'inventada' }).error, 'nacionalidad_no_es_una_opcion');
  });

  it('una opción dada de baja ya no se puede elegir', () => {
    assert.equal(revisar({ genero: 'retirada' }).error, 'genero_no_es_una_opcion');
  });

  it('la experiencia clínica se comprueba contra todos sus subgrupos', () => {
    assert.equal(revisar({ experiencia_clinica: ['demencias', 'higiene'] }).error, null);
    assert.equal(revisar({ experiencia_clinica: ['otra'] }).error, 'experiencia_clinica_no_es_una_opcion');
  });

  it('las listas del formulario tienen que ser listas de renglones completos', () => {
    assert.equal(revisar({ estudios: [{ institucion: 'Instituto de ejemplo', titulo: 'Auxiliar' }] }).error, null);
    assert.equal(revisar({ estudios: [{ institucion: 'Instituto de ejemplo' }] }).error, 'estudios_mal_formados');
    assert.equal(revisar({ estudios: 'un texto' }).error, 'estudios_mal_formados');
    assert.equal(revisar({ experiencia_laboral: [{ empleador: 'Casa de ejemplo' }] }).error, 'experiencia_laboral_mal_formada');
  });

  it('las referencias son hasta cinco', () => {
    const una = { nombre: 'Referencia inventada', telefono: '11 5555 0001' };
    assert.equal(revisar({ referencias_laborales: Array(5).fill(una) }).error, null);
    assert.equal(revisar({ referencias_laborales: Array(6).fill(una) }).error, 'referencias_mal_formadas');
  });

  it('la distancia máxima tiene que ser una distancia', () => {
    assert.equal(revisar({ distancia_maxima_km: 15 }).datos.distancia_maxima_km, 15);
    assert.equal(revisar({ distancia_maxima_km: 0 }).error, 'distancia_maxima_invalida');
    assert.equal(revisar({ distancia_maxima_km: 'lejos' }).error, 'distancia_maxima_invalida');
  });

  it('el punto del mapa viaja entero o no viaja', () => {
    assert.equal(revisar({ lat: -34.6, lng: -58.4 }).error, null);
    assert.equal(revisar({ lat: -34.6 }).error, 'ubicacion_invalida');
    assert.equal(revisar({ lat: -200, lng: -58.4 }).error, 'ubicacion_invalida');
  });

  it('las tres disponibilidades sólo son ciertas si llegan como tales', () => {
    const { datos } = revisar({ disponible_urgencias: true, disponible_sin_retiro: 'sí' });
    assert.equal(datos.disponible_urgencias, true);
    assert.equal(datos.disponible_sin_retiro, false);
  });

  it('ningún motivo de rechazo nombra una tabla ni una columna de la base', () => {
    const motivos = [
      revisar({ dni: 'abc' }).error,
      revisar({ fecha_nacimiento: '1990-02-31' }).error,
      revisar({ cuil: '27-30111222-9' }).error,
    ];
    for (const motivo of motivos) {
      assert.ok(motivo && !motivo.includes('postulaciones') && !motivo.includes('opciones_postulacion'));
    }
  });
});
