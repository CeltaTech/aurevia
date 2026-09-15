/* El respaldo también tiene que traer los archivos, no sólo la base.
   ==========================================================================

   QUÉ RESUELVE. Hasta hoy el respaldo diario subía el volcado de la base y nada más. Con eso,
   el día que hubiera que restaurar, volvían las filas y no volvían los archivos: la ficha del
   Asistente diría que tiene su certificado cargado y el certificado no estaría; el reporte
   nombraría una foto que ya no existe; la prescripción quedaría en un renglón sin la receta.
   Una base restaurada que miente sobre lo que tiene es peor que no tener respaldo, porque nadie
   se entera hasta que alguien va a buscar el archivo.

   LA LISTA DE DEPÓSITOS NO SE ESCRIBE ACÁ. Se le pregunta a la base cuáles hay. Un depósito
   nuevo nace en una migración, y si además hubiera que acordarse de agregarlo a una lista de
   este archivo, el día que alguien se olvide el respaldo seguiría diciendo que salió bien
   mientras deja un depósito entero afuera.

   SE COPIA LO QUE FALTA, NO TODO TODOS LOS DÍAS. Los archivos no cambian: una foto subida hace
   un año es la misma hoy. Volver a subirlas enteras cada noche costaría cada vez más y tardaría
   cada vez más, hasta que un día no termina. Así que de cada archivo se mira si el destino ya
   tiene uno igual —mismo tamaño y misma fecha de modificación— y sólo se sube el que falta o el
   que cambió. El espejo queda en `archivos/<depósito>/<ruta>`, con la misma forma que adentro
   del depósito, para que restaurar sea copiar de vuelta y no desarmar nada.

   LO QUE SE REGISTRA SON CANTIDADES, NUNCA RUTAS. La ruta de un archivo de acá empieza por la
   Prestadora y sigue por la persona: `certificados-medicos/<prestadora>/<asistente>/…` dice
   quién tiene un certificado médico, que es justamente lo que no va a un registro
   (`celtatech/CLAUDE.md` §6). Al final se cuenta cuántos se copiaron, cuántos ya estaban y
   cuántos fallaron.

   Y UN ARCHIVO QUE FALLA NO CARGA AL RESTO. Se cuenta, se sigue con los demás, y recién al
   final el respaldo avisa que hubo fallas. Cortar en el primero dejaría afuera todo lo que
   venía después por culpa de un archivo. */

/**
 * Adaptador de lectura sobre el almacenamiento de Supabase.
 *
 * Existe para que la copia se pueda probar sin nube: lo que la copia necesita son tres
 * preguntas —qué depósitos hay, qué archivos tiene uno, y dame este archivo—, y nada más.
 */
export function depositosDeSupabase(supabase) {
  return {
    async listarDepositos() {
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw new Error(`No se pudieron listar los depósitos: ${error.message}`);
      return (data ?? []).map((d) => d.name);
    },

    async listarArchivos(deposito) {
      // El listado de Supabase es por carpeta y paginado: devuelve las entradas de un nivel, y
      // las carpetas vienen sin `id`. Se recorre hacia abajo hasta que no queda ninguna.
      const encontrados = [];
      const pendientes = [''];
      while (pendientes.length > 0) {
        const prefijo = pendientes.pop();
        let desde = 0;
        for (;;) {
          const { data, error } = await supabase.storage
            .from(deposito)
            .list(prefijo, { limit: 100, offset: desde });
          if (error) throw new Error(`No se pudo listar ${deposito}: ${error.message}`);
          const entradas = data ?? [];
          for (const entrada of entradas) {
            const ruta = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
            if (entrada.id) {
              encontrados.push({
                ruta,
                tamano: entrada.metadata?.size ?? null,
                actualizado: entrada.updated_at ?? null,
              });
            } else {
              pendientes.push(ruta);
            }
          }
          if (entradas.length < 100) break;
          desde += entradas.length;
        }
      }
      return encontrados;
    },

    async descargar(deposito, ruta) {
      const { data, error } = await supabase.storage.from(deposito).download(ruta);
      if (error) throw new Error(`No se pudo bajar el archivo: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

/**
 * El motivo de una falla, sin la ruta del archivo adentro.
 *
 * La ruta de acá dice quién es el dueño del archivo, así que no puede salir en ningún registro
 * aunque venga pegada al mensaje del proveedor.
 */
export function sinLaRuta(mensaje, ...rutas) {
  let texto = String(mensaje ?? '');
  for (const ruta of rutas) {
    if (ruta) texto = texto.split(ruta).join('<ruta>');
  }
  return texto;
}

/** La clave con la que un archivo del depósito vive adentro del destino. */
export function claveEnElDestino(deposito, ruta) {
  return `archivos/${deposito}/${ruta}`;
}

/**
 * Copia todos los archivos de todos los depósitos a cada destino.
 *
 * `almacenamiento` contesta las tres preguntas de arriba. Cada destino sabe dos cosas: si ya
 * tiene un archivo igual, y cómo guardar uno. Devuelve el recuento, sin ninguna ruta adentro.
 */
export async function copiarDepositos({ almacenamiento, destinos, avisar = () => {} }) {
  const cuenta = { depositos: 0, copiados: 0, yaEstaban: 0, fallados: 0 };
  const depositos = await almacenamiento.listarDepositos();

  for (const deposito of depositos) {
    cuenta.depositos += 1;
    const archivos = await almacenamiento.listarArchivos(deposito);
    avisar(`Depósito ${deposito}: ${archivos.length} archivos.`);

    for (const archivo of archivos) {
      const clave = claveEnElDestino(deposito, archivo.ruta);
      // Se le pregunta a los destinos antes de bajar nada: si todos lo tienen igual, este
      // archivo no se baja de Supabase ni una vez.
      const faltaEn = [];
      for (const destino of destinos) {
        try {
          if (await destino.yaEstaIgual(clave, archivo)) continue;
        } catch {
          // Un destino que no sabe contestar se trata como si no lo tuviera: se vuelve a subir.
        }
        faltaEn.push(destino);
      }

      if (faltaEn.length === 0) {
        cuenta.yaEstaban += 1;
        continue;
      }

      try {
        const cuerpo = await almacenamiento.descargar(deposito, archivo.ruta);
        for (const destino of faltaEn) await destino.subir(clave, cuerpo, archivo);
        cuenta.copiados += 1;
      } catch (err) {
        cuenta.fallados += 1;
        // El motivo sí, la ruta no: el error de la nube suele traer la clave adentro del texto,
        // y esa clave dice de quién es el archivo. Se la saca antes de que salga por ningún lado.
        avisar(`No se pudo copiar un archivo de ${deposito}: ${sinLaRuta(err.message, clave, archivo.ruta)}`);
      }
    }
  }

  return cuenta;
}
