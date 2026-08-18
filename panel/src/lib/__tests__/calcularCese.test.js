import { describe, expect, it } from 'vitest';
import { calcularCese } from '../calcularCese';
import { resolverEscalasVigentes, resolverFormulasVigentes } from '../escalasLegales';

// Fixture congelada — no depende de la base real, ver checklist de PRD_02B.
const ESCALAS_FIXTURE = [
  { jurisdiccion: 'AR', tipo: 'preaviso_dias', categoria: 'menos_1_anio', valor: 10, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'preaviso_dias', categoria: 'mas_1_anio', valor: 30, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'periodo_prueba_dias', categoria: 'general', valor: 90, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'indemnizacion_antiguedad', categoria: 'meses_por_anio', valor: 1, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'tope_indemnizatorio', categoria: 'general', valor: 3000000, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'piso_minimo_indemnizacion', categoria: 'meses', valor: 2, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'multiplicador_agravado', categoria: 'embarazo_matrimonio', valor: 13, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { jurisdiccion: 'AR', tipo: 'fraccion_computable_antiguedad', categoria: 'general', valor: 90, vigencia_desde: '2026-01-01', vigencia_hasta: null },
];

// Misma estructura y valores que supabase/migrations/ (seed AR) —
// la fórmula misma es dato, ver pendiente #72 en docs/PENDIENTES.md.
const FORMULAS_FIXTURE = [
  {
    jurisdiccion: 'AR', causal: 'renuncia', vigencia_desde: '2020-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [{
        id: 'preaviso', tipo: 'preaviso_prorrateado',
        parametros: {
          escala_menos_1_anio: { tipo: 'preaviso_dias', categoria: 'menos_1_anio' },
          escala_mas_1_anio: { tipo: 'preaviso_dias', categoria: 'mas_1_anio' },
        },
        renombrar: { diasPreaviso: 'diasPreavisoAdeudadosPorAsistente', sustitutivoPreaviso: 'valorReferenciaPreaviso' },
      }],
      combinar: { operacion: 'monto_fijo', valor: 0, detalle_de_paso: 'preaviso' },
      requiere_revision_abogado: false,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'mutuo_acuerdo', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [],
      combinar: { operacion: 'sin_calculo_automatico', motivo: 'Monto a definir por acuerdo entre las partes — el sistema solo registra.' },
      requiere_revision_abogado: false,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'periodo_de_prueba', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [{
        id: 'verificacion', tipo: 'verificar_periodo_prueba',
        parametros: { escala_dias_prueba: { tipo: 'periodo_prueba_dias', categoria: 'general' } },
      }],
      combinar: { operacion: 'usar_paso', paso: 'verificacion' },
      requiere_revision_abogado: false,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'despido_sin_causa', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [
        {
          id: 'antiguedad', tipo: 'indemnizacion_por_anio_con_tope_y_piso',
          parametros: {
            escala_meses_por_anio: { tipo: 'indemnizacion_antiguedad', categoria: 'meses_por_anio' },
            escala_tope: { tipo: 'tope_indemnizatorio', categoria: 'general' },
            escala_piso_meses: { tipo: 'piso_minimo_indemnizacion', categoria: 'meses' },
            escala_umbral_fraccion: { tipo: 'fraccion_computable_antiguedad', categoria: 'general' },
          },
        },
        {
          id: 'preaviso', tipo: 'preaviso_prorrateado',
          parametros: {
            escala_menos_1_anio: { tipo: 'preaviso_dias', categoria: 'menos_1_anio' },
            escala_mas_1_anio: { tipo: 'preaviso_dias', categoria: 'mas_1_anio' },
          },
        },
        { id: 'integracion', tipo: 'integracion_mes_despido', parametros: {} },
      ],
      combinar: { operacion: 'sumar', pasos: ['antiguedad', 'preaviso', 'integracion'] },
      advertencia_umbral_antiguedad: { tipo: 'fraccion_computable_antiguedad', categoria: 'general' },
      requiere_revision_abogado: false,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'despido_por_embarazo_o_matrimonio', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      compone_sobre_causal: 'despido_sin_causa',
      pasos: [{
        id: 'agravamiento', tipo: 'multiplicador_fijo_sobre_remuneracion',
        parametros: { escala: { tipo: 'multiplicador_agravado', categoria: 'embarazo_matrimonio' } },
      }],
      combinar: { operacion: 'sumar_sobre_base', pasos: ['agravamiento'] },
      requiere_revision_abogado: false,
      requiere_revision_abogado_si_incompleto: true,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'despido_con_justa_causa', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [],
      combinar: {
        operacion: 'monto_fijo_cero',
        motivo: 'Sin indemnización — requiere revisión de abogado obligatoria antes de cerrar el registro.',
        advertencia: 'Este cese requiere revisado_por_abogado = true antes de poder cerrarse.',
      },
      requiere_revision_abogado: true,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'abandono_de_trabajo', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [],
      combinar: {
        operacion: 'monto_fijo_cero',
        motivo: 'Sin indemnización — requiere revisión de abogado obligatoria antes de cerrar el registro.',
        advertencia: 'Este cese requiere revisado_por_abogado = true antes de poder cerrarse.',
      },
      requiere_revision_abogado: true,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'muerte_del_trabajador', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [
        {
          id: 'antiguedad', tipo: 'indemnizacion_por_anio_con_tope_y_piso',
          parametros: {
            escala_meses_por_anio: { tipo: 'indemnizacion_antiguedad', categoria: 'meses_por_anio' },
            escala_tope: { tipo: 'tope_indemnizatorio', categoria: 'general' },
            escala_piso_meses: { tipo: 'piso_minimo_indemnizacion', categoria: 'meses' },
            escala_umbral_fraccion: { tipo: 'fraccion_computable_antiguedad', categoria: 'general' },
          },
        },
        { id: 'mitad', tipo: 'mitad_de_componente', parametros: { referencia: 'antiguedad' } },
      ],
      combinar: { operacion: 'usar_paso', paso: 'mitad' },
      requiere_revision_abogado: true,
    },
  },
  {
    jurisdiccion: 'AR', causal: 'muerte_del_empleador', vigencia_desde: '2026-01-01', vigencia_hasta: null,
    definicion: {
      pasos: [
        {
          id: 'antiguedad', tipo: 'indemnizacion_por_anio_con_tope_y_piso',
          parametros: {
            escala_meses_por_anio: { tipo: 'indemnizacion_antiguedad', categoria: 'meses_por_anio' },
            escala_tope: { tipo: 'tope_indemnizatorio', categoria: 'general' },
            escala_piso_meses: { tipo: 'piso_minimo_indemnizacion', categoria: 'meses' },
            escala_umbral_fraccion: { tipo: 'fraccion_computable_antiguedad', categoria: 'general' },
          },
        },
        { id: 'mitad', tipo: 'mitad_de_componente', parametros: { referencia: 'antiguedad' } },
      ],
      combinar: { operacion: 'usar_paso', paso: 'mitad' },
      advertencia_si_no_dependencia: 'Esta causal solo aplica cuando el empleador es la familia directamente (vínculo por dependencia), no a la prestadora.',
      requiere_revision_abogado: true,
    },
  },
];

