-- S3-05 · Reprocesar reportes con error: cada reporte de staging en ERROR se puede volver a
-- validar hasta 3 veces (después se descarta el lote o se registra una lectura manual).
ALTER TABLE public.reportes_consolidado_staging
  ADD COLUMN intentos_reproceso integer NOT NULL DEFAULT 0;

ALTER TABLE public.reportes_consolidado_staging
  ADD CONSTRAINT reportes_consolidado_staging_intentos_chk CHECK (intentos_reproceso BETWEEN 0 AND 3);

COMMENT ON COLUMN public.reportes_consolidado_staging.intentos_reproceso IS 'Veces que se reprocesó el reporte en ERROR (máximo 3, S3-05)';
