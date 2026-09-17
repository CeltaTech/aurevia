import { FormField } from '../ui/FormField';
import { ElegirUnLugar } from '../lugares/ElegirUnLugar';
import { useLocale } from '../../i18n/LocaleContext';
import { useCatalogoDeLugares } from '../../hooks/useCatalogoDeLugares';
import { DOMICILIO_VACIO } from '../../lib/partesDeDomicilio';

/* El domicilio partido, en un solo componente.
   ==========================================================================

   Los tres lugares que guardan un domicilio —el Paciente, la Asistente y el domicilio temporal del
   Paciente— piden exactamente los mismos campos. Escrito una vez, porque escrito tres veces uno
   pediría el piso y otro no, y la misma dirección quedaría cargada distinto según por dónde entró.

   POR QUÉ PARTIDO. Un domicilio en un solo renglón no se puede buscar ni comparar: «Av. Siempreviva
   742, Belgrano» y «Siempreviva 742 - Belgrano» son la misma casa y para el sistema son dos textos
   sin nada en común. Partido, la localidad es una ficha y se puede preguntar quién trabaja ahí.

   «UNIDAD» Y NO «DEPARTAMENTO», porque el departamento de un edificio y el de una provincia se
   escriben igual y no son lo mismo.

   EL RENGLÓN NO SE PIDE NI SE GUARDA: se arma al mostrarlo, con `domicilioEscrito`.

   EL DOMICILIO ES DATO SENSIBLE: no se escribe en registros, ni en direcciones web, ni en mensajes
   de error, ni siquiera para depurar (celtatech/CLAUDE.md §6). */
export function CamposDeDomicilio({ valor, alCambiar, catalogo, deshabilitado = false, prefijo = '', requerido = false }) {
  const { t } = useLocale();
  const propio = useCatalogoDeLugares({ omitir: Boolean(catalogo) });
  const { lugares, zonas, estado } = catalogo ?? propio;
  const partes = valor ?? DOMICILIO_VACIO;

  // Los nombres de los campos llevan prefijo para las pantallas que muestran dos domicilios a la
  // vez: sin él, las etiquetas de un formulario apuntarían a los casilleros del otro.
  const campo = (nombre) => `${prefijo}${nombre}`;
  const cambiar = (nombre) => (e) => alCambiar({ ...partes, [nombre]: e.target.value });

  return (
    <>
      <FormField
        label={t.comun.domicilio_calle}
        name={campo('calle')}
        required={requerido}
        value={partes.calle ?? ''}
        onChange={cambiar('calle')}
        disabled={deshabilitado}
      />
      <FormField
        label={t.comun.domicilio_numero}
        name={campo('numero')}
        value={partes.numero ?? ''}
        onChange={cambiar('numero')}
        disabled={deshabilitado}
      />
      <FormField
        label={t.comun.domicilio_piso}
        name={campo('piso')}
        value={partes.piso ?? ''}
        onChange={cambiar('piso')}
        disabled={deshabilitado}
      />
      <FormField
        label={t.comun.domicilio_unidad}
        name={campo('unidad')}
        value={partes.unidad ?? ''}
        onChange={cambiar('unidad')}
        disabled={deshabilitado}
      />
      <ElegirUnLugar
        lugares={lugares}
        zonas={zonas}
        estado={estado}
        name={campo('lugar_id')}
        valor={partes.lugar_id ?? ''}
        onChange={(lugarId) => alCambiar({ ...partes, lugar_id: lugarId })}
        requerido={requerido}
        deshabilitado={deshabilitado}
      />
    </>
  );
}