function escalas(fechaHecho = '2026-07-08') {
  return resolverEscalasVigentes(ESCALAS_FIXTURE, fechaHecho, 'AR');
}

function formulas(fechaHecho = '2026-07-08') {
  return resolverFormulasVigentes(FORMULAS_FIXTURE, fechaHecho, 'AR');
}

const asistenteDependenciaBase = {
  tipo_vinculo: 'dependencia',
  fecha_alta: '2023-01-10',
  sueldo_basico: 500000,
};

describe('calcularCese', () => {
  it('renuncia no genera monto a pagar por el empleador', () => {
    const r = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'renuncia',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.montoTotal).toBe(0);
    expect(r.requiereRevisionAbogado).toBe(false);
  });

  it('mutuo_acuerdo no calcula un monto fijo', () => {
    const r = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'mutuo_acuerdo',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.montoTotal).toBeNull();
    expect(r.requiereRevisionAbogado).toBe(false);
  });

  it('despido_con_justa_causa no paga indemnización pero exige revisión de abogado', () => {
    const r = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'despido_con_justa_causa',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.montoTotal).toBe(0);
    expect(r.requiereRevisionAbogado).toBe(true);
  });

  it('despido_sin_causa calcula antigüedad + preaviso + integración', () => {
    const r = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'despido_sin_causa',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.montoTotal).toBeGreaterThan(0);
    // fecha_alta 2023-01-10 -> fechaCese 2026-07-08: 3 años + ~179 días de fracción,
    // que por LCT art. 245 (fracción mayor a 3 meses) redondea a 4 años computables.
    expect(r.detalleCalculo.aniosAntiguedad).toBe(4);
    expect(r.detalleCalculo.diasPreaviso).toBe(30);
    expect(r.requiereRevisionAbogado).toBe(false);
  });

  it('despido_sin_causa aplica el tope indemnizatorio cuando corresponde', () => {
    const asistenteSueldoAlto = { ...asistenteDependenciaBase, sueldo_basico: 5000000, fecha_alta: '2015-01-10' };
    const r = calcularCese({
      asistente: asistenteSueldoAlto, fechaCese: '2026-07-08', causal: 'despido_sin_causa',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.detalleCalculo.topeIndemnizatorioAplicado).toBe(true);
    expect(r.detalleCalculo.indemnizacionAntiguedad).toBe(3000000);
  });

  it('despido_por_embarazo_o_matrimonio agrega el agravamiento sobre la base de despido sin causa', () => {
    const sinCausa = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'despido_sin_causa',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    const agravado = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'despido_por_embarazo_o_matrimonio',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(agravado.montoTotal).toBeGreaterThan(sinCausa.montoTotal);
    expect(agravado.detalleCalculo.mesesAgravado).toBe(13);
  });

  it('periodo_de_prueba sin indemnización si está dentro del período vigente', () => {
    const asistenteNuevo = { ...asistenteDependenciaBase, fecha_alta: '2026-06-01' };
    const r = calcularCese({
      asistente: asistenteNuevo, fechaCese: '2026-07-08', causal: 'periodo_de_prueba',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.montoTotal).toBe(0);
    expect(r.requiereRevisionAbogado).toBe(false);
  });

  it.each(['incapacidad_absoluta', 'jubilacion', 'fin_contrato_comercial', 'muerte_persona_cuidada'])(
    'la causal %s nunca calcula un monto automático',
    (causal) => {
      const r = calcularCese({
        asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal,
        escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
      });
      expect(r.montoTotal).toBeNull();
      expect(r.requiereRevisionAbogado).toBe(true);
    },
  );

  it('muerte_del_trabajador calcula indemnización reducida y exige revisión de abogado', () => {
    const r = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'muerte_del_trabajador',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.montoTotal).toBeGreaterThan(0);
    expect(r.requiereRevisionAbogado).toBe(true);
  });

  it('muerte_del_empleador advierte si el vínculo no es de dependencia', () => {
    const asistenteMonotributo = { ...asistenteDependenciaBase, tipo_vinculo: 'monotributo', valor_hora: 3000, horas_semanales: 40 };
    const r = calcularCese({
      asistente: asistenteMonotributo, fechaCese: '2026-07-08', causal: 'muerte_del_empleador',
      escalasLegales: escalas(), jurisdiccion: 'AR', formulasLegales: formulas(),
    });
    expect(r.advertencias.some((a) => a.includes('solo aplica'))).toBe(true);
  });

  it('resolverEscalasVigentes/resolverFormulasVigentes respetan la fecha del hecho, no la fecha actual', () => {
    const historico = [
      { jurisdiccion: 'AR', tipo: 'preaviso_dias', categoria: 'mas_1_anio', valor: 15, vigencia_desde: '2020-01-01', vigencia_hasta: '2025-12-31' },
      { jurisdiccion: 'AR', tipo: 'preaviso_dias', categoria: 'mas_1_anio', valor: 30, vigencia_desde: '2026-01-01', vigencia_hasta: null },
    ];
    const enElPasado = resolverEscalasVigentes(historico, '2023-06-01', 'AR');
    const asistenteConAntiguedad = { ...asistenteDependenciaBase, fecha_alta: '2020-01-10' };
    const r = calcularCese({
      asistente: asistenteConAntiguedad, fechaCese: '2023-06-01', causal: 'renuncia',
      escalasLegales: enElPasado, jurisdiccion: 'AR', formulasLegales: formulas('2023-06-01'),
    });
    expect(r.detalleCalculo.diasPreavisoAdeudadosPorAsistente).toBe(15);
  });

  it('sin fórmula cargada para la jurisdicción/causal, falla cerrado y exige revisión de abogado', () => {
    const r = calcularCese({
      asistente: asistenteDependenciaBase, fechaCese: '2026-07-08', causal: 'despido_sin_causa',
      escalasLegales: escalas(), jurisdiccion: 'BR', formulasLegales: resolverFormulasVigentes(FORMULAS_FIXTURE, '2026-07-08', 'BR'),
    });
    expect(r.montoTotal).toBeNull();
    expect(r.requiereRevisionAbogado).toBe(true);
  });
});
