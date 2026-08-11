import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PRESTADORA_ID = '4e84b0e7-1729-4d07-9e70-56fdbd54cd89'; // Prestadora Demo
const PASSWORD = 'DemoPrestadora2026!';

// Qué es cada Asistente de la demo. Son las claves de los tipos generales que
// trae el producto; el identificador real se busca en la base al arrancar,
// porque cambia de una instalación a otra.
const CLAVES_TIPO = ['cuidador', 'enfermero', 'kinesiologo', 'medico'];
const ZONAS = [
  'CABA', 'San Isidro', 'Vicente López', 'Tigre', 'Quilmes', 'Lomas de Zamora', 'La Matanza', 'Morón', 'San Martín', 'Avellaneda',
];
const CAUSALES_BAJA = ['renuncia', 'mutuo_acuerdo', 'periodo_de_prueba'];
const CATEGORIAS_CCT = ['Asistencia y Cuidado de Personas — Categoría A', 'Asistencia y Cuidado de Personas — Categoría B'];

function slug(nombre) {
  return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.');
}

const NOMBRES_ASISTENTES = [
  'Silvia Fernández', 'Claudia García', 'Mónica Rodríguez', 'Patricia López', 'Alejandra Martínez',
  'Gabriela Pérez', 'Marcela Sánchez', 'Verónica Romero', 'Adriana Díaz', 'Cristina Torres',
  'Liliana Flores', 'Norma Acosta', 'Susana Benítez', 'Beatriz Medina', 'Graciela Herrera',
  'Estela Suárez', 'Ana Rojas', 'Rosa Molina', 'Carlos Ortiz', 'Jorge Silva',
  'Roberto Núñez', 'Daniel Ríos', 'Miguel Aguirre', 'Ricardo Castro', 'Alberto Ibáñez',
  'Eduardo Vega', 'Raúl Cabrera', 'Héctor Sosa', 'Rubén Godoy', 'Oscar Bravo',
  'Sergio Peralta', 'Fernando Domínguez', 'Gustavo Luna', 'Pablo Ledesma', 'Diego Ferreyra',
  'Martín Vargas', 'Andrés Correa', 'Julián Campos',
];

function construirAsistente(nombre, idx) {
  const esDependencia = idx % 5 === 2 || idx % 5 === 4; // ~40% dependencia
  const zonas = [ZONAS[idx % 10], ZONAS[(idx + 4) % 10]];
  const canalesOpciones = [['directo', 'marketplace'], ['directo'], ['marketplace'], ['directo', 'marketplace']];
  const canales = canalesOpciones[idx % 4];

  let estado = 'activo';
  let fecha_baja = null;
  let causal_baja = null;
  if (idx % 13 === 6) { estado = 'inactivo'; }
  if (idx % 13 === 11) {
    estado = 'cesado';
    fecha_baja = `2026-0${(idx % 6) + 1}-15`;
    causal_baja = CAUSALES_BAJA[idx % CAUSALES_BAJA.length];
  }

  const anioAlta = 2022 + (idx % 4);
  const mesAlta = String((idx % 12) + 1).padStart(2, '0');
  const diaAlta = String((idx % 27) + 1).padStart(2, '0');

  return {
    nombre: `DEMO — ${nombre}`,
    telefono: `+549 11 ${4000 + idx}-${1000 + idx * 7 % 9000}`,
    email: `alas.para.escribir.2026+asistente.demo.${slug(nombre)}@gmail.com`,
    dni: String(30500000 + idx),
    tipo_vinculo: esDependencia ? 'dependencia' : 'monotributo',
    categoria_cct: esDependencia ? CATEGORIAS_CCT[idx % 2] : null,
    valor_hora: esDependencia ? null : 3500 + (idx % 6) * 450,
    sueldo_basico: esDependencia ? 950000 + (idx % 5) * 65000 : null,
    horas_semanales: esDependencia ? 30 + (idx % 4) * 6 : null,
    claveTipo: CLAVES_TIPO[idx % CLAVES_TIPO.length],
    zonas,
    canales,
    estado,
    fecha_alta: `${anioAlta}-${mesAlta}-${diaAlta}`,
    fecha_baja,
    causal_baja,
  };
}

