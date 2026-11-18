// requireRole: permisos por rol (admin, operador, auditor)
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const { requireRole } = require('../src/middlewares/role.middleware');

// req.user.rol ya resuelto: así el test no necesita la base de datos
const ejecutar = async (middleware, rol) => {
  const resultado = { status: null, siguio: false };
  const req = { user: rol === undefined ? {} : { rol } };
  const res = {
    status(codigo) { resultado.status = codigo; return this; },
    json(cuerpo) { resultado.cuerpo = cuerpo; return this; },
  };
  await middleware(req, res, () => { resultado.siguio = true; });
  return resultado;
};

test('admin puede lo que exige admin', async () => {
  const r = await ejecutar(requireRole('admin'), 'admin');
  assert.equal(r.siguio, true);
});

test('operador y auditor no pueden lo que exige admin (403)', async () => {
  for (const rol of ['operador', 'auditor']) {
    const r = await ejecutar(requireRole('admin'), rol);
    assert.equal(r.siguio, false);
    assert.equal(r.status, 403);
    assert.equal(r.cuerpo.success, false);
  }
});

test('aprobar lotes: admin y operador sí, auditor no', async () => {
  const aprobar = requireRole('admin', 'operador');
  assert.equal((await ejecutar(aprobar, 'admin')).siguio, true);
  assert.equal((await ejecutar(aprobar, 'operador')).siguio, true);
  assert.equal((await ejecutar(aprobar, 'auditor')).status, 403);
});

test('sin rol en la sesión responde 401', async () => {
  const r = await ejecutar(requireRole('admin'), undefined);
  assert.equal(r.status, 401);
  assert.equal(r.siguio, false);
});
