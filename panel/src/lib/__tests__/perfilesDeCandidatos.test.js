/**
 * Las tres formas armadas de ordenar la lista de candidatos.
 *
 *   npx vitest run --dir src/lib   (desde `panel/`)
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Acá se apilan tres capas —los valores de fábrica, lo que corre el
 * perfil elegido y lo que esa Prestadora cambió número por número— y el orden importa: si la capa
 * de abajo tapara a la de arriba, la Prestadora configuraría y no pasaría nada. Y se guarda
 * solamente lo que se corrió, nunca la tabla entera: guardar los cuarenta números congelaría los
 * valores de fábrica el día que alguien abra la pantalla y le dé a guardar sin tocar nada.
 */
import { describe, expect, it } from 'vitest';
import {
  NOMBRES_DE_PERFIL,
  PERFILES,
  PERFIL_POR_DEFECTO,
  PESOS,
  PESOS_QUE_SE_PUEDEN_TOCAR,
  TOPES,
  TOPES_QUE_SE_PUEDEN_TOCAR,
  pesosYTopesDe,
  revisarCambios,
  soloLoQueCorreDelPerfil,
} from '../perfilesDeCandidatos';

describe('las tres capas, y la última manda', () => {
  it('sin nada guardado salen los valores de fábrica', () => {
    const { perfil, pesos, topes } = pesosYTopesDe(null);
    expect(perfil).toBe(PERFIL_POR_DEFECTO);
    expect(pesos).toEqual(PESOS);
    expect(topes).toEqual(TOPES);
  });

  it('el perfil corre lo suyo y deja el resto de fábrica', () => {
    const { pesos, topes } = pesosYTopesDe({ perfil: 'descanso', pesos: {}, topes: {} });
    expect(pesos.descanso_corto).toBe(-60);
    expect(topes.horas_descanso_minimo).toBe(14);
    expect(pesos.cerca).toBe(PESOS.cerca);
  });

  it('lo que la Prestadora corrió tapa al perfil', () => {
    const { pesos } = pesosYTopesDe({ perfil: 'descanso', pesos: { descanso_corto: -20 }, topes: {} });
    expect(pesos.descanso_corto).toBe(-20);
  });

  it('un perfil que no existe cae en el que viene de fábrica', () => {
    const { perfil, pesos } = pesosYTopesDe({ perfil: 'lo_que_sea', pesos: {}, topes: {} });
    expect(perfil).toBe(PERFIL_POR_DEFECTO);
    expect(pesos).toEqual(PESOS);
  });

  it('los tres perfiles dejan la tabla completa, sin agujeros', () => {
    for (const nombre of NOMBRES_DE_PERFIL) {
      const { pesos, topes } = pesosYTopesDe({ perfil: nombre });
      expect(Object.keys(pesos).sort()).toEqual(Object.keys(PESOS).sort());
      expect(Object.keys(topes).sort()).toEqual(Object.keys(TOPES).sort());
    }
  });
});

describe('lo guardado que ya no sirve se ignora, no rompe', () => {
  it('una clave que no se puede tocar no entra', () => {
    // `ocupado` manda al fondo lo que ya está bloqueado. Si entrara, se podría subir a la cabeza
    // de la lista a alguien que no puede tomar la guardia.
    const { pesos } = pesosYTopesDe({ perfil: 'continuidad', pesos: { ocupado: 500 }, topes: {} });
    expect(pesos.ocupado).toBe(PESOS.ocupado);
  });

  it('un número fuera de borde tampoco', () => {
    const { pesos } = pesosYTopesDe({ perfil: 'continuidad', pesos: { cerca: -1000 }, topes: {} });
    expect(pesos.cerca).toBe(PESOS.cerca);
  });

  it('lo que no es un número tampoco', () => {
    const { topes } = pesosYTopesDe({ perfil: 'continuidad', pesos: {}, topes: { km_cerca: 'ocho' } });
    expect(topes.km_cerca).toBe(TOPES.km_cerca);
  });
});

