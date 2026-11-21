// Límite de intentos del login (POST /api/auth/login): 10 intentos fallidos por IP cada 15 minutos.
// Sin base de datos: la validación de la contraseña se simula en el modelo de usuario.
process.env.SECRET_KEY = 'test';
process.env.LOGIN_MAX_INTENTOS = '10';
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const Usuario = require('@models/usuario/usuario.model');
const { maxIntentos, MAX_INTENTOS_POR_DEFECTO } = require('@middlewares/limiteLogin.middleware');
const app = require('../src/app');

const USUARIO = { id: 1, email: 'admin@printflow.local', nombre: 'Ana', apellido: 'Admin', rol: { id: 1, nombre: 'admin' } };

// IP de ejemplo del rango de documentación (RFC 5737, 203.0.113.0/24)
const ip = (n) => `203.0.113.${n}`;

let server;
let base;

test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

test.after(() => new Promise((resolve) => server.close(resolve)));

// La prueba llega por localhost (un proxy de confianza): X-Forwarded-For hace de IP del cliente,
// como cuando la petición pasa por el nginx del frontend.
const login = (ipCliente, password = 'mala') => fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipCliente },
  body: JSON.stringify({ email: 'admin@printflow.local', password }),
});

// La contraseña correcta es «buena»; cualquier otra falla
const simularLogin = (t) => {
  t.mock.method(Usuario, 'validateLogin', async (_email, password) => (password === 'buena' ? USUARIO : null));
};

test('LOGIN_MAX_INTENTOS: un entero positivo cambia el límite; vacío o inválido deja 10', () => {
  assert.equal(MAX_INTENTOS_POR_DEFECTO, 10);
  assert.equal(maxIntentos('25'), 25);
  assert.equal(maxIntentos(undefined), 10);
  assert.equal(maxIntentos(''), 10);
  assert.equal(maxIntentos('0'), 10);
  assert.equal(maxIntentos('-3'), 10);
  assert.equal(maxIntentos('diez'), 10);
  assert.equal(maxIntentos('2.5'), 10);
});

test('10 intentos fallidos responden 401; el 11.º responde 429 en JSON y en español', async (t) => {
  simularLogin(t);
  for (let i = 1; i <= 10; i += 1) {
    const res = await login(ip(10));
    assert.equal(res.status, 401, `intento ${i}`);
    await res.body?.cancel();
  }
  const res = await login(ip(10));
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('retry-after'), 'trae Retry-After');
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(body.message, /Demasiados intentos de inicio de sesión\. Espera \d+ min/);

  // Bloqueada, ni la contraseña correcta entra hasta que pase la ventana
  const conClave = await login(ip(10), 'buena');
  assert.equal(conClave.status, 429);
  await conClave.body?.cancel();
});

test('el límite es por IP del cliente: otra IP detrás del mismo proxy sigue pudiendo entrar', async (t) => {
  simularLogin(t);
  for (let i = 0; i < 11; i += 1) await (await login(ip(20))).body?.cancel();
  const res = await login(ip(21), 'buena');
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
});

test('los inicios de sesión correctos no gastan intentos', async (t) => {
  simularLogin(t);
  for (let i = 0; i < 15; i += 1) {
    const res = await login(ip(30), 'buena');
    assert.equal(res.status, 200, `login correcto ${i + 1}`);
    await res.body?.cancel();
  }
  const fallido = await login(ip(30));
  assert.equal(fallido.status, 401);
  await fallido.body?.cancel();
});

test('el límite es solo del login: las demás rutas públicas no cuentan', async (t) => {
  simularLogin(t);
  for (let i = 0; i < 11; i += 1) await (await login(ip(40))).body?.cancel();
  const res = await fetch(`${base}/api/auth/validate-token`, { headers: { 'X-Forwarded-For': ip(40) } });
  assert.equal(res.status, 401);
  await res.body?.cancel();
});
