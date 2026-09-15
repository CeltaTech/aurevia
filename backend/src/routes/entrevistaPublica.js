import { Router } from 'express';
import { entrevistaPorLlave } from '../utils/entrevistaDePostulacion.js';
import { responderError } from '../utils/errorConMotivo.js';

/* La única puerta del postulante.
   ==============================

   SIN SESIÓN A PROPÓSITO. Quien llega acá se postuló y todavía no es Asistente: no hay ninguna
   cuenta que darle. Lo que trae es la llave que le llegó por correo, y la llave es toda su
   credencial. Es la misma forma que ya tiene la activación de cuenta (`activarCuenta.js`).

   NO LLEVA LA PRESTADORA EN LA DIRECCIÓN, y ahí se separa de los tres caminos públicos del sitio
   de una Prestadora. Aquéllos atienden a cualquiera que entre al sitio, así que la dirección tiene
   que decir de qué Prestadora se trata. Acá la Prestadora sale de la llave: pedírsela a la persona
   sería pedirle un dato que no tiene.

   LO QUE SALE LO DECIDE `entrevistaPorLlave`, que falla cerrado y no distingue una llave que no
   existe de una entrevista que ya se cerró. */

export const entrevistaPublicaRouter = Router();

entrevistaPublicaRouter.get('/:llave', async (req, res) => {
  try {
    res.json(await entrevistaPorLlave(req.params.llave));
  } catch (error) {
    responderError(res, error);
  }
});
