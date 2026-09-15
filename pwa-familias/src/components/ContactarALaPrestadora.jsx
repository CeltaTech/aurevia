import { useContactoDeLaPrestadora, useMarca } from '../context/PerfilContext';
import { con } from '../lib/textos';

/**
 * El botón para hablar con la Prestadora, tal como ella eligió que la llamen.
 *
 * POR QUÉ ESTÁ EN LA PANTALLA DE ALERTAS. Una alerta es la pantalla donde alguien lee algo que lo
 * asusta, muchas veces de madrugada. Leerla y no tener a quién preguntarle es el momento en que
 * la gente sale de la aplicación y llama a cualquier número que encuentre anotado. El botón
 * existe para que ese número sea el que la Prestadora quiso dar.
 *
 * NO LLEVA A NINGUNA PERSONA. Lleva al contacto que la Prestadora cargó en su configuración.
 * Dónde suena es decisión de ella. El teléfono de un Coordinador o de un Asistente no aparece
 * acá ni podría: cómo llegar a alguien del plantel es lo que la modalidad Marketplace abre a
 * pedido, y el motor directamente no lo manda.
 *
 * NO VIAJA NADA ADENTRO DE LA DIRECCIÓN. Ni el nombre del Paciente, ni la alerta, ni su nivel.
 * Un `?text=` con eso escrito adentro sale del teléfono, queda en el historial del navegador y
 * en el mensaje, y lo que dice una alerta es dato de salud. Quien llama cuenta lo que quiere
 * contar.
 *
 * SIN NINGÚN CANAL CARGADO NO SE DIBUJA NADA. Un botón que no lleva a ningún lado es peor que no
 * tenerlo: hace creer que del otro lado hay alguien esperando.
 */
export default function ContactarALaPrestadora({ t }) {
  const contacto = useContactoDeLaPrestadora();
  const marca = useMarca();

  const { telefono, whatsapp, email } = contacto;
  if (!telefono && !whatsapp && !email) return null;

  // WhatsApp arma la dirección con los dígitos solos: ni el «+», ni guiones, ni paréntesis.
  const digitos = whatsapp ? whatsapp.replace(/\D/g, '') : '';

  const titulo = marca.nombre
    ? con(t.contacto.titulo_con_nombre, { prestadora: marca.nombre })
    : t.contacto.titulo;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem' }}>{titulo}</h2>
      <p className="guardia-card-detalle">{t.contacto.explicacion}</p>

      {digitos && (
        <a
          className="btn btn-primary btn-full"
          href={`https://wa.me/${digitos}`}
          target="_blank"
          rel="noreferrer"
        >
          {t.contacto.whatsapp}
        </a>
      )}
      {telefono && (
        <a className="btn btn-secondary btn-full" href={`tel:${telefono}`} style={{ marginTop: '0.5rem' }}>
          {con(t.contacto.llamar, { telefono })}
        </a>
      )}
      {email && (
        <a className="btn btn-secondary btn-full" href={`mailto:${email}`} style={{ marginTop: '0.5rem' }}>
          {t.contacto.email}
        </a>
      )}
    </div>
  );
}
