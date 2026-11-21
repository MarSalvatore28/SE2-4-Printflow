// protect: el token renovado (X-Nuevo-Token) lleva el rol ACTUAL del usuario, leído de la base,
// no el que traía el token viejo (fallo 4 de TAREAS-SAMUEL.md, sección 4). Sin base de datos.
require('module-alias/register');
process.env.SECRET_KEY = process.env.SECRET_KEY || 'clave-de-prueba';
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const { generateToken, verifyToken } = require('../src/utils/jwt.util');
const { protect } = require('../src/middlewares/auth.middleware');

const USUARIO = {
  id_usuario: 5,
  email: 'operador@printflow.local',
  nombre: 'Olga',
  apellido: 'Operadora',
  rol_id: 2,
  activo: true,
  rol_nombre: 'operador',
};

const ejecutar = async (token) => {
  const r = { status: null, cuerpo: null, cabeceras: {}, siguio: false };
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = {
    status(codigo) { r.status = codigo; return this; },
    json(cuerpo) { r.cuerpo = cuerpo; return this; },
    setHeader(nombre, valor) { r.cabeceras[nombre] = valor; },
  };
  await protect(req, res, () => { r.siguio = true; });
  return { ...r, user: req.user };
};

const usarUsuario = (t, usuario) => {
  const consultas = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: usuario ? [usuario] : [] };
  });
  return consultas;
};

test('si al usuario le cambiaron el rol, el token renovado trae el rol nuevo', async (t) => {
  // El token se emitió cuando era admin; en la base ahora es operador
  const viejo = generateToken({ id: 5, email: 'operador@printflow.local', rol: 'admin', loginAt: '2026-11-20T10:00:00.000Z' });
  const consultas = usarUsuario(t, USUARIO);

  const r = await ejecutar(viejo);
  assert.equal(r.siguio, true);
  const nuevo = verifyToken(r.cabeceras['X-Nuevo-Token']);
  assert.equal(nuevo.rol, 'operador');
  assert.equal(nuevo.id, 5);
  assert.equal(nuevo.loginAt, '2026-11-20T10:00:00.000Z', 'la sesión conserva la hora de inicio');

  // El nombre del rol sale de la misma consulta del usuario
  assert.equal(consultas.length, 1);
  assert.match(consultas[0].sql, /JOIN roles/);
  assert.deepEqual(consultas[0].params, [5]);
});

test('req.user trae el rol actual, así requireRole no vuelve a consultar la base', async (t) => {
  usarUsuario(t, USUARIO);
  const r = await ejecutar(generateToken({ id: 5, email: USUARIO.email, rol: 'admin', loginAt: 'x' }));
  assert.equal(r.user.rol, 'operador');
  assert.equal(r.user.rol_id, 2);
  assert.equal(r.user.id, 5);
});

test('sin rol asignado, el token renovado lleva rol null', async (t) => {
  usarUsuario(t, { ...USUARIO, rol_id: null, rol_nombre: null });
  const r = await ejecutar(generateToken({ id: 5, email: USUARIO.email, rol: 'admin', loginAt: 'x' }));
  assert.equal(r.siguio, true);
  assert.equal(verifyToken(r.cabeceras['X-Nuevo-Token']).rol, null);
  assert.equal(r.user.rol, null);
});

test('sin token, con token inválido o con usuario inactivo responde 401 y no renueva', async (t) => {
  usarUsuario(t, { ...USUARIO, activo: false });
  for (const token of [null, 'no-es-un-jwt', generateToken({ id: 5 })]) {
    const r = await ejecutar(token);
    assert.equal(r.status, 401, String(token));
    assert.equal(r.siguio, false);
    assert.equal(r.cabeceras['X-Nuevo-Token'], undefined);
  }
});
