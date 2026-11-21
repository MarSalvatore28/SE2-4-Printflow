-- El rechazo de un lote queda en el propio lote (antes solo en sus notificaciones, que por eso no
-- se podían borrar). El rechazo borra el staging, así que también se guardan los clientes que
-- tenía el lote, para que la lista de lotes siga mostrándolos y filtrándolos.
ALTER TABLE public.lotes_carga
  ADD COLUMN fecha_rechazo timestamp with time zone,
  ADD COLUMN usuario_rechazo_id integer,
  ADD COLUMN motivo_rechazo text,
  ADD COLUMN cliente_ids_rechazo integer[];

ALTER TABLE public.lotes_carga
  ADD CONSTRAINT lotes_carga_usuario_rechazo_id_fkey
  FOREIGN KEY (usuario_rechazo_id) REFERENCES public.usuarios (id_usuario);

COMMENT ON COLUMN public.lotes_carga.fecha_rechazo IS 'Cuándo se rechazó el lote. NULL = no rechazado (o rechazado antes de la migración 034 sin datos en sus notificaciones)';
COMMENT ON COLUMN public.lotes_carga.usuario_rechazo_id IS 'Quién rechazó el lote';
COMMENT ON COLUMN public.lotes_carga.motivo_rechazo IS 'Motivo del rechazo (opcional)';
COMMENT ON COLUMN public.lotes_carga.cliente_ids_rechazo IS 'Clientes que tenía el lote al rechazarlo (el rechazo borra su staging)';

-- Lotes rechazados antes de esta migración. Solo lotes sin aprobar, sin staging y aún sin
-- fecha_rechazo: se puede repetir sin cambiar nada.
-- 1) Desde la auditoría del rechazo (migración 011), la fuente más completa: quién, cuándo, el
--    motivo y el staging que se borró (con el cliente de cada reporte). Si hubo varias, la última.
UPDATE public.lotes_carga l
SET fecha_rechazo = a.fecha,
    usuario_rechazo_id = a.usuario_id,
    motivo_rechazo = NULLIF(a.valor_nuevo->>'motivo', ''),
    cliente_ids_rechazo = (
      SELECT array_agg(DISTINCT c.cliente_id ORDER BY c.cliente_id)
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(a.valor_anterior->'reportes_staging') = 'array'
             THEN a.valor_anterior->'reportes_staging' ELSE '[]'::jsonb END) AS r
      CROSS JOIN LATERAL (SELECT (r->>'cliente_id_tentativo')::int AS cliente_id) AS c
      WHERE c.cliente_id IS NOT NULL
    )
FROM (
  SELECT DISTINCT ON (ra.id_registro) ra.id_registro, ra.fecha, ra.usuario_id, ra.valor_anterior, ra.valor_nuevo
  FROM public.registro_auditoria ra
  WHERE ra.tabla = 'lotes_carga' AND ra.accion = 'RECHAZAR'
  ORDER BY ra.id_registro, ra.fecha DESC, ra.id DESC
) a
WHERE l.id_lote = a.id_registro
  AND l.fecha_aprobacion IS NULL
  AND l.fecha_rechazo IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.reportes_consolidado_staging s WHERE s.lote_id = l.id_lote);

-- 2) Los que no tienen auditoría (rechazados antes de la 011): lo que guardaron sus notificaciones.
UPDATE public.lotes_carga l
SET fecha_rechazo = r.fecha_rechazo,
    usuario_rechazo_id = (SELECT u.id_usuario FROM public.usuarios u WHERE u.id_usuario = r.usuario_rechazo_id),
    motivo_rechazo = r.motivo_rechazo,
    cliente_ids_rechazo = (
      SELECT array_agg(DISTINCT c.id::int ORDER BY c.id::int)
      FROM public.notificaciones nc
      CROSS JOIN LATERAL jsonb_array_elements_text(nc.datos_adicionales->'cliente_ids') AS c(id)
      WHERE nc.lote_id = l.id_lote AND jsonb_typeof(nc.datos_adicionales->'cliente_ids') = 'array'
    )
FROM (
  SELECT
    n.lote_id,
    COALESCE(MAX((n.datos_adicionales->>'fecha_rechazo')::timestamptz), MAX(n.fecha_lectura)) AS fecha_rechazo,
    MAX((n.datos_adicionales->>'usuario_rechazo_id')::int) AS usuario_rechazo_id,
    MAX(n.datos_adicionales->>'motivo_rechazo') AS motivo_rechazo
  FROM public.notificaciones n
  WHERE n.lote_id IS NOT NULL
    AND (n.datos_adicionales->>'estado_lote' = 'DESCARTADO' OR n.mensaje LIKE '%(RECHAZADO)')
  GROUP BY n.lote_id
) r
WHERE l.id_lote = r.lote_id
  AND r.fecha_rechazo IS NOT NULL
  AND l.fecha_aprobacion IS NULL
  AND l.fecha_rechazo IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.reportes_consolidado_staging s WHERE s.lote_id = l.id_lote);