describe('se guarda lo que se corrió, y nada más', () => {
  it('la tabla igual al perfil no guarda nada', () => {
    const armado = pesosYTopesDe({ perfil: 'cercania' });
    const corridos = soloLoQueCorreDelPerfil('cercania', armado.pesos, armado.topes);
    expect(corridos).toEqual({ pesos: {}, topes: {} });
  });

  it('un número cambiado se guarda solo', () => {
    const armado = pesosYTopesDe({ perfil: 'descanso' });
    const corridos = soloLoQueCorreDelPerfil('descanso', { ...armado.pesos, cerca: 22 }, armado.topes);
    expect(corridos.pesos).toEqual({ cerca: 22 });
    expect(corridos.topes).toEqual({});
  });

  it('lo que el perfil ya corre no se vuelve a guardar', () => {
    // Si se guardara, esa Prestadora se quedaría con una copia vieja el día que el perfil cambie.
    const armado = pesosYTopesDe({ perfil: 'descanso' });
    const corridos = soloLoQueCorreDelPerfil('descanso', armado.pesos, armado.topes);
    expect(corridos.pesos.descanso_corto).toBeUndefined();
    expect(PERFILES.descanso.pesos.descanso_corto).toBe(-60);
  });

  it('lo guardado y lo leído dan la vuelta completa sin cambiar nada', () => {
    const elegido = { ...pesosYTopesDe({ perfil: 'cercania' }).pesos, lejos: -40 };
    const corridos = soloLoQueCorreDelPerfil('cercania', elegido, TOPES);
    const vuelta = pesosYTopesDe({ perfil: 'cercania', ...corridos });
    expect(vuelta.pesos).toEqual(elegido);
  });
});

describe('lo que llega de afuera se revisa antes de guardarlo', () => {
  it('lo que está adentro del borde pasa', () => {
    expect(revisarCambios('descanso', { cerca: 22 }, { km_lejos: 30 })).toEqual({ ok: true });
  });

  it('un perfil que no existe no pasa, y se dice cuál falló', () => {
    expect(revisarCambios('lo_que_sea', {}, {})).toEqual({ ok: false, clave: 'perfil' });
  });

  it('un peso fuera de borde no pasa', () => {
    expect(revisarCambios('continuidad', { cerca: -1000 }, {})).toEqual({ ok: false, clave: 'cerca' });
  });

  it('un tope fuera de borde no pasa', () => {
    expect(revisarCambios('continuidad', {}, { horas_semanales: 400 })).toEqual({
      ok: false,
      clave: 'horas_semanales',
    });
  });

  it('una clave desconocida no pasa', () => {
    expect(revisarCambios('continuidad', { ocupado: 500 }, {})).toEqual({ ok: false, clave: 'ocupado' });
  });

  it('cada borde deja pasar sus dos extremos y rechaza lo de afuera', () => {
    for (const [clave, borde] of Object.entries(PESOS_QUE_SE_PUEDEN_TOCAR)) {
      expect(revisarCambios('continuidad', { [clave]: borde.minimo }, {}).ok).toBe(true);
      expect(revisarCambios('continuidad', { [clave]: borde.maximo }, {}).ok).toBe(true);
      expect(revisarCambios('continuidad', { [clave]: borde.minimo - 1 }, {}).ok).toBe(false);
      expect(revisarCambios('continuidad', { [clave]: borde.maximo + 1 }, {}).ok).toBe(false);
    }
    for (const [clave, borde] of Object.entries(TOPES_QUE_SE_PUEDEN_TOCAR)) {
      expect(revisarCambios('continuidad', {}, { [clave]: borde.minimo }).ok).toBe(true);
      expect(revisarCambios('continuidad', {}, { [clave]: borde.maximo }).ok).toBe(true);
      expect(revisarCambios('continuidad', {}, { [clave]: borde.maximo + 1 }).ok).toBe(false);
    }
  });

  it('ningún borde deja llegar al número con el que el sistema bloquea', () => {
    // Es el motivo por el que hay bordes: −1000 es lo que el sistema usa para mandar al fondo a
    // quien no puede tomar la guardia. Que nadie lo alcance desde la configuración.
    for (const borde of Object.values(PESOS_QUE_SE_PUEDEN_TOCAR)) {
      expect(borde.minimo).toBeGreaterThan(-1000);
      expect(borde.maximo).toBeLessThan(1000);
    }
  });
});
