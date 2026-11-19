-- S3-01: una sola lectura aprobada por máquina y período
CREATE UNIQUE INDEX IF NOT EXISTS reportes_oficiales_maquina_periodo_uk
    ON public.reportes_oficiales (maquina_id, periodo);