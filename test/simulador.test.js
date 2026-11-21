// Simulador del flujo de correo: los 3 formatos se leen igual que se escriben y el
// correo se convierte en el cuerpo que espera POST /api/ingesta/cargar.
const test = require('node:test');
const assert = require('node:assert');
const { FORMATOS, leerReporte } = require('../simulador/lib/formatos');
const { crearCorreo, leerCorreo } = require('../simulador/lib/correo');
const { correoAIngesta } = require('../simulador/lib/n8n');
const { contadoresAlCierre, repartirPorUsuario } = require('../simulador/lib/escenario');

const maquina = {
  serie: 'SIMT0001', ip: '10.0.0.1', modelo: 'Equipo de prueba «ñ»',
  contador_inicial: { impresion_bn: 1000, impresion_color: 200, copia_bn: 50, copia_color: 5 },
  consumo_mensual: { impresion_bn: 300, impresion_color: 40, copia_bn: 20, copia_color: 2 },
};
const fechaCorte = new Date(Date.UTC(2026, 9, 31, 23, 0, 0));
const contadores = { impresion_bn: 1234, impresion_color: 56, copia_bn: 78, copia_color: 9 };
const cuentas = repartirPorUsuario(contadores, [
  { cuenta: '1', nombre: 'Ana', peso: 2 },
  { cuenta: '2', nombre: 'Luis', peso: 1 },
]);

for (const [nombre, formato] of Object.entries(FORMATOS)) {
  test(`formato ${nombre}: se lee lo mismo que se escribió`, () => {
    const texto = formato.generar({ maquina, estado: 'Lista', fechaCorte, contadores, cuentas });
    const r = leerReporte(texto);
    assert.equal(r.formato, nombre);
    assert.equal(r.serie, maquina.serie);
    assert.equal(r.ip, maquina.ip);
    assert.equal(r.fechaCorte, '2026-10-31T23:00');
    assert.deepEqual(r.contadores, contadores);
  });
}

test('el reparto por usuario suma exactamente el total de la máquina', () => {
  for (const campo of Object.keys(contadores)) {
    assert.equal(cuentas.reduce((s, c) => s + c[campo], 0), contadores[campo]);
  }
});

test('los contadores son acumulados y reproducibles', () => {
  const sep = contadoresAlCierre(maquina, '2026-09', '2026-01');
  const oct = contadoresAlCierre(maquina, '2026-10', '2026-01');
  assert.deepEqual(contadoresAlCierre(maquina, '2026-10', '2026-01'), oct);
  for (const campo of Object.keys(oct)) assert.ok(oct[campo] > sep[campo], `${campo} debe crecer`);
});

test('un correo se convierte en un lote con su message_id y el detalle por usuario', () => {
  const eml = crearCorreo({
    de: '"Impresoras" <impresoras@cliente.example>', para: 'buzon@printflow.example',
    asunto: 'Reporte de contadores 2026-10 · Cliente', fecha: fechaCorte, messageId: '<prueba-1@printflow.example>',
    cuerpo: 'Reporte de prueba',
    adjuntos: [
      { nombre: 'a.csv', mime: 'text/csv', contenido: FORMATOS['csv-cuentas'].generar({ maquina, estado: 'Lista', fechaCorte, contadores, cuentas }) },
      { nombre: 'b.txt', mime: 'text/plain', contenido: FORMATOS['texto-contadores'].generar({ maquina: { ...maquina, serie: 'SIMT0002' }, estado: 'Error de comunicación', fechaCorte, contadores }) },
    ],
  });
  const correo = leerCorreo(eml);
  assert.equal(correo.asunto, 'Reporte de contadores 2026-10 · Cliente');

  const { lote, items } = correoAIngesta(correo);
  assert.deepEqual(lote, {
    codigo_referencia: 'SIM-2026-10-cliente', periodo: '2026-10', fecha_carga: '2026-10-31', message_id: '<prueba-1@printflow.example>',
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].consolidado.bn_total, contadores.impresion_bn + contadores.copia_bn);
  assert.equal(items[0].detalles.length, 2);
  assert.equal(items[0].consolidado.procesar_lectura, true);
  assert.equal(items[1].detalles.length, 0);
  assert.equal(items[1].consolidado.procesar_lectura, false, 'un equipo con falla no debe procesar su lectura');
});

// --- S3-08: reintentos y alerta al administrador ---
const entrega = require('../simulador/lib/entrega');

test('la espera entre reintentos crece: 1 s, 2 s, 4 s', () => {
  assert.deepEqual([1, 2, 3].map((n) => entrega.esperaParaReintento(n, 1000)), [1000, 2000, 4000]);
});

test('se reintenta si la API no responde o falla (0, 429, 5xx), no ante un 4xx', () => {
  for (const s of [0, 429, 500, 502, 503]) assert.equal(entrega.esReintentable(s), true, `status ${s}`);
  for (const s of [200, 400, 401, 403, 409]) assert.equal(entrega.esReintentable(s), false, `status ${s}`);
});

