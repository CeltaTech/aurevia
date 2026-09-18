// El estado documental de un Asistente, tal como se le puede contar a la Familia.
//
// Dos cosas que este bloque no hace, y las dos son deliberadas. No nombra ningún papel: el
// nombre de un tipo de documento puede ser dato de salud, y la Familia contrató un servicio,
// no la historia clínica de quien lo presta. Y no afirma nada que el producto no haya comprobado:
// la última línea dice con todas las letras qué no se verifica —identidad, antecedentes,
// autenticidad—, que es la parte que en este tema termina en juicio cuando falta
// (`docs/PRD_07_Modalidad_Marketplace.md:247`).
//
// Vive acá y no adentro de una pantalla porque lo dicen dos: lo cargado del Asistente que ya
// está trabajando en la casa, y el perfil público de la vidriera. Es la misma afirmación sobre
// la misma persona, y decirla distinto en dos lugares es exactamente lo que no puede pasar.
export default function EstadoDocumental({ resumen, matricula, alDia, papelesExigidos, t }) {
  if (!resumen) return null;
  const hayExigencias = resumen !== 'sin_exigencias';
  return (
    <>
      <h2 style={{ marginTop: '1.5rem' }}>{t.asistente.documentacion_titulo}</h2>
      <p>{t.asistente[`documentacion_${resumen}`]}</p>
      {hayExigencias && (
        <p className="guardia-card-detalle">
          {t.asistente.documentacion_cuenta
            .replace('{alDia}', alDia)
            .replace('{total}', papelesExigidos)}
        </p>
      )}
      {matricula !== 'no_corresponde' && (
        <p>{t.asistente[`documentacion_matricula_${matricula}`]}</p>
      )}
      {hayExigencias && <p className="guardia-card-detalle">{t.asistente.documentacion_sin_nombres}</p>}
      <p className="guardia-card-detalle">{t.asistente.documentacion_que_no_se_verifica}</p>
    </>
  );
}
