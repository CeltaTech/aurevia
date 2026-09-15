// ---------------------------------------------------------------------------
// usePanoramaDelPlantel.js — las guardias y los papeles de todo el plantel, en dos consultas
//
// POR QUÉ DOS CONSULTAS Y NO UNA POR PERSONA
// La lista de Asistentes muestra decenas de tarjetas. Preguntar por cada una sería preguntar
// decenas de veces lo mismo: se piden las guardias del próximo mes y los papeles con
// vencimiento de una sola vez, y las cuentas se hacen en `lib/resumenDelPlantel.js`.
//
// POR QUÉ NO VOLTEA LA PANTALLA CUANDO FALLA
// Esto es un agregado a una lista que ya funciona sin él. Si la consulta no vuelve —sin
// conexión, o un rol que no alcanza estas tablas—, las tarjetas se muestran igual y los dos
// datos no aparecen. Lo que no se hace es mostrar un cero: un cero dice "no tiene ninguna
// guardia", que es una afirmación, y acá lo que pasó es que no se pudo preguntar.
//
// El filtro por Prestadora no se escribe: estas consultas salen del navegador con el pase de la
// persona, y ahí el candado es la protección por fila de la base.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { hoyISO, sumarDias } from '../lib/horarios';
import { diasDeAvisoDeLaPrestadora } from '../lib/plazoDeAviso';
import { usePrestadoraActual } from './usePrestadoraActual';
import {
  DIAS_DE_HORIZONTE,
  documentacionPorAsistente,
  guardiasActivasPorAsistente,
} from '../lib/resumenDelPlantel';

/* Las columnas que pide el semáforo para decidir en qué situación está una guardia. Ninguna se
   muestra: si faltara alguna, una guardia en curso se leería como programada y el conteo saldría
   mal sin que nada avise. */
const COLUMNAS_GUARDIA =
  'asistente_id, fecha, hora_inicio, hora_fin, estado, ofrecida_at, oferta_limite_at, checkin_at, checkout_at';

export function usePanoramaDelPlantel() {
  const prestadoraId = usePrestadoraActual();
  const [panorama, setPanorama] = useState({ guardias: null, documentacion: null });

  const cargar = useCallback(async () => {
    const desde = hoyISO();
    const hasta = sumarDias(desde, DIAS_DE_HORIZONTE);

    const [{ data: guardias, error }, { data: documentos, error: errorDocs }, diasAviso] =
      await Promise.all([
        supabase
          .from('guardias')
          .select(COLUMNAS_GUARDIA)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .not('asistente_id', 'is', null),
        supabase
          .from('documentos_asistente')
          .select('asistente_id, fecha_vencimiento, tipos_documento_asistente(requiere_vencimiento)')
          .not('fecha_vencimiento', 'is', null),
        diasDeAvisoDeLaPrestadora(prestadoraId),
      ]);

    setPanorama({
      guardias: error ? null : guardiasActivasPorAsistente(guardias),
      documentacion: errorDocs ? null : documentacionPorAsistente(documentos, diasAviso),
    });
  }, [prestadoraId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return panorama;
}
