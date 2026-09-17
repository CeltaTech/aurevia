import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { con } from '../../lib/textos';
import { minutosQueLeQuedan } from '../../lib/alarmasTomadas';

/* «LA TOMO YO», EL MISMO BOTÓN PARA LAS CUATRO CLASES DE ALARMA

   Hasta acá una alarma insistía hasta que el problema se resolvía, y nadie podía decir que la
   estaba atendiendo. Pasaban las dos cosas peores a la vez: quien la estaba atendiendo seguía
   recibiendo avisos de algo que ya tenía en la mano, y los demás no tenían cómo enterarse de que
   alguien se había ocupado, así que o se ocupaban todos o no se ocupaba nadie.

   TOMARLA NO ES RESOLVERLA, Y EL BOTÓN NO SE PARECE AL DE RESOLVER. La alarma sigue abierta, sigue
   contando el tiempo y sigue en esta lista; lo único que cambia es que deja de avisar mientras
   alguien la atiende, y que la pantalla dice quién.

   Y DICE CUÁNTO LE QUEDA, PORQUE LA TOMA VENCE. Una alarma que se calla para siempre porque
   alguien apretó un botón es peor que una que insiste: se apagaría sola justo el día en que esa
   persona tuvo que salir corriendo. Cuando se le cumple el rato la alarma vuelve, y quien sigue
   trabajando en el asunto la vuelve a tomar sin ninguna penalidad. Por eso el renglón muestra los
   minutos que faltan: el número es la promesa de que la alarma va a volver. */

export function LaTomoYo({ tipo, referenciaId, tomaDe, tomar, soltar, trabajando, regla }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const toma = tomaDe(tipo, referenciaId);
  const ocupado = trabajando === referenciaId;

  if (!toma) {
    return (
      <Button
        variant="secondary"
        onClick={() => tomar(tipo, referenciaId, usuario?.id)}
        disabled={ocupado || !usuario?.id}
        title={t.continuidad.la_tomo_yo_ayuda}
      >
        {t.continuidad.la_tomo_yo}
      </Button>
    );
  }

  const minutos = minutosQueLeQuedan(toma, new Date(), regla);
  const laTomeYo = toma.tomada_por === usuario?.id;

  return (
    <div className="la-tomo-yo">
      <span>
        {con(t.continuidad.la_esta_atendiendo, { nombre: toma.tomada_por_nombre || '—' })}
        {' · '}
        {con(t.continuidad.la_alarma_vuelve_en, { minutos })}
      </span>
      {/* La suelta quien la tomó. Otra persona no puede: decir que ya no la atiende alguien que
          nunca dijo que la atendía es escribir por cuenta ajena. Si se fue sin soltarla, el rato
          se cumple solo y la alarma vuelve, que es justamente para lo que vence. */}
      {laTomeYo && (
        <Button variant="secondary" onClick={() => soltar(toma)} disabled={ocupado}>
          {t.continuidad.ya_no_la_atiendo}
        </Button>
      )}
    </div>
  );
}
