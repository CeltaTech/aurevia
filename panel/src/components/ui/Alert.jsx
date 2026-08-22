// Un aviso que aparece después de una acción tiene que anunciarse solo: quien usa un lector
// de pantalla no vuelve a recorrer la pantalla cada tanto para ver si salió un cartel nuevo.
// El error interrumpe lo que se esté leyendo (`alert`), porque frena el trabajo; el resto
// espera a que el lector termine la frase en curso (`status`).
export function Alert({ variant = 'info', children }) {
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
