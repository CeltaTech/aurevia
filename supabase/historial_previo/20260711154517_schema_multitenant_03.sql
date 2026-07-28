ALTER TABLE ausencias ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE guardias_cobertura ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE ceses ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE lista_precios ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE prestaciones ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE paquetes_prestaciones ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE paquete_prestacion_items ALTER COLUMN prestadora_id DROP DEFAULT;
ALTER TABLE certificados ALTER COLUMN prestadora_id DROP DEFAULT;;
