import { Router } from 'express';
import { resolverPrestadoraPublica } from '../middleware/resolverPrestadoraPublica.js';
import { marcaDeLaPrestadora } from '../utils/marcaPrestadora.js';

// `mergeParams` para que llegue el `:prestadora` de la dirección donde se monta este router
// (server.js): de ahí sale la Prestadora, y de ningún encabezado.
export const marcaDeLaPuertaRouter = Router({ mergeParams: true });

// CON QUÉ MARCA SE PRESENTA LA PUERTA POR DONDE SE ESTÁ ENTRANDO.
//
// Sin sesión a propósito: es lo que la pantalla de ingreso necesita saber antes de que nadie
// escriba una clave. Quien entra al Panel de una Prestadora contrató a esa Prestadora, así que lo
// que tiene que ver ahí es el nombre de ella. La línea al pie —«con la tecnología de …»— va igual,
// siempre, y la pone la pantalla.
//
// QUÉ SALE Y QUÉ NO. El nombre visible, el logotipo y el identificador de la Prestadora, que es lo
// que hace falta para armar la cuenta de acceso de esta puerta. Nada más: el teléfono, el correo y
// las zonas son del sitio público de la Prestadora y tienen su propia dirección.
//
// NO DICE QUIÉNES EXISTEN. Una dirección que no resuelve contesta lo mismo que cualquier otra que
// no resuelve, y no ofrece ninguna lista.
marcaDeLaPuertaRouter.get('/', resolverPrestadoraPublica, async (req, res) => {
  const marca = await marcaDeLaPrestadora(req.prestadoraPublica.prestadora_id);
  res.json({
    prestadoraId: req.prestadoraPublica.prestadora_id,
    nombre: marca.nombre || req.prestadoraPublica.nombre || null,
    logoUrl: marca.logoUrl,
  });
});
