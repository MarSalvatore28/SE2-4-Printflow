-- S4-05: índices para el consolidado mensual (GET /api/reportes/consolidado/:clienteId/:periodo).
-- Medición y planes antes y después en docs/rendimiento.md. Se puede aplicar más de una vez.

-- Los reportes de un cliente en un período: el filtro principal del consolidado y de los períodos
-- disponibles. Antes se usaba el índice por período y se descartaban las filas de otros clientes.
CREATE INDEX IF NOT EXISTS idx_reportes_cliente_periodo
    ON public.reportes_oficiales (cliente_id, periodo);

-- Asignaciones de una máquina por fecha: la asignación del período y la de la entrante de un
-- reemplazo (ORDER BY fecha_instalacion) se resuelven con el índice, sin ordenar.
CREATE INDEX IF NOT EXISTS idx_instalaciones_maquina_fecha
    ON public.instalaciones (maquina_id, fecha_instalacion);

-- reportes_detalle_oficial (reporte_oficial_id) ya existe: idx_detalle_oficial_reporte (001).

ANALYZE public.reportes_oficiales;
ANALYZE public.instalaciones;
