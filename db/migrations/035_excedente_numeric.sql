-- Costos del excedente con precisión fija, como el resto de los costos del contrato.
-- costo_x_excedente_impresion_bn era real y costo_x_excedente_impresion_color double precision:
-- un real guarda unos 6 dígitos y la suma de importes podía arrastrar decimales binarios.
-- Ahora numeric(10,4) (4 decimales, como costo_impresion_* y snap_costo_excedente_*). Los valores
-- se conservan redondeados a 4 decimales (los costos de la demo, 0.025 y 0.12, no cambian).
ALTER TABLE public.contratos
  ALTER COLUMN costo_x_excedente_impresion_bn TYPE numeric(10,4)
    USING round(costo_x_excedente_impresion_bn::numeric, 4),
  ALTER COLUMN costo_x_excedente_impresion_color TYPE numeric(10,4)
    USING round(costo_x_excedente_impresion_color::numeric, 4);
