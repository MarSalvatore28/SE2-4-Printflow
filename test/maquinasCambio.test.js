// Reemplazo de máquinas (caja 4): reglas del registro y consumo del período afectado.
// Son funciones puras: no necesitan la base de datos.
require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert');
const {
  TIPOS_CAMBIO,
  parseContador,
  parseFecha,
  periodoSiguiente,
  hoyEcuador,
  validarDatosReemplazo,
  validarFiltrosListado,
  contadorMenorQueLectura,
} = require('../src/utils/maquinasCambio.reglas');

const HOY = '2026-11-18';

const valido = (cambios = {}) => ({
  maquina_saliente_id: 2,
  maquina_entrante_id: 6,
  fecha_danio: '2026-11-12',
  fecha_instalacion_entrante: '2026-11-13',
  periodo_afectado: '2026-11',
  tipo_cambio: 'Daño',
  razon_cambio: 'Falla del fusor, no imprime',
  contador_final_saliente_bn: 376850,
  contador_final_saliente_color: 0,
  contador_inicial_entrante_bn: 18000,
  contador_inicial_entrante_color: 0,
  ...cambios,
});

const mensajeDe = (body) => {
  const r = validarDatosReemplazo(body, HOY);
  assert.ok(r.error, `se esperaba un error para ${JSON.stringify(body)}`);
  assert.equal(r.error.status, 400);
  return r.error.message;
};

test('un reemplazo válido se normaliza', () => {
  const { error, data } = validarDatosReemplazo(valido({
    maquina_saliente_id: '2',
    razon_cambio: '  Falla   del fusor  ',
    contador_final_saliente_bn: '376850',
    ip_address: ' 10.20.1.12 ',
  }), HOY);
  assert.equal(error, undefined);
  assert.equal(data.maquina_saliente_id, 2);
  assert.equal(data.razon_cambio, 'Falla del fusor');
  assert.equal(data.contador_final_saliente_bn, 376850);
  assert.equal(data.ip_address, '10.20.1.12');
});

test('sin IP, la entrante usará la de la saliente (null)', () => {
  assert.equal(validarDatosReemplazo(valido(), HOY).data.ip_address, null);
  assert.equal(validarDatosReemplazo(valido({ ip_address: '' }), HOY).data.ip_address, null);
});

test('las máquinas son obligatorias y distintas', () => {
  assert.match(mensajeDe(valido({ maquina_saliente_id: undefined })), /saliente/);
  assert.match(mensajeDe(valido({ maquina_entrante_id: 'abc' })), /entrante/);
  assert.match(mensajeDe(valido({ maquina_entrante_id: 2 })), /distinta/);
  assert.match(mensajeDe(valido({ maquina_saliente_id: 0 })), /saliente/);
});

test('fechas: formato, calendario y que no sean futuras', () => {
  assert.match(mensajeDe(valido({ fecha_danio: '12/11/2026' })), /fecha del daño/);
  assert.match(mensajeDe(valido({ fecha_danio: '2026-02-30' })), /fecha del daño/);
  assert.match(mensajeDe(valido({ fecha_instalacion_entrante: null })), /instalación/);
  assert.match(mensajeDe(valido({ fecha_danio: '2026-11-19', fecha_instalacion_entrante: '2026-11-19' })), /no puede ser futura/);
  assert.match(mensajeDe(valido({ fecha_instalacion_entrante: '2026-11-20' })), /no puede ser futura/);
});

test('la entrante no se instala antes del daño (sí el mismo día)', () => {
  assert.match(mensajeDe(valido({ fecha_instalacion_entrante: '2026-11-11' })), /anterior a la fecha del daño/);
  assert.equal(validarDatosReemplazo(valido({ fecha_instalacion_entrante: '2026-11-12' }), HOY).error, undefined);
});

test('el período afectado es el mes del daño o el siguiente', () => {
  assert.match(mensajeDe(valido({ periodo_afectado: '2026-13' })), /AAAA-MM/);
  assert.match(mensajeDe(valido({ periodo_afectado: '2026-10' })), /mes del daño \(2026-11\) o el siguiente \(2026-12\)/);
  assert.match(mensajeDe(valido({ periodo_afectado: '2027-01' })), /mes del daño/);
  // Daño después del corte de octubre: se factura en noviembre
  const r = validarDatosReemplazo(valido({ fecha_danio: '2026-10-31', fecha_instalacion_entrante: '2026-11-02' }), HOY);
  assert.equal(r.error, undefined);
});

test('la entrante debe instalarse dentro del período afectado', () => {
  const mensaje = mensajeDe(valido({ fecha_danio: '2026-10-30', fecha_instalacion_entrante: '2026-11-03', periodo_afectado: '2026-10' }));
  assert.match(mensaje, /dentro del período afectado \(2026-10\)/);
});

