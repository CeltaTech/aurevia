import { describe, expect, it, vi } from 'vitest';

import { TIPO_FAMILIA, clienteDelServicio, contactosDeClientes } from '../clienteDelServicio';

const FAMILIA = '40000000-0000-4000-8000-000000000001';
const OTRA_FAMILIA = '40000000-0000-4000-8000-000000000002';

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
};

const CONTACTOS = new Map([[FAMILIA, CONTACTO]]);

describe('clienteDelServicio', () => {
  it('cuando el Cliente es una Familia, devuelve su contacto y el camino a su ficha', () => {
    expect(clienteDelServicio(SERVICIO_DE_UNA_FAMILIA, CONTACTOS)).toEqual({
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
    const otro = { ...SERVICIO_DE_UNA_FAMILIA, tipo_contratante: 'obra_social' };
    expect(clienteDelServicio(otro, CONTACTOS)).toEqual({
      tipo: 'obra_social',
      id: FAMILIA,
      contacto: null,
      ruta: null,
    });
  });

  it('no ofrece ficha si el identificador del Cliente falta', () => {
    const sinCliente = { ...SERVICIO_DE_UNA_FAMILIA, contratante_id: null };
    expect(clienteDelServicio(sinCliente, CONTACTOS).ruta).toBeNull();
  });

  it('aguanta que todavía no haya llegado el Servicio, que es el estado «cargando»', () => {
    expect(clienteDelServicio(null, CONTACTOS)).toEqual({ tipo: null, id: null, contacto: null, ruta: null });
  });

  it('aguanta que los contactos todavía no hayan llegado', () => {
    expect(clienteDelServicio(SERVICIO_DE_UNA_FAMILIA, new Map()).contacto).toBeNull();
    expect(clienteDelServicio(SERVICIO_DE_UNA_FAMILIA, undefined).contacto).toBeNull();
    expect(clienteDelServicio(SERVICIO_DE_UNA_FAMILIA, new Map()).ruta).toBe(`/familias/${FAMILIA}`);
  });
});

// Arma un doble de la base que devuelve lo que se le diga y deja ver con qué se lo llamó.
function baseFalsa(respuesta) {
  const enIn = vi.fn().mockResolvedValue(respuesta);
  const enSelect = vi.fn(() => ({ in: enIn }));
  const enFrom = vi.fn(() => ({ select: enSelect }));
  return { supabase: { from: enFrom }, enFrom, enSelect, enIn };
}

describe('contactosDeClientes', () => {
  it('trae una sola vez cada Familia, aunque tenga varios Servicios', async () => {
    const { supabase, enIn } = baseFalsa({
      data: [{ id: FAMILIA, solicitudes: CONTACTO }],
      error: null,
    });

    const { contactos, error } = await contactosDeClientes(supabase, [
      SERVICIO_DE_UNA_FAMILIA,
      { ...SERVICIO_DE_UNA_FAMILIA, id: 's2' },
    ]);

    expect(enIn).toHaveBeenCalledWith('id', [FAMILIA]);
    expect(error).toBeNull();
    expect(contactos.get(FAMILIA)).toEqual(CONTACTO);
  });

  // Si no hay ninguna Familia que buscar, no se consulta: una pantalla de Servicios de Clientes
  // que no son Familias no tiene por qué pagar una consulta que va a volver vacía.
  it('no consulta nada cuando ningún Cliente es una Familia', async () => {
    const { supabase, enFrom } = baseFalsa({ data: [], error: null });

    const { contactos } = await contactosDeClientes(supabase, [
      { ...SERVICIO_DE_UNA_FAMILIA, tipo_contratante: 'obra_social' },
    ]);

    expect(enFrom).not.toHaveBeenCalled();
    expect(contactos.size).toBe(0);
  });

  it('aguanta que todavía no haya llegado ningún Servicio', async () => {
    const { supabase, enFrom } = baseFalsa({ data: [], error: null });
    const { contactos } = await contactosDeClientes(supabase, null);
    expect(enFrom).not.toHaveBeenCalled();
    expect(contactos.size).toBe(0);
  });

  // Una Familia que entró sin solicitud no tiene de dónde sacar el contacto, y eso no puede
  // dejar un renglón indefinido adentro del mapa: la pantalla muestra un guion.
  it('deja afuera a la Familia que no tiene solicitud', async () => {
    const { supabase } = baseFalsa({
      data: [
        { id: FAMILIA, solicitudes: CONTACTO },
        { id: OTRA_FAMILIA, solicitudes: null },
      ],
      error: null,
    });

    const { contactos } = await contactosDeClientes(supabase, [
      SERVICIO_DE_UNA_FAMILIA,
      { ...SERVICIO_DE_UNA_FAMILIA, id: 's2', contratante_id: OTRA_FAMILIA },
    ]);

    expect(contactos.size).toBe(1);
    expect(contactos.has(OTRA_FAMILIA)).toBe(false);
  });

  it('devuelve la falla de la base en vez de tragársela', async () => {
    const falla = { message: 'se cayó' };
    const { supabase } = baseFalsa({ data: null, error: falla });

    const { contactos, error } = await contactosDeClientes(supabase, [SERVICIO_DE_UNA_FAMILIA]);

    expect(error).toBe(falla);
    expect(contactos.size).toBe(0);
  });
});
