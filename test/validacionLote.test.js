// validarLoteStaging valida cada cliente del lote con sus propias máquinas (fallo 2 de
// TAREAS-SAMUEL.md, sección 4). Antes tomaba el cliente del primer reporte (LIMIT 1).
// Sin base de datos: el pool es falso y responde según la consulta.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');
const { agruparPorCliente, erroresDelCliente, erroresSinCliente, nombreDelCliente } = require('../src/utils/validacionLote');
const { validarLoteStaging } = require('../src/models/reportemes_staging/reportemes_staging.model');

const HORIZONTE = 1;
const ANDINA = 2;

const reporte = (id, serie, ip, clienteId, cambios = {}) => ({
  id_staging_consolidado: id,
  serie_maquina: serie,
  ip_detectada: ip,
  cliente_id_tentativo: clienteId,
  procesar_lectura: true,
  mensaje_aviso: null,
  ...cambios,
});

const MAQUINAS = [
  { cliente_id: HORIZONTE, serie: 'SIMA0001', ip_address: '10.0.0.1', contabilidad_por_usuario: true },
  { cliente_id: HORIZONTE, serie: 'SIMB0002', ip_address: '10.0.0.2', contabilidad_por_usuario: false },
  { cliente_id: ANDINA, serie: 'SIMC0003', ip_address: '10.0.1.3', contabilidad_por_usuario: false },
];

// Pool falso: devuelve filas según la consulta y guarda los parámetros de cada una
const usarPoolFalso = (t, { staging, detalles = [], maquinas = MAQUINAS }) => {
  const consultas = [];
  t.mock.method(pool, 'query', async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes('FROM reportes_consolidado_staging') && sql.includes('cliente_id_tentativo')) return { rows: staging };
    if (sql.includes('FROM instalaciones i')) {
      const ids = params[0];
      return { rows: maquinas.filter((m) => ids.includes(m.cliente_id)) };
    }
    if (sql.includes('FROM clientes')) {
      return { rows: [{ id_cliente: HORIZONTE, nombre: 'Colegio Horizonte' }, { id_cliente: ANDINA, nombre: 'Constructora Andina' }] };
    }
    if (sql.includes('FROM reportes_detalle_staging')) return { rows: detalles.map((id) => ({ consolidado_staging_id: id })) };
    // periodo del lote, lecturas a revalidar y validarLectura: nada que objetar
    return { rows: [] };
  });
  return consultas;
};

// ------------------------------ Funciones puras ------------------------------

test('agruparPorCliente separa los reportes de cada cliente', () => {
  const { porCliente, sinCliente } = agruparPorCliente([
    reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE),
    reporte(2, 'SIMC0003', '10.0.1.3', ANDINA),
    reporte(3, 'SIMB0002', '10.0.0.2', '1'),
  ]);
  assert.deepEqual([...porCliente.keys()], [HORIZONTE, ANDINA]);
  assert.deepEqual(porCliente.get(HORIZONTE).map((r) => r.id_staging_consolidado), [1, 3]);
  assert.deepEqual(sinCliente, []);
});

test('con un solo cliente, el reporte sin cliente cuenta para ese cliente (como antes)', () => {
  const { porCliente, sinCliente } = agruparPorCliente([
    reporte(1, 'SIMX9999', '10.9.9.9', null),
    reporte(2, 'SIMA0001', '10.0.0.1', HORIZONTE),
  ]);
  assert.deepEqual(porCliente.get(HORIZONTE).map((r) => r.id_staging_consolidado), [2, 1]);
  assert.deepEqual(sinCliente, []);
});

test('con varios clientes, el reporte sin cliente queda aparte', () => {
  const { porCliente, sinCliente } = agruparPorCliente([
    reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE),
    reporte(2, 'SIMC0003', '10.0.1.3', ANDINA),
    reporte(3, 'SIMX9999', '10.9.9.9', null),
  ]);
  assert.equal(porCliente.size, 2);
  assert.deepEqual(sinCliente.map((r) => r.id_staging_consolidado), [3]);
});

test('erroresDelCliente: lote completo y correcto, sin errores', () => {
  const maquinas = MAQUINAS.filter((m) => m.cliente_id === HORIZONTE);
  const reportes = [reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE), reporte(2, 'SIMB0002', '10.0.0.2', HORIZONTE)];
  assert.deepEqual(erroresDelCliente(maquinas, reportes, new Set([1])), []);
});

test('erroresDelCliente: falta un reporte, IP distinta y contadores por usuario que no llegaron', () => {
  const maquinas = MAQUINAS.filter((m) => m.cliente_id === HORIZONTE);
  const errores = erroresDelCliente(maquinas, [reporte(1, 'SIMA0001', '10.0.0.99', HORIZONTE)], new Set(), 'Cliente X: ');
  assert.deepEqual(errores, [
    'Cliente X: Cantidad inconsistente: El cliente tiene 2 máquinas instaladas, pero el lote trajo 1 reportes.',
    'Cliente X: Discrepancia de IP en la máquina SIMA0001: El archivo indica 10.0.0.99, pero en el sistema está registrada con 10.0.0.1.',
    'Cliente X: Falta el reporte de la máquina: Serie SIMB0002 (IP: 10.0.0.2).',
    'Cliente X: La máquina Serie SIMA0001 (IP: 10.0.0.1) requiere contabilidad por usuario, pero no se reportaron los contadores de los usuarios.',
  ]);
});

