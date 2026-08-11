import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

// El catálogo de tipos de Asistente, tal como lo ve esta Prestadora: los
// generales de CeltaTech más los que ella misma creó. No hace falta filtrar por
// Prestadora acá — las reglas de la base ya devuelven unos y otros y nada más.
//
// Lo usan tres pantallas (la lista de Asistentes, el perfil de uno y el
// formulario de alta) y las tres tienen que ver lo mismo, así que la consulta
// se escribe una sola vez (`CLAUDE.md` §7, regla 12).
//
// Devuelve dos cosas distintas a propósito:
//
//   `paraElegir` son los tipos encendidos, los únicos que se ofrecen en una
//                lista desplegable. Un tipo apagado no se elige más.
//   `porId`      son todos, encendidos y apagados, buscables por su
//                identificador. Hace falta porque un Asistente puede tener un
//                tipo que después se apagó: se le sigue mostrando el nombre
//                que tiene, no un renglón en blanco.
export function useTiposAsistente() {
  const { t } = useLocale();
  const [todos, setTodos] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('tipos_asistente')
      .select('*')
      .order('orden');

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setTodos(data ?? []);
    setEstado('listo');
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const paraElegir = useMemo(() => todos.filter((tipo) => tipo.activo), [todos]);
  const porId = useMemo(() => new Map(todos.map((tipo) => [tipo.id, tipo])), [todos]);

  return { paraElegir, porId, estado, error, recargar };
}
