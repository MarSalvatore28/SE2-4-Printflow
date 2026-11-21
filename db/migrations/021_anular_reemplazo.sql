-- Anular un reemplazo de máquina registrado por error (POST /api/maquinas-cambio/:id/anular).
--
-- Un reemplazo anulado es el que tiene maquinas_cambio.activo = false. Esa columna ya existía
-- y ya se usaba con ese sentido: la aprobación del lote solo enlaza los cambios activos, la
-- validación de lecturas solo toma el contador inicial de un cambio activo y el historial del
-- área no cuenta los inactivos. Por eso no se agrega una columna «anulado» o «estado»: habría
-- dos banderas para lo mismo. Esta migración agrega cuándo, quién y por qué se anuló.
--
-- Al anular, en una sola transacción, la asignación de la saliente vuelve a estar vigente, se
-- borra la asignación que el registro creó para la entrante (instalacion_entrante_id queda en
-- NULL) y se borran las cabeceras de contadores del cambio. La fila de maquinas_cambio se
-- conserva, con las series y los modelos de las dos máquinas, como constancia.
ALTER TABLE public.maquinas_cambio
  ADD COLUMN fecha_anulacion timestamp with time zone,
  ADD COLUMN usuario_anulacion_id integer,
  ADD COLUMN motivo_anulacion text;

ALTER TABLE public.maquinas_cambio
  ADD CONSTRAINT maquinas_cambio_usuario_anulacion_fk
    FOREIGN KEY (usuario_anulacion_id) REFERENCES public.usuarios (id_usuario),
  -- Un cambio con fecha de anulación no puede seguir activo
  ADD CONSTRAINT maquinas_cambio_anulacion_chk
    CHECK (fecha_anulacion IS NULL OR activo = FALSE);

COMMENT ON COLUMN public.maquinas_cambio.activo IS 'false = reemplazo anulado: no cuenta en listados, consolidado, validación ni aprobación';
COMMENT ON COLUMN public.maquinas_cambio.fecha_anulacion IS 'Cuándo se anuló el reemplazo (NULL si sigue vigente)';
COMMENT ON COLUMN public.maquinas_cambio.usuario_anulacion_id IS 'Administrador que anuló el reemplazo';
COMMENT ON COLUMN public.maquinas_cambio.motivo_anulacion IS 'Por qué se anuló (opcional)';
