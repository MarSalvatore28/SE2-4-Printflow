-- S3-02 · Auditoría: quién cambió qué, cuándo y desde qué IP.
-- Cada fila guarda la fila afectada antes y después del cambio (jsonb). Se escribe dentro de la
-- misma transacción que el cambio: si no se puede auditar, el cambio no se guarda.
CREATE TABLE IF NOT EXISTS public.registro_auditoria (
    id bigserial PRIMARY KEY,
    tabla varchar(64) NOT NULL,
    id_registro integer NOT NULL,
    accion varchar(20) NOT NULL,
    usuario_id integer REFERENCES public.usuarios (id_usuario),
    fecha timestamp with time zone NOT NULL DEFAULT now(),
    valor_anterior jsonb,
    valor_nuevo jsonb,
    ip varchar(45)
);

CREATE INDEX IF NOT EXISTS registro_auditoria_tabla_registro_idx
    ON public.registro_auditoria (tabla, id_registro);

CREATE INDEX IF NOT EXISTS registro_auditoria_fecha_idx
    ON public.registro_auditoria (fecha);

COMMENT ON TABLE public.registro_auditoria IS 'Bitácora de cambios (S3-02): contratos, asignaciones, reemplazos, lotes, usuarios y lecturas';
COMMENT ON COLUMN public.registro_auditoria.tabla IS 'Tabla del registro afectado (contratos, instalaciones, lotes_carga, ...)';
COMMENT ON COLUMN public.registro_auditoria.id_registro IS 'Clave primaria del registro afectado en esa tabla';
COMMENT ON COLUMN public.registro_auditoria.accion IS 'CREAR, ACTUALIZAR, ACTIVAR, DESACTIVAR, RETIRAR, APROBAR, RECHAZAR o REPROCESAR';
COMMENT ON COLUMN public.registro_auditoria.usuario_id IS 'Usuario de la sesión que hizo el cambio';
COMMENT ON COLUMN public.registro_auditoria.valor_anterior IS 'La fila antes del cambio (null en un alta). Nunca guarda contraseñas';
COMMENT ON COLUMN public.registro_auditoria.valor_nuevo IS 'La fila después del cambio. Nunca guarda contraseñas';
COMMENT ON COLUMN public.registro_auditoria.ip IS 'IP de quien hizo la petición (req.ip)';
