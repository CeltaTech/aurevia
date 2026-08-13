import { useSeVe } from '../context/PerfilContext';

// ¿Esta Prestadora usa el seguimiento de ubicación?
//
// La pregunta vive acá y no adentro de cada pantalla porque la contestan dos: el aviso de que
// hay algo para decidir, en Mis Guardias, y el texto con los dos botones, en Mi Perfil. La
// misma condición escrita en dos archivos se despega el día que cambie (CLAUDE.md §7 regla 12).
//
// Por qué la ubicación en vivo decide sobre el consentimiento: lo único que hoy se consiente
// es el registro de la ubicación. Si la Prestadora apagó esa función, pedirle a alguien que
// consienta no es un botón de más — es guardar una constancia firmada sobre algo que nunca va
// a pasar, y hacerlo pensar que lo están siguiendo cuando no lo están siguiendo.
export function useHaySeguimientoDeUbicacion() {
  const seVe = useSeVe();
  return seVe('asistente_ubicacion_en_vivo');
}
