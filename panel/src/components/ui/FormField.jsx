// `ayuda` es la línea chica debajo del campo: explica qué se espera ahí antes de que el
// usuario se equivoque, en vez de corregirlo después con un mensaje de error.
export function FormField({ label, name, type = 'text', required, children, error, ayuda, ...rest }) {
  const fieldId = `field-${name}`;

  if (type === 'textarea') {
    return (
      <div className="form-field">
        <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
        <textarea id={fieldId} name={name} required={required} {...rest} />
        {ayuda && <small className="form-ayuda">{ayuda}</small>}
        {error && <span className="form-error">{error}</span>}
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="form-field">
        <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
        <select id={fieldId} name={name} required={required} {...rest}>
          {children}
        </select>
        {ayuda && <small className="form-ayuda">{ayuda}</small>}
        {error && <span className="form-error">{error}</span>}
      </div>
    );
  }

  if (type === 'checkbox') {
    return (
      <div className="form-field form-field-checkbox">
        <label htmlFor={fieldId}>
          <input id={fieldId} name={name} type="checkbox" required={required} {...rest} />
          {label}{required && <span className="required">*</span>}
        </label>
        {ayuda && <small className="form-ayuda">{ayuda}</small>}
        {error && <span className="form-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="form-field">
      <label htmlFor={fieldId}>{label}{required && <span className="required">*</span>}</label>
      <input id={fieldId} name={name} type={type} required={required} {...rest} />
      {ayuda && <small className="form-ayuda">{ayuda}</small>}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
