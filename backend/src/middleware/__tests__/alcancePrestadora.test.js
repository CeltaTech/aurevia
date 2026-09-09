/**
 * A qué cuentas del Panel llega quien pide.
 *
 *   npm test --prefix backend
 *   node --test backend/src/middleware/__tests__/alcancePrestadora.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. La regla del alcance sobre la tabla `usuarios` estaba escrita dos
 * veces y las dos copias no decían lo mismo (pendiente #157): la de las rutas filtraba la
 * consulta, y la de `borrarCuenta` se salteaba entera cuando quien pedía era Superadmin. Ahora
 * hay una sola regla y las dos preguntan acá, así que acá se prueba la regla sola, sin base y sin
 * rutas: cuáles son los dos casos que dan permiso y por qué todo lo demás se niega.
 *
 * Lo que más importa de este archivo son los casos de abajo, los del alcance imposible de
 * resolver. Un control de acceso falla cerrado (CLAUDE.md §5), y la forma clásica de romperlo es
 * dejar que una comparación entre dos valores vacíos decida un permiso.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { alcanceDelPanel, laCuentaDelPanelEstaAlAlcance } from '../alcancePrestadora.js';

const PRESTADORA_PROPIA = '11111111-1111-1111-1111-111111111111';
const PRESTADORA_AJENA = '22222222-2222-2222-2222-222222222222';

/** El equipo técnico de CeltaTech no cuelga de ninguna Organización. */
const CUENTA_DEL_EQUIPO_TECNICO = { rol: 'superadmin', prestadora_id: null };

describe('lo que sí está al alcance', () => {
  it('una cuenta de la Organización sobre la que se está trabajando', () => {
    const alcance = alcanceDelPanel({ rol: 'admin_prestadora', prestadoraId: PRESTADORA_PROPIA });
    const cuenta = { rol: 'coordinador', prestadora_id: PRESTADORA_PROPIA };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, alcance), true);
  });

  it('el equipo técnico de CeltaTech, para un Superadmin', () => {
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: null });
    assert.equal(laCuentaDelPanelEstaAlAlcance(CUENTA_DEL_EQUIPO_TECNICO, alcance), true);
  });

  it('la Prestadora que un Superadmin está visitando con una sesión de soporte', () => {
    // `requiereRolPanel` ya dejó en `prestadoraId` la Prestadora de la sesión abierta, con la
    // misma precedencia que `current_tenant()`. Acá no se reinventa: se usa ese valor.
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: PRESTADORA_AJENA });
    const cuenta = { rol: 'admin_prestadora', prestadora_id: PRESTADORA_AJENA };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, alcance), true);
  });
});

describe('lo que no está al alcance de nadie', () => {
  it('una cuenta de otra Prestadora, aunque quien pida sea Superadmin', () => {
    // El corazón del pendiente #157: ser Superadmin no es un pase libre. Para llegar a una
    // Prestadora hay que entrar con una sesión de soporte, y entonces queda auditado.
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: PRESTADORA_PROPIA });
    const cuenta = { rol: 'admin_prestadora', prestadora_id: PRESTADORA_AJENA };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, alcance), false);
  });

  it('una cuenta de otra Prestadora, para un Admin_prestadora', () => {
    const alcance = alcanceDelPanel({ rol: 'admin_prestadora', prestadoraId: PRESTADORA_PROPIA });
    const cuenta = { rol: 'coordinador', prestadora_id: PRESTADORA_AJENA };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, alcance), false);
  });

  it('el equipo técnico de CeltaTech, para cualquiera que no sea Superadmin', () => {
    for (const rol of ['admin_prestadora', 'coordinador']) {
      const alcance = alcanceDelPanel({ rol, prestadoraId: PRESTADORA_PROPIA });
      assert.equal(laCuentaDelPanelEstaAlAlcance(CUENTA_DEL_EQUIPO_TECNICO, alcance), false, rol);
    }
  });

  it('una cuenta de Prestadora, para un Superadmin que todavía no entró a ninguna', () => {
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: null });
    const cuenta = { rol: 'admin_prestadora', prestadora_id: PRESTADORA_AJENA };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, alcance), false);
  });
});

describe('cuando el alcance no se puede resolver, se niega', () => {
  it('dos cuentas sin Organización no son de la misma Organización', () => {
    // La trampa que hay que evitar: `null === null` da verdadero, y ahí un permiso lo decide un
    // dato que nadie pudo resolver. Se exige que las dos Organizaciones existan.
    const cuenta = { rol: 'familia', prestadora_id: null };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, { prestadoraId: null }), false);
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, { prestadoraId: undefined }), false);
    assert.equal(laCuentaDelPanelEstaAlAlcance({ rol: 'familia' }, {}), false);
  });

  it('sin fila que mirar', () => {
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: PRESTADORA_PROPIA });
    assert.equal(laCuentaDelPanelEstaAlAlcance(null, alcance), false);
    assert.equal(laCuentaDelPanelEstaAlAlcance(undefined, alcance), false);
  });

  it('sin alcance que aplicar', () => {
    const cuenta = { rol: 'coordinador', prestadora_id: PRESTADORA_PROPIA };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, null), false);
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, undefined), false);
  });

  it('un rol desconocido no hereda la excepción del equipo técnico', () => {
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: PRESTADORA_PROPIA });
    const cuenta = { rol: 'un_rol_que_no_existe', prestadora_id: null };
    assert.equal(laCuentaDelPanelEstaAlAlcance(cuenta, alcance), false);
  });
});

describe('de quién pide sólo se leen dos cosas, y siempre las mismas', () => {
  it('sin usuario de Panel no hay Organización activa ni equipo técnico', () => {
    assert.deepEqual(alcanceDelPanel(undefined), { prestadoraId: null, esSuperadmin: false });
    assert.deepEqual(alcanceDelPanel(null), { prestadoraId: null, esSuperadmin: false });
    assert.deepEqual(alcanceDelPanel({}), { prestadoraId: null, esSuperadmin: false });
  });

  it('lo que sale de acá es exactamente lo que recibe `borrarCuenta`', () => {
    // Las dos claves tienen que llamarse así: el resultado viaja tal cual desde la ruta hasta
    // `borrarCuenta` (`utils/cuentasPanel.js`), sin que nadie lo vuelva a armar por su cuenta.
    const alcance = alcanceDelPanel({ rol: 'superadmin', prestadoraId: PRESTADORA_AJENA });
    assert.deepEqual(alcance, { prestadoraId: PRESTADORA_AJENA, esSuperadmin: true });
  });
});
