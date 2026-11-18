-- PrintFlow: usuarios de PRUEBA, uno por rol. SOLO para desarrollo local.
-- Contraseña de los tres: Printflow2026*
-- Solo para desarrollo y la demo con datos simulados. En la demo usar contraseñas nuevas (caja 13).
INSERT INTO public.usuarios (nombre, apellido, email, password_hash, rol_id, activo) VALUES
  ('Admin',     'Prueba', 'admin@printflow.local',    '$2b$10$Cv7chCKkYmHBM2bhepC9n.DCvuLRqcC7OeGiK4JhVuRpHNHxNPkDC', 1, true),
  ('Operador',  'Prueba', 'operador@printflow.local', '$2b$10$Cv7chCKkYmHBM2bhepC9n.DCvuLRqcC7OeGiK4JhVuRpHNHxNPkDC', 2, true),
  ('Auditor',   'Prueba', 'auditor@printflow.local',  '$2b$10$Cv7chCKkYmHBM2bhepC9n.DCvuLRqcC7OeGiK4JhVuRpHNHxNPkDC', 3, true);