test('reintenta hasta lograrlo y cuenta los intentos', async () => {
  const respuestas = [{ status: 0 }, { status: 503 }, { status: 200, cuerpo: { success: true } }];
  const esperas = [];
  const r = await entrega.enviarConReintentos(async () => respuestas.shift(), {
    reintentos: 3, esperaBaseMs: 10, esperar: async (ms) => esperas.push(ms),
  });
  assert.equal(r.status, 200);
  assert.equal(r.intentos, 3);
  assert.equal(r.agotado, false);
  assert.deepEqual(esperas, [10, 20]);
});

test('si la API sigue caída, se agota sin lanzar error', async () => {
  const r = await entrega.enviarConReintentos(async () => ({ status: 0, error: 'caída' }), {
    reintentos: 2, esperaBaseMs: 1, esperar: async () => {},
  });
  assert.equal(r.agotado, true);
  assert.equal(r.intentos, 3);
});

test('un 401 no se reintenta', async () => {
  let llamadas = 0;
  const r = await entrega.enviarConReintentos(async () => { llamadas++; return { status: 401 }; }, {
    reintentos: 3, esperaBaseMs: 1, esperar: async () => {},
  });
  assert.equal(llamadas, 1);
  assert.equal(r.agotado, false);
});

test('la alerta al administrador es un correo legible con el motivo', () => {
  const eml = entrega.crearAlerta({
    archivo: '2026-10_andina.eml', asunto: 'Reporte de contadores', motivo: 'La API no responde',
    fallos: 3, pendientes: 2, para: 'admin@printflow.local', fecha: new Date(Date.UTC(2026, 10, 18)),
  });
  const correo = leerCorreo(eml);
  assert.match(correo.asunto, /no se pudo registrar «2026-10_andina\.eml»/);
  assert.match(correo.cuerpo, /La API no responde/);
  assert.match(correo.cuerpo, /no se perdió/i);
});

// --- Reemplazos de máquina (escenario.reemplazos, solo con --reemplazos) ---

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cargarEscenario, maquinasDelPeriodo, totalesBnColor } = require('../simulador/lib/escenario');
const { generarCorreos, reemplazosPorRegistrar } = require('../simulador/generar-correos');
const { generarSql } = require('../simulador/preparar-datos');

const escenario = cargarEscenario();
const horizonte = escenario.clientes.find((c) => c.codigo === 'horizonte');
const reemplazo = escenario.reemplazos[0];

test('sin --reemplazos los correos no cambian (la demo da los mismos totales)', () => {
  for (const periodo of ['2026-10', '2026-11', '2027-01']) {
    assert.deepEqual(maquinasDelPeriodo(horizonte, periodo, escenario), horizonte.maquinas);
  }
});

test('con --reemplazos, desde su período la entrante reporta en lugar de la saliente', () => {
  assert.deepEqual(maquinasDelPeriodo(horizonte, '2026-10', escenario, { reemplazos: true }), horizonte.maquinas);
  const nov = maquinasDelPeriodo(horizonte, '2026-11', escenario, { reemplazos: true });
  const series = nov.map((m) => m.serie);
  assert.deepEqual(series, ['SIMA0001', 'SIMF0006']);
  const entrante = nov[1];
  const saliente = horizonte.maquinas.find((m) => m.serie === reemplazo.saliente);
  assert.equal(entrante.ip, saliente.ip, 'la entrante hereda la IP de la saliente');
  assert.equal(entrante.area, saliente.area);
  // Sus contadores parten del inicial: el primer mes suma un consumo mensual (85 % a 115 %)
  const alCierre = contadoresAlCierre(entrante, '2026-11', entrante.periodo_base);
  const inicial = totalesBnColor(reemplazo.entrante.contador_inicial).bn;
  const promedio = totalesBnColor(reemplazo.entrante.consumo_mensual).bn;
  const consumo = totalesBnColor(alCierre).bn - inicial;
  assert.ok(consumo >= promedio * 0.85 - 2 && consumo <= promedio * 1.15 + 2, `consumo de noviembre ${consumo}`);
  // Y siguen acumulando los meses siguientes
  assert.ok(totalesBnColor(contadoresAlCierre(entrante, '2026-12', entrante.periodo_base)).bn > totalesBnColor(alCierre).bn);
});

