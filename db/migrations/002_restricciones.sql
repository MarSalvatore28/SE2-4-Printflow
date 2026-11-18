-- S1-02: el RUC del cliente es único
ALTER TABLE public.clientes ADD CONSTRAINT clientes_ruc_key UNIQUE (ruc);

-- S1-02 / HU-06: una máquina solo puede tener UNA asignación activa
CREATE UNIQUE INDEX instalaciones_una_activa_por_maquina
    ON public.instalaciones (maquina_id)
    WHERE activo = true AND fecha_retiro IS NULL;
