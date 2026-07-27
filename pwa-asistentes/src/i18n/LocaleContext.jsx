import { createContext, useContext, useMemo, useState } from 'react';
import { T, DEFAULT_LOCALE, LOCALES } from './translations';
import { sustituirIdentidadProfundo } from '../config/identidadProducto.js';

const LocaleContext = createContext(null);

function localeInicial() {
  const guardado = localStorage.getItem('plm-pwa-asistentes-locale');
  return LOCALES.includes(guardado) ? guardado : DEFAULT_LOCALE;
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(localeInicial);

  function setLocale(nuevoLocale) {
    if (!LOCALES.includes(nuevoLocale)) return;
    localStorage.setItem('plm-pwa-asistentes-locale', nuevoLocale);
    setLocaleState(nuevoLocale);
  }

  // Los textos nombran al producto con el marcador {{producto}} y se resuelve acá, una sola
  // vez por idioma. Se hace en este punto —y no en cada componente— porque `t` se consume
  // como objeto plano (t.auth.titulo), no como función t('auth.titulo'): así ningún punto
  // de consumo cambia por esto. Ver src/config/identidadProducto.js.
  const t = useMemo(() => sustituirIdentidadProfundo(T[locale]), [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale debe usarse dentro de LocaleProvider');
  return ctx;
}
