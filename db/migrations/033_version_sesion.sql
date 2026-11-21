-- Versión de la sesión de cada usuario: el token (JWT) lleva la versión con la que se emitió y
-- protect la compara con la de la base. Sube al cambiar la contraseña o el rol y al desactivar
-- el usuario: así los tokens que ya tenía dejan de valer al instante, sin esperar los 30 minutos.
-- Un token emitido antes de esta migración no trae versión y cuenta como 0 (nadie pierde la sesión
-- al desplegar).
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS version_sesion integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.usuarios.version_sesion IS
  'Sube al cambiar la contraseña o el rol y al desactivar: los tokens con otra versión responden 401';
