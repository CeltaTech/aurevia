import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { anotarNombreDeLaPrestadora } from '../i18n/marcaEnElTexto';

const EmpresaContext = createContext(null);

// Con sesión, cada Organización lee su propia fila vía RLS (prestadora_lee_su_configuracion).
//
// Sin sesión no se carga nada acá, y es a propósito: esta lectura pasa por RLS y devuelve la
// configuración propia de quien entró. La pantalla de ingreso sí sabe de qué Prestadora se trata
// —se lo dice la dirección del navegador—, pero ese dato lo trae otra pieza: la puerta traduce la
// dirección a segmento (`lib/puertaDeIngreso.js`) y el camino público del motor devuelve sólo el
// nombre y el logotipo. Nada de eso necesita sesión ni pasa por acá.
// DEVUELVE EL FALLO, NO UN NULO. Sin sesión no hay configuración que leer, y eso es una
// respuesta; una lectura que no se pudo hacer es otra cosa, y antes las dos
// terminaban en el mismo nulo. Quien lo consume no podía distinguir «todavía no llegó» de
// «falló», que es la forma de mostrar un vacío tranquilizador en lugar de un error.
async function cargarConfiguracionPropia() {
  const { data, error } = await supabase
    .from('configuracion_prestadora')
    .select('nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto')
    .maybeSingle();
  if (error) return { empresa: null, fallo: true };
  return { empresa: data ?? null, fallo: false };
}

export function EmpresaProvider({ children }) {
  const [empresa, setEmpresa] = useState(null);
  // 'cargando' mientras la respuesta viaja, 'error' cuando no se pudo leer, 'listo' cuando se
  // supo —incluida la pantalla de ingreso, donde saber que todavía no hay configuración propia que
  // leer es una respuesta y no una espera—.
  const [estado, setEstado] = useState('cargando');

  useEffect(() => {
    let activo = true;

    async function cargarSegunSesion(session) {
      if (activo) setEstado('cargando');
      let traido = { empresa: null, fallo: false };
      if (session) {
        try {
          traido = await cargarConfiguracionPropia();
        } catch {
          traido = { empresa: null, fallo: true };
        }
      }
      if (!activo) return;
      if (traido.fallo) {
        setEmpresa(null);
        anotarNombreDeLaPrestadora(null);
        setEstado('error');
        return;
      }
      setEmpresa(traido.empresa);
      // Con qué nombre se presenta la Prestadora, para las frases que la nombran con el
      // marcador {{prestadora}} (i18n/marcaEnElTexto.js). Sin sesión queda en nulo, que es lo
      // que corresponde: la configuración propia recién se lee después de entrar.
      anotarNombreDeLaPrestadora(traido.empresa?.nombre);
      setEstado('listo');
    }

    supabase.auth.getSession().then(({ data: { session } }) => cargarSegunSesion(session));

    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, session) => {
      cargarSegunSesion(session);
    });

    return () => {
      activo = false;
      suscripcion.subscription.unsubscribe();
    };
  }, []);

  return <EmpresaContext.Provider value={{ empresa, estado }}>{children}</EmpresaContext.Provider>;
}

export function useEmpresa() {
  const ctx = useContext(EmpresaContext);
  if (!ctx) throw new Error('useEmpresa debe usarse dentro de EmpresaProvider');
  return ctx;
}
