-- PrintFlow: usuarios de PRUEBA, uno por rol. SOLO para desarrollo local y la demo con datos simulados.
-- En la demo usar contraseñas nuevas (caja 13, docs/despliegue.md).
--
-- La contraseña de los tres NO está en el repo: llega en la variable de psql «clave», que
-- docker/postgres/init.sh toma de DEMO_PASSWORD (si está vacía, la de siempre: Printflow2026*).
-- El hash se calcula aquí, al crear la base, con bcrypt de pgcrypto (crypt + gen_salt('bf', 10)):
-- da hashes $2a$ que el bcrypt de la API acepta, y una sal distinta para cada usuario.
-- Solo corre al crear el volumen: una base que ya existe no cambia.
--
-- pgcrypto se usa solo durante este seed: si no estaba, se instala y se quita al final, para que
-- una base nueva tenga el mismo esquema que una migrada (db/migrar.sh).
SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto_temporal \gset
\if :pgcrypto_temporal
CREATE EXTENSION pgcrypto;
\endif

INSERT INTO public.usuarios (nombre, apellido, email, password_hash, rol_id, activo)
SELECT u.nombre, 'Prueba', u.email, crypt(:'clave', gen_salt('bf', 10)), u.rol_id, true
FROM (VALUES
  ('Admin',    'admin@printflow.local',    1),
  ('Operador', 'operador@printflow.local', 2),
  ('Auditor',  'auditor@printflow.local',  3)
) AS u (nombre, email, rol_id);

\if :pgcrypto_temporal
DROP EXTENSION pgcrypto;
\endif
