import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { elRolUsaSegundoFactor, elSegundoFactorEsObligatorio } from '../lib/reglaMfaObligatorio';

const AuthContext = createContext(null);

// Quién está mirando, leído de la base. Está acá afuera porque lo usan dos caminos —la carga
// inicial de la sesión y el refresco de abajo— y una sola forma de armar el usuario evita que
// uno de los dos se olvide de la moneda.
//
// La moneda de la Prestadora viaja junto con el usuario porque hay importes que se muestran
// antes de guardarse —una proyección, una cuenta en pantalla— y no tienen todavía una moneda
// propia de la que leerla (`CLAUDE.md` §8, «todo importe se guarda con su moneda»).
//
// DEVUELVE LAS TRES SITUACIONES POR SEPARADO, y no un usuario en nulo para todas. Antes
// esta lectura descartaba el error: una consulta que no se podía hacer terminaba en
// el mismo nulo que una fila inexistente, y el Panel echaba a la pantalla de ingreso a alguien
// que sí tenía sesión. `maybeSingle` es lo que separa los dos casos: sin fila devuelve nulo sin
// error, y entonces cualquier error que llegue acá es de verdad una falla.
async function traerUsuario(userId) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, rol, nombre, prestadora_id, prestadoras(moneda)')
    .eq('id', userId)
    .maybeSingle();
  if (error) return { usuario: null, fallo: true };
  return { usuario: data ? { ...data, moneda: data.prestadoras?.moneda ?? null } : null, fallo: false };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  const [usuario, setUsuario] = useState(null);
  // Las tres situaciones, dichas por separado: 'cargando' mientras la respuesta viaja, 'error'
  // cuando no se pudo saber quién está mirando, y 'listo' cuando se supo —haya fila o no—. Sin
  // esta separación, quien consume este proveedor no puede distinguir «todavía no llegó» de
  // «falló», y una pantalla que trata un fallo como «no hay nada» muestra un vacío tranquilizador
  // en vez de un error (`celtatech/CLAUDE.md` §5, todo control de acceso falla cerrado).
  const [estado, setEstado] = useState('cargando');
  const cargando = estado === 'cargando';
  // Ítem H del pendiente #30: 'na' (no aplica o el toggle está apagado), 'requiere_enrolamiento'
  // (primera vez, sin factor TOTP verificado), 'requiere_challenge' (factor verificado pero
  // esta sesión sigue en aal1), 'ok' (aal2 alcanzado). null mientras se evalúa.
  const [mfaEstado, setMfaEstado] = useState(null);

  async function evaluarMfa(usuarioActual) {
    if (!usuarioActual || !elRolUsaSegundoFactor(usuarioActual.rol)) {
      setMfaEstado('na');
      return;
    }

    // La lectura se pasa entera —con su error— a la regla compartida: si la fila única de
    // configuración no se puede leer, se exige el segundo factor igual y queda registrado
    // (lib/reglaMfaObligatorio.js; CLAUDE.md §7 regla 12).
    const lecturaConfig = await supabase.from('configuracion_plataforma').select('mfa_admin_obligatorio').single();
    if (!elSegundoFactorEsObligatorio(lecturaConfig)) {
      setMfaEstado('na');
      return;
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') {
      setMfaEstado('ok');
      return;
    }

    const { data: factores } = await supabase.auth.mfa.listFactors();
    const factorVerificado = factores?.totp?.find((f) => f.status === 'verified');
    setMfaEstado(factorVerificado ? 'requiere_challenge' : 'requiere_enrolamiento');
  }

  useEffect(() => {
    let activo = true;

    async function cargarSesion() {
      const { data, error } = await supabase.auth.getSession();
      if (!activo) return;
      if (error) {
        // No se pudo saber si hay sesión. Eso no es «no hay sesión»: decirlo así mandaría a la
        // pantalla de ingreso a quien está trabajando, y encima sin explicación.
        setEstado('error');
        return;
      }
      setSession(data.session);
      if (data.session) {
        await cargarUsuario(data.session.user.id);
      } else {
        setMfaEstado('na');
        setEstado('listo');
      }
    }

    async function cargarUsuario(userId) {
      setEstado('cargando');
      let traido;
      try {
        traido = await traerUsuario(userId);
      } catch {
        traido = { usuario: null, fallo: true };
      }
      if (!activo) return;
      if (traido.fallo) {
        // El usuario anterior no queda puesto: con la lectura fallada no se sabe quién está
        // mirando, y dejar el de antes sería contestar con un dato de otra sesión.
        setUsuario(null);
        setEstado('error');
        return;
      }
      setUsuario(traido.usuario);
      await evaluarMfa(traido.usuario);
      if (!activo) return;
      setEstado('listo');
    }

    cargarSesion();

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSession(nuevaSesion);
      if (nuevaSesion) {
        cargarUsuario(nuevaSesion.user.id);
      } else {
        setUsuario(null);
        setMfaEstado('na');
        setEstado('listo');
      }
    });

    return () => {
      activo = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  async function refrescarMfa() {
    await evaluarMfa(usuario);
  }

  // Volver a leer al usuario sin salir y entrar. Lo pide la pantalla que cambia la moneda de la
  // Prestadora: el dato viaja pegado al usuario, así que sin esto los importes que se muestran
  // antes de guardarse seguirían escritos en la moneda anterior hasta la próxima entrada.
  async function refrescarUsuario() {
    const userId = session?.user?.id;
    if (!userId) return;
    const traido = await traerUsuario(userId);
    // Si la relectura falla, se deja el usuario que ya estaba: es el de esta misma sesión y
    // sigue siendo cierto. Lo que no se hace es reemplazarlo por un nulo, que se leería como
    // «esta persona ya no existe».
    if (traido.fallo) {
      setEstado('error');
      return;
    }
    setUsuario(traido.usuario);
  }

  return (
    <AuthContext.Provider
      value={{ session, usuario, estado, cargando, mfaEstado, login, logout, refrescarMfa, refrescarUsuario }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
