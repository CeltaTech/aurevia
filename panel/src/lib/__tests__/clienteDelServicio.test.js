import { describe, expect, it } from 'vitest';

import { TIPO_FAMILIA, clienteDelServicio } from '../clienteDelServicio';

const FAMILIA = '40000000-0000-4000-8000-000000000001';

const CONTACTO = {
  nombre: 'Familia Gómez',
  localidad: 'Vicente López',
  telefono: '+54 11 5555-0000',
  email: 'contacto.inventado@ejemplo.test',
};

const SERVICIO_DE_UNA_FAMILIA = {
  id: 's1',
  tipo_contratante: TIPO_FAMILIA,
  contratante_id: FAMILIA,
  familias: { id: FAMILIA, solicitudes: CONTACTO },
};

describe('clienteDelServicio', () => {
  it('cuando el Cliente es una Familia, devuelve su contacto y el camino a su ficha', () => {
    expect(clienteDelServicio(SERVICIO_DE_UNA_FAMILIA)).toEqual({
      tipo: TIPO_FAMILIA,
      id: FAMILIA,
      contacto: CONTACTO,
      ruta: `/familias/${FAMILIA}`,
    });
  });

  // La prueba que hace que este archivo sirva de algo: el día que un Servicio lo contrate algo
  // que no es una Familia, la pantalla no puede mandar a nadie a la ficha de una Familia que no
  // existe. Sin `ruta`, el botón no se dibuja.
  it('cuando el Cliente no es una Familia, no ofrece ninguna ficha', () => {
    const otro = { ...SERVICIO_DE_UNA_FAMILIA, tipo_contratante: 'obra_social', familias: null };
    expect(clienteDelServicio(otro)).toEqual({
      tipo: 'obra_social',
      id: FAMILIA,
      contacto: null,
      ruta: null,
    });
  });

  it('no ofrece ficha si el identificador del Cliente falta', () => {
    const sinCliente = { ...SERVICIO_DE_UNA_FAMILIA, contratante_id: null };
    expect(clienteDelServicio(sinCliente).ruta).toBeNull();
  });

  it('aguanta que todavía no haya llegado el Servicio, que es el estado «cargando»', () => {
    expect(clienteDelServicio(null)).toEqual({ tipo: null, id: null, contacto: null, ruta: null });
  });

  it('aguanta que el Servicio venga sin la solicitud anidada', () => {
    const sinSolicitud = { ...SERVICIO_DE_UNA_FAMILIA, familias: { id: FAMILIA } };
    expect(clienteDelServicio(sinSolicitud).contacto).toBeNull();
    expect(clienteDelServicio(sinSolicitud).ruta).toBe(`/familias/${FAMILIA}`);
  });
});
