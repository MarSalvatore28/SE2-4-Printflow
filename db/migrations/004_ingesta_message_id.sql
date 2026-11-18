-- Caja 9, mejora 3.2: un correo (Message-ID) se procesa una sola vez
ALTER TABLE public.lotes_carga ADD COLUMN message_id varchar(255);
CREATE UNIQUE INDEX lotes_carga_message_id_uq ON public.lotes_carga (message_id) WHERE message_id IS NOT NULL;
