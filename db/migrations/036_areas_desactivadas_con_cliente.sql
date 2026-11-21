-- Áreas que se desactivaron con su cliente (PLAN.md §9, decisión 16): al reactivar el cliente
-- vuelven solo esas, no las que el admin había desactivado una por una.
ALTER TABLE public.areas
  ADD COLUMN IF NOT EXISTS desactivada_con_cliente boolean NOT NULL DEFAULT false;

-- Hasta hoy, al reactivar un cliente volvían todas sus áreas: las inactivas de un cliente
-- inactivo quedan marcadas para que sigan volviendo como antes.
UPDATE public.areas a
SET desactivada_con_cliente = true
FROM public.clientes c
WHERE c.id_cliente = a.cliente_id
  AND c.activo = false
  AND a.activo IS DISTINCT FROM true;

COMMENT ON COLUMN public.areas.desactivada_con_cliente IS 'true si el área se desactivó en la cascada de la baja de su cliente; al reactivarlo vuelve. Una baja o un alta del área desde su pantalla la deja en false';

COMMENT ON TABLE public.registro_auditoria IS 'Bitácora de cambios (S3-02): contratos, áreas, asignaciones, reemplazos, lotes, usuarios y lecturas';
