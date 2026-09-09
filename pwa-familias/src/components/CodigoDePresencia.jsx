import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { mensajeDeError } from '../lib/errores';

/**
 * El código que se muestra en la pantalla del teléfono para que lo lea el Asistente que llega
 * (pendiente #113).
 *
 * REEMPLAZA AL CARTEL IMPRESO del domicilio, que era un secreto permanente a la vista de
 * cualquiera que pasara por la puerta: se podía fotografiar una vez y usar desde cualquier lado.
 * Éste se renueva solo cada pocos segundos, así que una foto de la pantalla no sirve un minuto
 * después.
 *
 * LO USAN LAS DOS APLICACIONES y por eso no sabe en cuál está: quién lo muestra —la Familia, o el
 * Asistente que se va cuando hay relevo— lo resuelve el motor con la sesión de quien pide, nunca
 * con un dato que mande el teléfono. Acá llega como `pedirCodigo`, una función sin argumentos que
 * devuelve { codigo, segundos, expiraEn }.
 *
 * CADA CUÁNTO SE RENUEVA LO DECIDE CADA PRESTADORA desde Configuración, y viaja en `segundos`.
 * Acá no hay ningún número escrito: si el pedido no trae `segundos`, no se programa ninguna
 * renovación y queda solamente el botón de pedir otro a mano.
 */
export default function CodigoDePresencia({ t, pedirCodigo }) {
  // undefined = todavía cargando · null = el motor no devolvió ningún código · objeto = listo
  const [codigo, setCodigo] = useState(undefined);
  const [error, setError] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [restan, setRestan] = useState(null);
  // El componente se desmonta apenas quien lo mira cambia de pantalla, y los dos temporizadores
  // de abajo pueden dispararse después. Sin esto, escribirían sobre un componente que ya no está.
  const vivoRef = useRef(true);
  const renovacionRef = useRef(null);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
      if (renovacionRef.current) clearTimeout(renovacionRef.current);
    };
  }, []);

  const pedir = useCallback(async () => {
    setPidiendo(true);
    setError('');
    try {
      const nuevo = await pedirCodigo();
      if (!vivoRef.current) return;
      if (!nuevo?.codigo) {
        setCodigo(null);
        return;
      }
      setCodigo(nuevo);
      setRestan(nuevo.segundos ?? null);
      try {
        const imagen = await QRCode.toDataURL(nuevo.codigo, { width: 220, margin: 1 });
        if (vivoRef.current) setQrDataUrl(imagen);
      } catch {
        // Sin la imagen quedan los seis dígitos, que es lo que de verdad se compara. No es un
        // error que valga la pena mostrar: el pase se puede hacer tipeando.
        if (vivoRef.current) setQrDataUrl(null);
      }
      if (renovacionRef.current) clearTimeout(renovacionRef.current);
      if (nuevo.segundos > 0) {
        renovacionRef.current = setTimeout(() => {
          if (vivoRef.current) pedir();
        }, nuevo.segundos * 1000);
      }
    } catch (e) {
      if (vivoRef.current) setError(mensajeDeError(e, t, 'pedir el código de presencia'));
    } finally {
      if (vivoRef.current) setPidiendo(false);
    }
  }, [pedirCodigo, t]);

  useEffect(() => {
    pedir();
  }, [pedir]);

  // La cuenta regresiva es sólo para que quien mira sepa que la pantalla está viva y que el
  // número de arriba se va a cambiar solo. Quien renueva es el temporizador de `pedir`.
  useEffect(() => {
    if (!codigo?.segundos) return undefined;
    const reloj = setInterval(() => setRestan((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(reloj);
  }, [codigo]);

  if (error) {
    return (
      <div className="guardia-card">
        <div className="alert alert-error" role="alert">{error}</div>
        <button type="button" className="btn btn-secondary btn-full" onClick={pedir} disabled={pidiendo}>
          {t.codigo_de_presencia.reintentar}
        </button>
      </div>
    );
  }

  if (codigo === undefined) {
    return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;
  }

  if (codigo === null) {
    return <div className="estado-vacio" role="status">{t.codigo_de_presencia.sin_codigo}</div>;
  }

  return (
    <div className="guardia-card">
      <p className="guardia-card-detalle">{t.codigo_de_presencia.instrucciones}</p>
      {qrDataUrl && <img className="codigo-de-presencia-qr" src={qrDataUrl} alt={t.codigo_de_presencia.qr_alt} />}
      <p className="codigo-de-presencia-numero">{codigo.codigo}</p>
      <p className="guardia-card-detalle">
        {restan > 0 ? t.codigo_de_presencia.se_renueva.replace('{segundos}', restan) : t.codigo_de_presencia.renovando}
      </p>
      <p className="guardia-card-detalle">{t.codigo_de_presencia.por_que_cambia}</p>
      <button type="button" className="btn btn-secondary btn-full" onClick={pedir} disabled={pidiendo}>
        {pidiendo ? t.codigo_de_presencia.pidiendo : t.codigo_de_presencia.pedir_otro}
      </button>
    </div>
  );
}
