import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { llamarApiPanel } from '../../lib/apiPanel';
import { marcaGuardada, guardarMarca } from '../../lib/marcaDelEquipo';
import { mensajeDeError } from '../../lib/errores';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';

/* ENTRAR DESDE UN EQUIPO NUEVO.
   ==========================================================================

   Se pregunta una sola vez por aparato, apenas se entra, y no todos los días. Si de este navegador
   ya se entró antes, no aparece nada.

   NO SE PIDE EL CÓDIGO A QUIEN NO PUEDE RECIBIRLO. La cuenta sin número verificado, y la Prestadora
   que todavía no tiene por dónde mandarlo, entran igual que siempre y reciben un aviso por correo.
   Eso lo resuelve el motor: acá lo único que se hace es mostrar el casillero cuando el motor lo pide.

   Mientras el código esté pendiente, la pantalla de atrás no se usa. */
export function EquipoNuevo() {
  const { t } = useLocale();
  // No lleva forma de cerrarse: mientras el código esté pendiente no hay nada que hacer detrás.
  // El recuadro se anuncia igual y el tabulador da la vuelta adentro.
  const modal = useModalAccesible(() => {});
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vigente = true;

    (async () => {
      try {
        const respuesta = await llamarApiPanel('/cuenta-segura/equipo/reconocer', {
          method: 'POST',
          body: JSON.stringify({ marca: marcaGuardada() }),
        });
        if (!vigente) return;
        if (respuesta.marca) guardarMarca(respuesta.marca);
        if (respuesta.requiereCodigo) setPidiendoCodigo(true);
      } catch (err) {
        // Que este control falle no puede dejar a nadie afuera del Panel: lo que se pierde es la
        // pregunta, no la sesión. El detalle queda en la consola.
        console.error('EquipoNuevo:', err?.message);
      }
    })();

    return () => {
      vigente = false;
    };
  }, []);

  if (!pidiendoCodigo) return null;

  async function handleConfirmar(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const respuesta = await llamarApiPanel('/cuenta-segura/equipo/confirmar', {
        method: 'POST',
        body: JSON.stringify({ codigo }),
      });
      if (respuesta.marca) guardarMarca(respuesta.marca);
      setPidiendoCodigo(false);
      setCodigo('');
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="panel-modal-fondo">
      <div className="panel-modal" {...modal.props}>
        <form onSubmit={handleConfirmar}>
          <h2 id={modal.idTitulo}>{t.cuenta_segura.equipo_nuevo_titulo}</h2>
          {error && <Alert variant="error">{error}</Alert>}
          <FormField
            label={t.cuenta_segura.codigo}
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <div className="panel-modal-acciones">
            <Button type="submit" disabled={enviando || !codigo}>
              {enviando ? t.comun.guardando : t.cuenta_segura.confirmar}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
