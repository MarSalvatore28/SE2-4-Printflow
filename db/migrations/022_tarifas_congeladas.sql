-- Tarifas congeladas al aprobar (TAREAS-CHRISTIAN.md, sección 2).
-- reportes_oficiales ya tenía snap_costo_impresion_*, snap_costo_copia_* y fecha_congelacion.
-- Para facturar un mes ya aprobado con el contrato de ese momento faltan las páginas incluidas,
-- los costos del excedente, el modo de facturación y el contrato con el que se aprobó.
-- snap_contrato_id en NULL = reporte sin tarifas congeladas (aprobado antes de esta migración o
-- registrado a mano): el consolidado usa el contrato actual, como antes.

ALTER TABLE public.reportes_oficiales
    ADD COLUMN IF NOT EXISTS snap_contrato_id integer,
    ADD COLUMN IF NOT EXISTS snap_impresiones_bn_incluidas integer,
    ADD COLUMN IF NOT EXISTS snap_impresiones_color_incluidas integer,
    ADD COLUMN IF NOT EXISTS snap_costo_excedente_bn numeric(10,4),
    ADD COLUMN IF NOT EXISTS snap_costo_excedente_color numeric(10,4),
    ADD COLUMN IF NOT EXISTS snap_facturacion_de_impresora text;

COMMENT ON COLUMN public.reportes_oficiales.snap_contrato_id IS
    'Contrato de la asignación de la máquina al aprobar. NULL = sin tarifas congeladas';
COMMENT ON COLUMN public.reportes_oficiales.fecha_congelacion IS
    'Cuándo se copiaron las tarifas del contrato (al aprobar el lote). NULL = sin tarifas congeladas';

-- Hasta ahora fecha_congelacion tomaba la fecha de inserción aunque nada se congelara
ALTER TABLE public.reportes_oficiales ALTER COLUMN fecha_congelacion DROP DEFAULT;
