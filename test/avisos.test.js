// S3-03: aviso por correo al operador cuando llega un lote nuevo (sin base de datos ni servidor SMTP)
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { armarAvisoLote, avisarSiEsLoteNuevo } = require('../src/services/avisos.service');
const { enviarCorreo } = require('../src/services/correo.service');

// El servicio escribe en consola («✉ Aviso de lote … enviado»). En el CI, node --test lee el
// resultado de cada archivo por la salida estándar del proceso hijo, y esa salida con
// caracteres no ASCII rompió una vez la lectura («Unable to deserialize cloned data»).
// Las pruebas no necesitan ese texto: se silencia mientras corren.
const consolaOriginal = { log: console.log, error: console.error };
test.before(() => { console.log = () => {}; console.error = () => {}; });
test.after(() => { Object.assign(console, consolaOriginal); });

const conDirTemporal = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-correo-'));
  const antes = { modo: process.env.CORREO_MODO, dir: process.env.CORREO_DIR };
  process.env.CORREO_MODO = 'archivo';
  process.env.CORREO_DIR = dir;
  try { await fn(dir); } finally {
    process.env.CORREO_MODO = antes.modo ?? '';
    if (antes.dir === undefined) delete process.env.CORREO_DIR; else process.env.CORREO_DIR = antes.dir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('el aviso de un lote correcto dice que está listo para aprobar', () => {
  const { asunto, texto } = armarAvisoLote({ codigo: 'SIM-2026-10-andina', periodo: '2026-10', clientes: ['Andina'], reportes: 3, errores: [] });
  assert.equal(asunto, 'Nuevo lote de contadores: SIM-2026-10-andina');
  assert.match(texto, /Reportes:\s+3/);
  assert.match(texto, /listo para revisar y aprobar/);
  assert.match(texto, /\/notificaciones/);
});

test('el aviso de un lote con errores trae cada motivo y lo marca en el asunto', () => {
  const { asunto, texto } = armarAvisoLote({
    codigo: 'SIM-2026-10-desconocido', periodo: '2026-10', clientes: [], reportes: 1,
    errores: [{ serie: 'SIMX9999', motivo: 'Máquina no autorizada: la serie SIMX9999 no está registrada' }],
  });
  assert.match(asunto, /^⚠ .*\(1 con error\)$/);
  assert.match(texto, /SIMX9999: Máquina no autorizada/);
  assert.match(texto, /sin cliente identificado/);
});

test('modo archivo: el correo queda como .eml en el buzón de salida', async () => {
  await conDirTemporal(async (dir) => {
    const r = await enviarCorreo({ para: ['operador@printflow.local'], asunto: 'Prueba ñandú', texto: 'Hola' });
    assert.equal(r.enviado, true);
    assert.equal(r.modo, 'archivo');
    const contenido = fs.readFileSync(r.archivo, 'utf8');
    assert.match(contenido, /To: operador@printflow\.local/);
    assert.match(contenido, /Subject: /);
    assert.equal(path.dirname(r.archivo), dir);
  });
});

test('modo desactivado: no envía ni escribe nada', async () => {
  process.env.CORREO_MODO = 'desactivado';
  const r = await enviarCorreo({ para: 'x@y.z', asunto: 'No', texto: 'No' });
  delete process.env.CORREO_MODO;
  assert.equal(r.enviado, false);
});

test('modo smtp sin SMTP_HOST: no lanza, devuelve el error', async () => {
  process.env.CORREO_MODO = 'smtp';
  delete process.env.SMTP_HOST;
  const r = await enviarCorreo({ para: 'x@y.z', asunto: 'Sin servidor', texto: '...' });
  delete process.env.CORREO_MODO;
  assert.equal(r.enviado, false);
  assert.match(r.error, /SMTP_HOST/);
});

// db simulado: responde según la consulta
const dbFalso = (tipoCodigo) => ({
  async query(sql) {
    if (sql.includes('tipos_notificacion')) return { rows: [{ codigo: tipoCodigo }] };
    if (sql.includes('FROM lotes_carga')) return { rows: [{ id_lote: 7, codigo_referencia: 'SIM-2026-11-horizonte', periodo: '2026-11' }] };
    if (sql.includes('reportes_consolidado_staging')) {
      return { rows: [{ serie_maquina: 'SIMA0001', procesar_lectura: true, mensaje_aviso: null, cliente: 'Horizonte' }] };
    }
    if (sql.includes('FROM usuarios')) return { rows: [{ email: 'admin@printflow.local' }, { email: 'operador@printflow.local' }] };
    return { rows: [] };
  },
});

test('solo avisa por correo cuando la notificación es de un lote nuevo', async () => {
  await conDirTemporal(async (dir) => {
    assert.equal(await avisarSiEsLoteNuevo(dbFalso('OTRO_TIPO'), { lote_id: 7, tipo_notificacion_id: 2 }), null);
    assert.equal(await avisarSiEsLoteNuevo(dbFalso('NUEVO_LOTE'), { tipo_notificacion_id: 1 }), null, 'sin lote no avisa');
    const r = await avisarSiEsLoteNuevo(dbFalso('NUEVO_LOTE'), { lote_id: 7, tipo_notificacion_id: 1 });
    assert.equal(r.enviado, true);
    const eml = fs.readFileSync(r.archivo, 'utf8');
    assert.match(eml, /To: admin@printflow\.local, operador@printflow\.local/);
    assert.equal(fs.readdirSync(dir).length, 1);
  });
});

test('si la base falla, el aviso no lanza error', async () => {
  const r = await avisarSiEsLoteNuevo({ query: async () => { throw new Error('sin conexión'); } }, { lote_id: 1, tipo_notificacion_id: 1 });
  assert.equal(r.enviado, false);
});