const PACIENTES = [
  { nombre: 'Elena Sosa Domínguez', fecha_nacimiento: '1935-02-10', patologias: ['Hipertensión', 'Diabetes tipo 2'], medicacion: [{ nombre: 'Losartán', dosis: '50mg', frecuencia: '1 vez al día' }, { nombre: 'Metformina', dosis: '850mg', frecuencia: '2 veces al día' }], nivel: 'II', domicilio: 'Av. Cabildo 2100, CABA', lat: -34.5623, lng: -58.4547, ioma: null, plan: 'directo' },
  { nombre: 'Antonio Ferreyra', fecha_nacimiento: '1930-11-03', patologias: ['Alzheimer', 'Hipertensión'], medicacion: [{ nombre: 'Donepecilo', dosis: '10mg', frecuencia: '1 vez al día' }], nivel: 'III', domicilio: 'Av. Maipú 1450, Vicente López', lat: -34.5265, lng: -58.4750, ioma: 'IOMA-4471182', plan: 'obra_social' },
  { nombre: 'Rosa Villalba', fecha_nacimiento: '1942-06-22', patologias: ['Artrosis'], medicacion: [{ nombre: 'Ibuprofeno', dosis: '400mg', frecuencia: 'según dolor' }], nivel: 'I', domicilio: 'Calle 9 de Julio 850, San Isidro', lat: -34.4708, lng: -58.5307, ioma: null, plan: 'directo' },
  { nombre: 'Juan Carlos Medina', fecha_nacimiento: '1928-01-15', patologias: ['EPOC', 'Hipertensión'], medicacion: [{ nombre: 'Salbutamol', dosis: 'inhalador', frecuencia: 'según necesidad' }], nivel: 'III', domicilio: 'Av. Mitre 3200, Avellaneda', lat: -34.6626, lng: -58.3654, ioma: 'IOMA-2298031', plan: 'obra_social' },
  { nombre: 'María Esther Aguilar', fecha_nacimiento: '1937-09-08', patologias: ['Diabetes tipo 2', 'Insuficiencia renal'], medicacion: [{ nombre: 'Insulina NPH', dosis: '20 UI', frecuencia: '2 veces al día' }], nivel: 'II', domicilio: 'Belgrano 780, Quilmes', lat: -34.7206, lng: -58.2540, ioma: null, plan: 'directo' },
  { nombre: 'Osvaldo Ríos', fecha_nacimiento: '1933-04-30', patologias: ['Parkinson'], medicacion: [{ nombre: 'Levodopa/Carbidopa', dosis: '250/25mg', frecuencia: '3 veces al día' }], nivel: 'III', domicilio: 'Av. Hipólito Yrigoyen 5400, Lomas de Zamora', lat: -34.7595, lng: -58.4013, ioma: null, plan: 'directo' },
  { nombre: 'Delia Ponce', fecha_nacimiento: '1945-12-01', patologias: ['Hipertensión'], medicacion: [{ nombre: 'Amlodipina', dosis: '5mg', frecuencia: '1 vez al día' }], nivel: 'I', domicilio: 'Av. Rivadavia 12000, CABA', lat: -34.6329, lng: -58.5100, ioma: 'IOMA-5502931', plan: 'obra_social' },
  { nombre: 'Ernesto Bianchi', fecha_nacimiento: '1931-07-19', patologias: ['Alzheimer', 'Diabetes tipo 1'], medicacion: [{ nombre: 'Insulina glargina', dosis: '18 UI', frecuencia: '1 vez al día' }], nivel: 'III', domicilio: 'Av. San Martín 1890, San Martín', lat: -34.5764, lng: -58.5385, ioma: null, plan: 'directo' },
  { nombre: 'Nélida Franco', fecha_nacimiento: '1940-03-27', patologias: ['Osteoporosis'], medicacion: [{ nombre: 'Calcio + Vitamina D', dosis: '600mg/400UI', frecuencia: '1 vez al día' }], nivel: 'I', domicilio: 'Av. Pavón 2300, Morón', lat: -34.6531, lng: -58.6198, ioma: null, plan: 'directo' },
  { nombre: 'Héctor Giménez', fecha_nacimiento: '1926-10-14', patologias: ['Post ACV', 'Hipertensión'], medicacion: [{ nombre: 'Clopidogrel', dosis: '75mg', frecuencia: '1 vez al día' }], nivel: 'III', domicilio: 'Av. de Mayo 900, CABA', lat: -34.6087, lng: -58.3781, ioma: 'IOMA-1039284', plan: 'obra_social' },
  { nombre: 'Marta Escobar', fecha_nacimiento: '1948-05-05', patologias: ['Diabetes tipo 2'], medicacion: [{ nombre: 'Metformina', dosis: '500mg', frecuencia: '2 veces al día' }], nivel: 'I', domicilio: 'Av. Triunvirato 4500, CABA', lat: -34.5776, lng: -58.4753, ioma: null, plan: 'directo' },
  { nombre: 'Ramón Quiroga', fecha_nacimiento: '1934-08-21', patologias: ['EPOC'], medicacion: [{ nombre: 'Tiotropio', dosis: 'inhalador', frecuencia: '1 vez al día' }], nivel: 'II', domicilio: 'Av. Vélez Sarsfield 1200, Tigre', lat: -34.4264, lng: -58.5799, ioma: null, plan: 'directo' },
  { nombre: 'Susana Paz', fecha_nacimiento: '1939-02-28', patologias: ['Hipertensión', 'Artrosis'], medicacion: [{ nombre: 'Losartán', dosis: '50mg', frecuencia: '1 vez al día' }], nivel: 'II', domicilio: 'Av. Hipólito Yrigoyen 780, La Matanza', lat: -34.7736, lng: -58.6198, ioma: 'IOMA-8827104', plan: 'obra_social' },
  { nombre: 'Enrique Duarte', fecha_nacimiento: '1929-06-09', patologias: ['Alzheimer'], medicacion: [{ nombre: 'Memantina', dosis: '10mg', frecuencia: '1 vez al día' }], nivel: 'III', domicilio: 'Av. Directorio 3400, CABA', lat: -34.6398, lng: -58.4548, ioma: null, plan: 'directo' },
];

