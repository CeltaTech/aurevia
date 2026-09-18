// Un casillero se explica solo: lleva su etiqueta y nada más. Debajo no va ninguna línea de
// explicación — quien trabaja no necesita que le cuenten qué hace el sistema.
export function FormField({ label, name, type = 'text', required, children, error, ...rest }) {
  const fieldId = `field-${name}`;
  // El error se cuelga del campo con `aria-describedby`, y el campo que falló se marca con
  // `aria-invalid`. Sin eso, quien no ve la pantalla escucha la caja y su etiqueta y nada más: el
  // motivo del rechazo queda un renglón más abajo, suelto, sin nada que lo ate a ese campo.
  const errorId = `${fieldId}-error`;
  const accesibilidad = {
    'aria-describedby': error ? errorId : undefined,
    'aria-invalid': error ? 'true' : undefined,
  };

  if (type === 'textarea') {
    return (
      <div className="form-field">
        <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
        <textarea id={fieldId} name={name} required={required} {...accesibilidad} {...rest} />
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
        {error && <span className="form-error" id={errorId}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="form-field">
      <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
      <input id={fieldId} name={name} type={type} required={required} {...accesibilidad} {...rest} />
      {error && <span className="form-error" id={errorId}>{error}</span>}
    </div>
  );
}
