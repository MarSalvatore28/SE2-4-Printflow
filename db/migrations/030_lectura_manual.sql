-- S3-04 · Lectura manual: el operador registra los contadores leídos en la máquina cuando la
-- impresora no envió su correo. La lectura va directo a reportes_oficiales, marcada como MANUAL.
ALTER TABLE public.reportes_oficiales
  ADD COLUMN origen varchar(10) NOT NULL DEFAULT 'CORREO',
  ADD COLUMN observacion text,
  ADD COLUMN usuario_registro_id integer;

ALTER TABLE public.reportes_oficiales
  ADD CONSTRAINT reportes_oficiales_origen_chk CHECK (origen IN ('CORREO', 'MANUAL')),
  ADD CONSTRAINT reportes_oficiales_usuario_registro_fk
    FOREIGN KEY (usuario_registro_id) REFERENCES public.usuarios (id_usuario);

-- Una lectura manual siempre dice por qué se registró a mano y quién lo hizo
ALTER TABLE public.reportes_oficiales
  ADD CONSTRAINT reportes_oficiales_manual_chk
    CHECK (origen <> 'MANUAL' OR (observacion IS NOT NULL AND btrim(observacion) <> '' AND usuario_registro_id IS NOT NULL));

COMMENT ON COLUMN public.reportes_oficiales.origen IS 'CORREO (ingesta y aprobación de un lote) o MANUAL (registrada por un operador, S3-04)';
COMMENT ON COLUMN public.reportes_oficiales.observacion IS 'Por qué se registró la lectura a mano (obligatoria si origen = MANUAL)';
COMMENT ON COLUMN public.reportes_oficiales.usuario_registro_id IS 'Usuario que registró la lectura manual';
