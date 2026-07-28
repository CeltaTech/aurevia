ALTER TABLE guardias ADD CONSTRAINT guardias_checkout_bloqueado_requiere_excepcion
  CHECK (
    checkout_at IS NULL
    OR NOT checkout_bloqueado
    OR (checkout_excepcion_motivo IS NOT NULL
        AND checkout_excepcion_autorizado_por IS NOT NULL
        AND checkout_excepcion_at IS NOT NULL)
  );;