test('tipo y razón del cambio', () => {
  assert.match(mensajeDe(valido({ tipo_cambio: 'Robo' })), /tipo de cambio válido/);
  assert.match(mensajeDe(valido({ razon_cambio: 'mal' })), /mínimo 5/);
  assert.match(mensajeDe(valido({ razon_cambio: 'x'.repeat(501) })), /hasta 500/);
  for (const tipo of TIPOS_CAMBIO) {
    assert.equal(validarDatosReemplazo(valido({ tipo_cambio: tipo }), HOY).error, undefined, tipo);
  }
});

test('los cuatro contadores son enteros >= 0', () => {
  assert.match(mensajeDe(valido({ contador_final_saliente_bn: -1 })), /contador final B\/N de la saliente/);
  assert.match(mensajeDe(valido({ contador_final_saliente_color: 1.5 })), /contador final color/);
  assert.match(mensajeDe(valido({ contador_inicial_entrante_bn: '' })), /contador inicial B\/N/);
  assert.match(mensajeDe(valido({ contador_inicial_entrante_color: undefined })), /contador inicial color/);
  assert.equal(parseContador(0), 0);
  assert.equal(parseContador('12'), 12);
  assert.equal(parseContador('1e3'), null);
  assert.equal(parseContador(99999999999), null);
});

test('la IP, si viene, es una IPv4 válida', () => {
  assert.match(mensajeDe(valido({ ip_address: '10.20.1' })), /IPv4/);
  assert.match(mensajeDe(valido({ ip_address: '300.1.1.1' })), /IPv4/);
});

test('cuerpo vacío o inválido responde 400, no revienta', () => {
  assert.equal(validarDatosReemplazo(undefined, HOY).error.status, 400);
  assert.equal(validarDatosReemplazo('texto', HOY).error.status, 400);
});

test('filtros del listado', () => {
  assert.deepEqual(validarFiltrosListado({}).data, {});
  assert.deepEqual(validarFiltrosListado({ cliente_id: '1', periodo: '2026-11', maquina_id: '6' }).data,
    { cliente_id: 1, periodo: '2026-11', maquina_id: 6 });
  assert.equal(validarFiltrosListado({ cliente_id: 'x' }).error.status, 400);
  assert.equal(validarFiltrosListado({ periodo: '2026-1' }).error.status, 400);
  assert.equal(validarFiltrosListado({ maquina_id: '-3' }).error.status, 400);
  // Los anulados solo se listan si se piden
  assert.equal(validarFiltrosListado({}).data.incluir_anulados, undefined);
  assert.equal(validarFiltrosListado({ incluir_anulados: 'true' }).data.incluir_anulados, true);
  assert.equal(validarFiltrosListado({ incluir_anulados: '0' }).data.incluir_anulados, false);
  assert.equal(validarFiltrosListado({ incluir_anulados: 'si' }).error.status, 400);
});

test('el contador acumulado no puede bajar respecto de la última lectura aprobada', () => {
  const lectura = { periodo: '2026-10', bn: 373108, color: 0 };
  assert.equal(contadorMenorQueLectura('El contador final', 'SIMB0002', { bn: 373108, color: 0 }, lectura), null);
  assert.match(contadorMenorQueLectura('El contador final', 'SIMB0002', { bn: 373000, color: 0 }, lectura),
    /El contador final B\/N de SIMB0002 \(373000\) es menor que su última lectura aprobada \(373108, período 2026-10\)/);
  assert.match(contadorMenorQueLectura('El contador inicial', 'X', { bn: 9, color: 1 }, { periodo: '2026-01', bn: 1, color: 2 }), /color/);
  assert.equal(contadorMenorQueLectura('El contador final', 'X', { bn: 0, color: 0 }, null), null);
});

test('utilidades de fecha y período', () => {
  assert.equal(parseFecha('2024-02-29'), '2024-02-29');
  assert.equal(parseFecha('2026-02-29'), null);
  assert.equal(periodoSiguiente('2026-12'), '2027-01');
  assert.equal(periodoSiguiente('2026-09'), '2026-10');
  // 2026-11-19 03:00 UTC todavía es 18 de noviembre en Ecuador
  assert.equal(hoyEcuador(new Date('2026-11-19T03:00:00Z')), '2026-11-18');
});

// --- Rutas: sin token no se entra (protect responde antes de tocar la base) ---

test('/api/maquinas-cambio exige token', async () => {
  const app = require('../src/app');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const base = `http://localhost:${server.address().port}`;
    const pedidos = [
      ['GET', '/api/maquinas-cambio'],
      ['GET', '/api/maquinas-cambio/1'],
      ['GET', '/api/maquinas-cambio/tipos'],
      ['GET', '/api/maquinas-cambio/ultima-lectura/1?periodo=2026-11'],
      ['POST', '/api/maquinas-cambio'],
      ['POST', '/api/maquinas-cambio/1/anular'],
    ];
    for (const [method, ruta] of pedidos) {
      const res = await fetch(`${base}${ruta}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(res.status, 401, `${method} ${ruta}`);
      assert.equal((await res.json()).success, false);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
