// Gestión de usuarios (S4-03): validaciones y permisos, sin base de datos
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const usuariosRoutes = require('../src/routes/usuario/usuarios.routes');
const {
  MENSAJES,
  normalizarEmail,
  parseId,
  validarPassword,
  validarDatosUsuario,
  validarCambioPropio,
} = require('../src/utils/usuarios.validacion');

let server;
let base;

test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

test.after(() => new Promise((resolve) => server.close(resolve)));

const valido = {
  nombre: '  Ana   María ',
  apellido: ' Pérez ',
  email: '  Ana.Perez@PrintFlow.Local ',
  rol_id: '2',
  password: 'Segura2026',
};

test('el correo se normaliza en minúsculas y sin espacios', () => {
  assert.equal(normalizarEmail('  Ana@X.COM '), 'ana@x.com');
  assert.equal(normalizarEmail(undefined), '');
  assert.equal(normalizarEmail(123), '');
});

test('parseId solo acepta enteros positivos', () => {
  assert.equal(parseId('3'), 3);
  assert.equal(parseId(3), 3);
  for (const malo of ['0', '-1', '1.5', 'abc', '99999999999', null, undefined, {}]) {
    assert.equal(parseId(malo), null, String(malo));
  }
});

test('la contraseña exige 8 caracteres, una letra y un número', () => {
  assert.equal(validarPassword('Printflow2026*'), null);
  assert.equal(validarPassword('abcdefg1'), null);
  assert.match(validarPassword(''), /obligatoria/);
  assert.match(validarPassword(undefined), /obligatoria/);
  assert.match(validarPassword(12345678), /obligatoria/);
  assert.match(validarPassword('abc1'), /al menos 8/);
  assert.match(validarPassword('abcdefgh'), /una letra y un número/);
  assert.match(validarPassword('12345678'), /una letra y un número/);
  assert.match(validarPassword(`a1${'x'.repeat(80)}`), /más de 72/);
});

test('crear: datos válidos quedan normalizados', () => {
  const { error, datos } = validarDatosUsuario(valido, { esCreacion: true });
  assert.equal(error, undefined);
  assert.deepEqual(datos, {
    nombre: 'Ana María',
    apellido: 'Pérez',
    email: 'ana.perez@printflow.local',
    rol_id: 2,
    password: 'Segura2026',
  });
});

test('crear: el apellido vacío se guarda como null', () => {
  const { datos } = validarDatosUsuario({ ...valido, apellido: '   ' }, { esCreacion: true });
  assert.equal(datos.apellido, null);
});

test('crear: nombre, correo, rol y contraseña son obligatorios', () => {
  const casos = [
    [{ ...valido, nombre: '   ' }, /nombre es obligatorio/],
    [{ ...valido, nombre: 5 }, /nombre es obligatorio/],
    [{ ...valido, nombre: 'x'.repeat(101) }, /nombre no puede/],
    [{ ...valido, apellido: 7 }, /apellido debe ser texto/],
    [{ ...valido, email: '' }, /correo es obligatorio/],
    [{ ...valido, email: 'sin-arroba.com' }, /formato válido/],
    [{ ...valido, email: 'a@b' }, /formato válido/],
    [{ ...valido, email: `${'a'.repeat(95)}@x.com` }, /correo no puede/],
    [{ ...valido, rol_id: undefined }, /rol válido/],
    [{ ...valido, rol_id: 'admin' }, /rol válido/],
    [{ ...valido, password: undefined }, /contraseña es obligatoria/],
    [{ ...valido, password: 'corta1' }, /al menos 8/],
  ];
  for (const [cuerpo, mensaje] of casos) {
    const { error } = validarDatosUsuario(cuerpo, { esCreacion: true });
    assert.match(error ?? '', mensaje, JSON.stringify(cuerpo));
  }
  assert.match(validarDatosUsuario(null, { esCreacion: true }).error, /Faltan los datos/);
  assert.match(validarDatosUsuario([], { esCreacion: true }).error, /Faltan los datos/);
});

test('editar: la contraseña es opcional, pero si viene se valida', () => {
  for (const password of [undefined, null, '']) {
    const { error, datos } = validarDatosUsuario({ ...valido, password }, { esCreacion: false });
    assert.equal(error, undefined);
    assert.equal(datos.password, null);
  }
  assert.match(validarDatosUsuario({ ...valido, password: 'corta' }, { esCreacion: false }).error, /al menos 8/);
  assert.equal(validarDatosUsuario({ ...valido, password: 'NuevaClave9' }, { esCreacion: false }).datos.password, 'NuevaClave9');
});