test('generar-correos --reemplazos arma el adjunto de la entrante con la IP de la saliente', () => {
  const buzon = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-reemplazo-'));
  try {
    generarCorreos({ periodo: '2026-11', reemplazos: true, buzon });
    const { items } = correoAIngesta(leerCorreo(fs.readFileSync(path.join(buzon, '2026-11_horizonte.eml'), 'utf8')));
    assert.deepEqual(items.map((i) => i.consolidado.serie_maquina), ['SIMA0001', 'SIMF0006']);
    assert.equal(items[1].consolidado.ip_detectada, '10.20.1.12');

    generarCorreos({ periodo: '2026-11', buzon });
    const sinReemplazo = correoAIngesta(leerCorreo(fs.readFileSync(path.join(buzon, '2026-11_horizonte.eml'), 'utf8')));
    assert.deepEqual(sinReemplazo.items.map((i) => i.consolidado.serie_maquina), ['SIMA0001', 'SIMB0002']);
  } finally {
    fs.rmSync(buzon, { recursive: true, force: true });
  }
});

test('los datos para registrar el reemplazo salen del escenario', () => {
  const [r] = reemplazosPorRegistrar(escenario, '2026-11');
  assert.equal(r.saliente, 'SIMB0002');
  assert.equal(r.entrante, 'SIMF0006');
  assert.deepEqual(r.contador_inicial_entrante, { bn: 18000, color: 0 });
  assert.deepEqual(reemplazosPorRegistrar(escenario, '2026-12'), []);
});

test('preparar-datos registra la entrante libre (sin asignación)', () => {
  const sql = generarSql(escenario);
  assert.match(sql, /INSERT INTO maquinas \(serie, tipo_impresion_id, modelo_id\) VALUES \('SIMF0006'/);
  assert.doesNotMatch(sql, /INSERT INTO instalaciones[^\n]*'SIMF0006'/);
});

// --- Escenario grande para medir el rendimiento (S4-05) ---
const { generarEscenarioGrande, escenarioDeArgs, repartirMaquinas } = require('../simulador/lib/escenarioGrande');

test('--maquinas 500 reparte 500 máquinas entre 20 clientes, sin series ni RUC repetidos', () => {
  const grande = generarEscenarioGrande({ maquinas: 500, clientes: 20 });
  const maquinas = grande.clientes.flatMap((c) => c.maquinas);
  assert.equal(grande.clientes.length, 20);
  assert.equal(maquinas.length, 500);
  assert.equal(new Set(maquinas.map((m) => m.serie)).size, 500);
  assert.equal(new Set(grande.clientes.map((c) => c.ruc)).size, 20);
  assert.equal(new Set(grande.clientes.map((c) => c.codigo)).size, 20);
  // El cliente más grande es el primero agregado
  const tamanos = grande.clientes.map((c) => c.maquinas.length);
  assert.equal(Math.max(...tamanos), grande.clientes.find((c) => c.codigo === 'carga01').maquinas.length);
  assert.deepEqual(generarEscenarioGrande({ maquinas: 500, clientes: 20 }), grande, 'es reproducible');
});

test('el escenario grande conserva los clientes de la demo tal cual (Horizonte sigue dando lo mismo)', () => {
  const grande = generarEscenarioGrande({ maquinas: 500, clientes: 20 });
  assert.deepEqual(grande.clientes.slice(0, escenario.clientes.length), escenario.clientes);
  assert.deepEqual(grande.reemplazos, escenario.reemplazos);
});

test('repartirMaquinas suma exactamente lo pedido', () => {
  for (const [total, clientes] of [[495, 18], [10, 3], [7, 7], [100, 1]]) {
    const reparto = repartirMaquinas(total, clientes);
    assert.equal(reparto.length, clientes);
    assert.equal(reparto.reduce((s, n) => s + n, 0), total);
    assert.ok(reparto.every((n) => n >= 1));
  }
});

test('sin --maquinas se usa el escenario normal; con --maquinas, el grande', () => {
  assert.deepEqual(escenarioDeArgs([], {}), escenario);
  assert.equal(escenarioDeArgs(['--maquinas', '60', '--clientes', '5'], {}).clientes.length, 5);
  assert.equal(escenarioDeArgs([], { SIM_MAQUINAS: '60', SIM_CLIENTES: '4' }).clientes.flatMap((c) => c.maquinas).length, 60);
  assert.throws(() => escenarioDeArgs(['--maquinas', '3'], {}), /escenario grande/);
});

test('preparar-datos y generar-correos aceptan el escenario grande', () => {
  const grande = generarEscenarioGrande({ maquinas: 60, clientes: 5 });
  const sql = generarSql(grande);
  assert.equal((sql.match(/INSERT INTO instalaciones/g) || []).length, 60);
  const buzon = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-grande-'));
  try {
    const archivos = generarCorreos({ periodo: '2026-10', escenario: grande, buzon });
    assert.equal(archivos.length, 5);
    const series = archivos.flatMap((a) => correoAIngesta(leerCorreo(fs.readFileSync(path.join(buzon, a), 'utf8'))).items
      .map((i) => i.consolidado.serie_maquina));
    assert.deepEqual(series.sort(), grande.clientes.flatMap((c) => c.maquinas.map((m) => m.serie)).sort());
  } finally {
    fs.rmSync(buzon, { recursive: true, force: true });
  }
});
