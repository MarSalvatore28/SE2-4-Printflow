// Login y seguridad (caja 3, mejora 3.5): firmar y verificar el token, y el middleware protect.
// Sin base de datos ni Docker: la consulta del usuario se simula en el pool de @config/db.
process.env.SECRET_KEY = 'test';
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const pool = require('@config/db');
const { generateToken, verifyToken } = require('@utils/jwt.util');
const { protect } = require('@middlewares/auth.middleware');

// Usuario activo como lo devuelve la consulta de protect
const USUARIO = {
  id_usuario: 1,
  email: 'admin@printflow.local',
  nombre: 'Ana',
  apellido: 'Admin',
  rol_id: 1,
  rol_nombre: 'admin',
  activo: true,
};

// Ejecuta protect con req/res/next mínimos de Express (como test/roles.test.js)
const ejecutarProtect = async (authorization) => {
  const r = { status: null, cuerpo: null, cabeceras: {}, siguio: false };
  const req = { headers: authorization === undefined ? {} : { authorization } };
  const res = {
    status(codigo) { r.status = codigo; return this; },
    json(cuerpo) { r.cuerpo = cuerpo; return this; },
    setHeader(nombre, valor) { r.cabeceras[nombre] = valor; },
  };
  await protect(req, res, () => { r.siguio = true; });
  return { ...r, user: req.user };
};

// La consulta del usuario en la base devuelve `usuario`
const simularUsuario = (t, usuario = USUARIO) => {
  t.mock.method(pool, 'query', async () => ({ rows: usuario ? [usuario] : [] }));
};

test('generateToken y verifyToken devuelven el mismo id', () => {
  const token = generateToken({ id: 42, email: 'operador@printflow.local' });
  const datos = verifyToken(token);
  assert.equal(datos.id, 42);
  assert.equal(datos.email, 'operador@printflow.local');
  // Vence a los 30 minutos
  assert.equal(datos.exp - datos.iat, 30 * 60);
});

test('un token firmado con otra clave lanza un error al verificarlo', () => {
  const ajeno = jwt.sign({ id: 42 }, 'otra-clave', { expiresIn: '30m' });
  assert.throws(() => verifyToken(ajeno), { name: 'JsonWebTokenError', message: 'invalid signature' });
});

test('protect sin cabecera Authorization responde 401, y con un token falso también 401', async (t) => {
  simularUsuario(t);

  const sinCabecera = await ejecutarProtect(undefined);
  assert.equal(sinCabecera.status, 401);
  assert.equal(sinCabecera.cuerpo.success, false);
  assert.equal(sinCabecera.cuerpo.message, 'No hay token, autorización denegada');
  assert.equal(sinCabecera.siguio, false);

  const falso = await ejecutarProtect('Bearer cualquier-cosa');
  assert.equal(falso.status, 401);
  assert.equal(falso.cuerpo.success, false);
  assert.equal(falso.cuerpo.message, 'Token inválido');
  assert.equal(falso.siguio, false);
  assert.equal(falso.cabeceras['X-Nuevo-Token'], undefined, 'un token falso no se renueva');
});

test('protect deja pasar un token válido y agrega la cabecera X-Nuevo-Token', async (t) => {
  simularUsuario(t);
  const token = generateToken({ id: 1, email: USUARIO.email, loginAt: '2026-11-20T10:00:00.000Z' });

  const r = await ejecutarProtect(`Bearer ${token}`);
  assert.equal(r.siguio, true);
  assert.equal(r.status, null);
  assert.equal(r.user.id, 1);

  const nuevo = r.cabeceras['X-Nuevo-Token'];
  assert.equal(typeof nuevo, 'string');
  const datos = verifyToken(nuevo);
  assert.equal(datos.id, 1, 'el token renovado es del mismo usuario');
  assert.equal(datos.loginAt, '2026-11-20T10:00:00.000Z', 'conserva la hora de inicio de la sesión');
});