test('un admin no puede desactivarse ni quitarse el rol admin', () => {
  assert.equal(validarCambioPropio(1, 1, { activo: false }), MENSAJES.NO_DESACTIVARSE);
  assert.equal(validarCambioPropio(1, '1', { rolNombre: 'operador' }), MENSAJES.NO_QUITARSE_ADMIN);
  assert.equal(validarCambioPropio(1, 1, { rolNombre: 'admin' }), null);
  assert.equal(validarCambioPropio(1, 1, { activo: true }), null);
});

test('un admin sí puede desactivar o cambiar el rol de otro usuario', () => {
  assert.equal(validarCambioPropio(1, 2, { activo: false }), null);
  assert.equal(validarCambioPropio(1, 2, { rolNombre: 'auditor' }), null);
});

test('/api/usuarios exige token', async () => {
  for (const [metodo, ruta] of [['GET', '/api/usuarios'], ['GET', '/api/usuarios/roles'], ['POST', '/api/usuarios'], ['PUT', '/api/usuarios/1'], ['PATCH', '/api/usuarios/1/activo']]) {
    const res = await fetch(`${base}${ruta}`, { method: metodo });
    assert.equal(res.status, 401, `${metodo} ${ruta}`);
    assert.equal((await res.json()).success, false);
  }
});

test('la documentación de Swagger incluye las rutas de usuarios', () => {
  const docs = require('../src/config/swagger');
  for (const ruta of ['/api/usuarios', '/api/usuarios/roles', '/api/usuarios/{id}', '/api/usuarios/{id}/activo']) {
    assert.ok(docs.paths[ruta], ruta);
  }
  assert.ok(docs.paths['/api/usuarios'].get && docs.paths['/api/usuarios'].post);
});

test('/api/usuarios está montado en la app', () => {
  const capa = app.router.stack.find((l) => l.handle === usuariosRoutes);
  assert.ok(capa, 'el router de usuarios no está montado');
  assert.equal(capa.match('/api/usuarios/roles'), true);
});

// Cada ruta pasa primero por requireRole: se ejecuta ese middleware con cada rol (req.user.rol ya resuelto)
test('todas las rutas de usuarios son solo para admin (operador y auditor: 403)', async () => {
  const rutas = usuariosRoutes.stack.map((l) => l.route);
  assert.equal(rutas.length, 5);
  for (const ruta of rutas) {
    const permiso = ruta.stack[0].handle;
    for (const [rol, esperado] of [['admin', 'sigue'], ['operador', 403], ['auditor', 403]]) {
      let resultado = 'sigue';
      const res = { status(c) { resultado = c; return this; }, json() { return this; } };
      await permiso({ user: { rol } }, res, () => {});
      assert.equal(resultado, esperado, `${Object.keys(ruta.methods)} ${ruta.path} con ${rol}`);
    }
  }
});

// Migración 033: el UPDATE sube version_sesion al cambiar la contraseña o el rol y al desactivar
const pool = require('../src/config/db');
const usuariosModel = require('../src/models/usuario/usuarios.model');

const capturarUpdate = (t) => {
  const consultas = [];
  const cliente = {
    query: async (sql, params) => {
      consultas.push({ sql: String(sql), params });
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: 1 }] };
      if (/^\s*UPDATE usuarios/.test(sql)) return { rows: [{ id_usuario: 7 }] };
      return { rows: [{ id_usuario: 7, id_registro_auditoria: 1 }] };
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => cliente);
  return () => consultas.find((c) => /^\s*UPDATE usuarios/.test(c.sql));
};

test('editar un usuario sube version_sesion si cambia la contraseña o el rol (no por otros datos)', async (t) => {
  const update = capturarUpdate(t);
  await usuariosModel.actualizarUsuario(7, { nombre: 'A', apellido: null, email: 'a@x.com', rol_id: 2, passwordHash: 'hash' });
  const { sql, params } = update();
  assert.match(sql, /version_sesion = version_sesion\s*\+ CASE WHEN \$6::text IS NOT NULL OR rol_id IS DISTINCT FROM \$5 THEN 1 ELSE 0 END/);
  assert.equal(params[5], 'hash');
});

test('desactivar sube version_sesion; activar no', async (t) => {
  const update = capturarUpdate(t);
  await usuariosModel.cambiarActivo(7, false);
  const { sql, params } = update();
  assert.match(sql, /version_sesion = version_sesion \+ CASE WHEN activo AND NOT \$2::boolean THEN 1 ELSE 0 END/);
  assert.deepEqual(params, [7, false]);
});