test('erroresDelCliente: el motivo de una lectura bloqueada dice de qué máquina es', () => {
  const maquinas = MAQUINAS.filter((m) => m.cliente_id === ANDINA);
  const errores = erroresDelCliente(maquinas, [reporte(3, 'SIMC0003', '10.0.1.3', ANDINA, {
    procesar_lectura: false, mensaje_aviso: 'Retroceso de contador: B/N 10 < 20 (reporte oficial 2026-10)',
  })], new Set());
  assert.deepEqual(errores, ['Máquina SIMC0003: Retroceso de contador: B/N 10 < 20 (reporte oficial 2026-10)']);
});

test('erroresDelCliente: sin aviso, o con un aviso que ya nombra la serie, no se repite la máquina', () => {
  const maquinas = MAQUINAS.filter((m) => m.cliente_id === ANDINA);
  const sinAviso = erroresDelCliente(maquinas, [reporte(3, 'SIMC0003', '10.0.1.3', ANDINA, { procesar_lectura: false })], new Set());
  assert.deepEqual(sinAviso, ['La máquina SIMC0003 tiene un error de estado y sus lecturas fueron bloqueadas.']);
  const conSerie = erroresDelCliente(maquinas, [reporte(3, 'SIMC0003', '10.0.1.3', ANDINA, {
    procesar_lectura: false, mensaje_aviso: 'Máquina no autorizada: la serie SIMC0003 no tiene una asignación vigente',
  })], new Set());
  assert.deepEqual(conSerie, ['Máquina no autorizada: la serie SIMC0003 no tiene una asignación vigente']);
});

test('erroresSinCliente explica que la máquina no es de ningún cliente y repite el aviso', () => {
  const errores = erroresSinCliente([reporte(3, 'SIMX9999', '10.9.9.9', null, {
    procesar_lectura: false, mensaje_aviso: 'Máquina no autorizada: la serie SIMX9999 no está registrada',
  })]);
  assert.deepEqual(errores, [
    'La máquina con Serie SIMX9999 (IP: 10.9.9.9) reportada en el lote no está asignada a ningún cliente en el sistema.',
    'Máquina no autorizada: la serie SIMX9999 no está registrada',
  ]);
});

// ------------------------------ validarLoteStaging con el pool falso ------------------------------

test('lote de un cliente, completo: es válido', async (t) => {
  usarPoolFalso(t, {
    staging: [reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE), reporte(2, 'SIMB0002', '10.0.0.2', HORIZONTE)],
    detalles: [1],
  });
  assert.deepEqual(await validarLoteStaging(7), { esValido: true, errores: [] });
});

test('lote con dos clientes, cada uno completo: es válido (antes salía mal por el LIMIT 1)', async (t) => {
  const consultas = usarPoolFalso(t, {
    staging: [
      reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE),
      reporte(2, 'SIMB0002', '10.0.0.2', HORIZONTE),
      reporte(3, 'SIMC0003', '10.0.1.3', ANDINA),
    ],
    detalles: [1],
  });
  assert.deepEqual(await validarLoteStaging(7), { esValido: true, errores: [] });
  // Se piden las máquinas de los dos clientes, no solo las del primero
  const maquinas = consultas.find((c) => c.sql.includes('FROM instalaciones i'));
  assert.deepEqual(maquinas.params, [[HORIZONTE, ANDINA]]);
  assert.ok(!consultas.some((c) => /LIMIT 1/.test(c.sql)), 'ya no se toma el cliente del primer reporte');
});

test('lote con dos clientes: el error dice de qué cliente es', async (t) => {
  usarPoolFalso(t, {
    staging: [
      reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE),
      reporte(2, 'SIMB0002', '10.0.0.2', HORIZONTE),
      reporte(3, 'SIMC0003', '10.0.1.99', ANDINA),
    ],
    detalles: [1],
  });
  const r = await validarLoteStaging(7);
  assert.equal(r.esValido, false);
  assert.deepEqual(r.errores, [
    'Cliente Constructora Andina: Discrepancia de IP en la máquina SIMC0003: El archivo indica 10.0.1.99, pero en el sistema está registrada con 10.0.1.3.',
  ]);
});

test('lote con dos clientes y una serie que no es de ninguno', async (t) => {
  usarPoolFalso(t, {
    staging: [
      reporte(1, 'SIMA0001', '10.0.0.1', HORIZONTE),
      reporte(2, 'SIMB0002', '10.0.0.2', HORIZONTE),
      reporte(3, 'SIMC0003', '10.0.1.3', ANDINA),
      reporte(4, 'SIMX9999', '10.9.9.9', null, { procesar_lectura: false, mensaje_aviso: 'Máquina no autorizada: la serie SIMX9999 no está registrada' }),
    ],
    detalles: [1],
  });
  const r = await validarLoteStaging(7);
  assert.equal(r.esValido, false);
  assert.deepEqual(r.errores, [
    'La máquina con Serie SIMX9999 (IP: 10.9.9.9) reportada en el lote no está asignada a ningún cliente en el sistema.',
    'Máquina no autorizada: la serie SIMX9999 no está registrada',
  ]);
});

test('lote vacío: no es válido', async (t) => {
  usarPoolFalso(t, { staging: [] });
  assert.deepEqual(await validarLoteStaging(7), {
    esValido: false,
    errores: ['El lote está vacío o no contiene registros consolidados.'],
  });
});

test('nombreDelCliente: el nombre, o el RUC, nunca el id de la base', () => {
  assert.equal(nombreDelCliente({ id_cliente: 4, nombre: ' Colegio Horizonte ', ruc: '0990000001001' }), 'Colegio Horizonte');
  assert.equal(nombreDelCliente({ id_cliente: 4, nombre: '', ruc: '0990000001001' }), 'con RUC 0990000001001');
  assert.equal(nombreDelCliente({ id_cliente: 4, nombre: null, ruc: null }), 'sin nombre registrado');
  assert.equal(nombreDelCliente(null), 'sin nombre registrado');
});