async function crearUsuarioAuth(email, nombre, rol) {
  const { data, error } = await supabase.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`auth.createUser(${email}): ${error.message}`);
  await supabase.from('usuarios').insert({ id: data.user.id, rol, nombre, prestadora_id: PRESTADORA_ID }).throwOnError();
  return data.user.id;
}

// Los tipos generales, buscados una sola vez: la clave es estable, el
// identificador no.
async function tiposGeneralesPorClave() {
  const { data } = await supabase
    .from('tipos_asistente')
    .select('id, clave')
    .is('prestadora_id', null)
    .throwOnError();
  return Object.fromEntries((data || []).map((tipo) => [tipo.clave, tipo.id]));
}

async function main() {
  const resumen = { familias: [], pacientes: [], asistentes: [] };
  const tipoPorClave = await tiposGeneralesPorClave();

  // --- 14 familias + pacientes nuevos (más la ya existente = 15) ---
  for (const p of PACIENTES) {
    const email = `alas.para.escribir.2026+familia.demo.${slug(p.nombre)}@gmail.com`;
    const familiaId = await crearUsuarioAuth(email, `DEMO — Familia ${p.nombre.split(' ').slice(-1)[0]}`, 'familia');
    await supabase.from('familias').insert({ id: familiaId, prestadora_id: PRESTADORA_ID, plan: p.plan }).throwOnError();
    const { data: paciente } = await supabase.from('pacientes').insert({
      prestadora_id: PRESTADORA_ID,
      familia_id: familiaId,
      nombre: `DEMO — ${p.nombre}`,
      fecha_nacimiento: p.fecha_nacimiento,
      patologias: p.patologias,
      medicacion_habitual: p.medicacion,
      nivel_complejidad: p.nivel,
      domicilio: p.domicilio,
      lat: p.lat,
      lng: p.lng,
      obra_social: 'IOMA',
      numero_afiliado: p.ioma,
    }).select().single().throwOnError();
    resumen.familias.push(familiaId);
    resumen.pacientes.push(paciente.id);
    console.log(`familia+paciente OK: ${p.nombre}`);
  }

  // Completar los datos que faltaban en el paciente ya existente (Roberto Fernández)
  await supabase.from('pacientes').update({
    patologias: ['Hipertensión', 'Artrosis de cadera'],
    medicacion_habitual: [{ nombre: 'Enalapril', dosis: '10mg', frecuencia: '1 vez al día' }],
    lat: -34.6178, lng: -58.4396,
  }).eq('id', '54848fc9-8a30-49f5-87c1-0548fd85e9d3').throwOnError();

  // --- 38 asistentes nuevos (más los 2 ya existentes = 40) ---
  for (let i = 0; i < NOMBRES_ASISTENTES.length; i++) {
    const nombre = NOMBRES_ASISTENTES[i];
    const perfil = construirAsistente(nombre, i);
    const asistenteId = await crearUsuarioAuth(perfil.email, perfil.nombre, 'asistente');
    await supabase.from('asistentes').insert({
      id: asistenteId,
      prestadora_id: PRESTADORA_ID,
      nombre: perfil.nombre,
      telefono: perfil.telefono,
      email: perfil.email,
      dni: perfil.dni,
      tipo_asistente_id: tipoPorClave[perfil.claveTipo] || null,
      zonas: perfil.zonas,
      canales: perfil.canales,
      estado: perfil.estado,
      tipo_vinculo: perfil.tipo_vinculo,
      categoria_cct: perfil.categoria_cct,
      valor_hora: perfil.valor_hora,
      sueldo_basico: perfil.sueldo_basico,
      horas_semanales: perfil.horas_semanales,
      fecha_alta: perfil.fecha_alta,
      fecha_baja: perfil.fecha_baja,
      causal_baja: perfil.causal_baja,
    }).throwOnError();
    resumen.asistentes.push(asistenteId);
    console.log(`asistente OK (${i + 1}/${NOMBRES_ASISTENTES.length}): ${nombre}`);
  }

  // Completar los 2 asistentes DEMO ya existentes (Marta Gómez, Lucía Paredes)
  await supabase.from('asistentes').update({
    tipo_asistente_id: tipoPorClave.cuidador || null,
    zonas: ['CABA', 'San Isidro'],
    dni: '30499001',
  }).eq('id', 'f93e3e6e-286b-45bc-a101-37b93f7f95ff').throwOnError();
  await supabase.from('asistentes').update({
    tipo_asistente_id: tipoPorClave.enfermero || null,
    zonas: ['CABA', 'Vicente López'],
    dni: '30499002',
  }).eq('id', '152c76f6-c94f-49fa-8715-07b0c502e64d').throwOnError();

  console.log('RESUMEN', JSON.stringify({ familias: resumen.familias.length, pacientes: resumen.pacientes.length, asistentes: resumen.asistentes.length }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
