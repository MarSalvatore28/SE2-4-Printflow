-- Notificaciones leídas POR USUARIO.
-- Antes, notificaciones.leida era global: si un operador marcaba «todas como leídas», dejaban de
-- aparecer para todos. Ahora cada usuario tiene sus leídas aquí; notificaciones.leida = true queda
-- para «resuelta para todos» (la pone la aprobación o el rechazo del lote).
CREATE TABLE public.notificaciones_leidas (
    notificacion_id integer NOT NULL REFERENCES public.notificaciones (id_notificacion) ON DELETE CASCADE,
    usuario_id      integer NOT NULL REFERENCES public.usuarios (id_usuario) ON DELETE CASCADE,
    fecha           timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notificacion_id, usuario_id)
);

CREATE INDEX idx_notificaciones_leidas_usuario ON public.notificaciones_leidas (usuario_id);
