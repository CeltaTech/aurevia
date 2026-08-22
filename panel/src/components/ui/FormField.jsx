// `ayuda` es la línea chica debajo del campo: explica qué se espera ahí antes de que el
// usuario se equivoque, en vez de corregirlo después con un mensaje de error.
export function FormField({ label, name, type = 'text', required, children, error, ayuda, ...rest }) {
  const fieldId = `field-${name}`;
  // La ayuda y el error se cuelgan del campo con `aria-describedby`, y el campo que falló se
  // marca con `aria-invalid`. Sin eso, un lector de pantalla lee la caja y su etiqueta y nada
  // más: la explicación de qué se esperaba y el motivo del rechazo quedan dos renglones más
  // abajo, sueltos, y quien no ve la pantalla no tiene cómo saber que hablan de ese campo.
  const ayudaId = `${fieldId}-ayuda`;
  const errorId = `${fieldId}-error`;
  const descrito = [ayuda ? ayudaId : null, error ? errorId : null].filter(Boolean).join(' ');
  const accesibilidad = {
    'aria-describedby': descrito || undefined,
    'aria-invalid': error ? 'true' : undefined,
  };

  if (type === 'textarea') {
    return (
      <div className="form-field">
        <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
        <textarea id={fieldId} name={name} required={required} {...accesibilidad} {...rest} />
        {ayuda && <small className="form-ayuda" id={ayudaId}>{ayuda}</small>}
        {error && <span className="form-error" id={errorId}>{error}</span>}
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="form-field">
        <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
        <select id={fieldId} name={name} required={required} {...accesibilidad} {...rest}>
          {children}
        </select>
        {ayuda && <small className="form-ayuda" id={ayudaId}>{ayuda}</small>}
        {error && <span className="form-error" id={errorId}>{error}</span>}
      </div>
    );
  }

  if (type === 'checkbox') {
    return (
      <div className="form-field form-field-checkbox">
        <label htmlFor={fieldId}>
          <input id={fieldId} name={name} type="checkbox" required={required} {...accesibilidad} {...rest} />
          {label}{required && <span className="required">*</span>}
        </label>
        {ayuda && <small className="form-ayuda" id={ayudaId}>{ayuda}</small>}
        {error && <span className="form-error" id={errorId}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="form-field">
      <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
      <input id={fieldId} name={name} type={type} required={required} {...accesibilidad} {...rest} />
      {ayuda && <small className="form-ayuda" id={ayudaId}>{ayuda}</small>}
      {error && <span className="form-error" id={errorId}>{error}</span>}
    </div>
  );
}
