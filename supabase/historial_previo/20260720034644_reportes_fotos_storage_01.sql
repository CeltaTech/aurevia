-- Bucket privado para las fotos opcionales del Reporte Diario (reportes.foto_url) — Etapa 3
-- (PWA Asistentes), mismo patrón que certificados-medicos: privado, deny-by-default en
-- storage.objects (control real vía backend con Service Role Key), acceso solo por URL
-- firmada de corta duración. Dato de salud del paciente (regla 7 CLAUDE.md).

INSERT INTO storage.buckets (id, name, public)
VALUES ('reportes-fotos', 'reportes-fotos', false)
ON CONFLICT (id) DO NOTHING;;
