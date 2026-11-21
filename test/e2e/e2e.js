#!/usr/bin/env node
// S4-06 · Prueba de punta a punta (E2E) contra Docker. Ver docs/e2e.md.
//
//   npm run e2e                     levanta una copia aparte del sistema, la prueba entera y la baja
//   npm run e2e -- --dejar-arriba   no la baja al terminar (para mirarla en http://localhost:8099)
//
// No toca la base de desarrollo: usa su propio proyecto de Docker Compose (printflow-e2e), sus
// propios puertos (web 8099 y base 5499) y su propio buzón temporal para el simulador.
// Variables: E2E_PROYECTO, E2E_WEB_PORT, E2E_DB_PORT.
//
// Recorre: base limpia → preparar-datos.js → correos de 2026-08 a 2026-10 → aprobación por la API →
// consolidado contra el cálculo a mano del escenario → seguridad → RETROCESO, SALTO_ANOMALO y
// DUPLICADA → reemplazo de noviembre. Termina con código 1 si alguna comprobación falla.
//
// Este archivo NO termina en .test.js a propósito: `npm test` (node --test test/*.test.js) no lo
// ejecuta, porque necesita Docker. Un `node --test` sin argumentos sí lo encontraría (busca todo lo
// que esté dentro de test/): en ese caso no hace nada.
if (process.env.NODE_TEST_CONTEXT) {
  console.log('test/e2e/e2e.js no corre dentro de node --test: usa npm run e2e');
  process.exit(0);
}

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const { cargarEscenario, contadoresAlCierre, totalesBnColor, maquinasDelPeriodo, sumarMeses } = require('../../simulador/lib/escenario');
const { generarCorreos, reemplazosPorRegistrar } = require('../../simulador/generar-correos');
const { generarSql } = require('../../simulador/preparar-datos');

const args = process.argv.slice(2);
const DEJAR_ARRIBA = args.includes('--dejar-arriba');
const PROYECTO = process.env.E2E_PROYECTO || 'printflow-e2e';
const WEB_PORT = process.env.E2E_WEB_PORT || '8099';
const DB_PORT = process.env.E2E_DB_PORT || '5499';
const BASE = `http://localhost:${WEB_PORT}`;
const CLAVE = 'Printflow2026*';
const MESES = ['2026-08', '2026-09', '2026-10'];
const NOVIEMBRE = '2026-11';
const ENV = { ...process.env, WEB_PORT, DB_HOST_PORT: DB_PORT };

const escenario = cargarEscenario();
const inicio = Date.now();

// ---------------------------------------------------------------------------
// Salida: cada comprobación con ✓ o ✗ y el resumen al final
// ---------------------------------------------------------------------------

let total = 0;
const fallos = [];
let seccionActual = '';

function seccion(titulo) {
  seccionActual = titulo;
  console.log(`\n${titulo}`);
}

function comprobar(ok, texto, detalle) {
  total += 1;
  if (ok) {
    console.log(`  ✓ ${texto}`);
  } else {
    fallos.push(`[${seccionActual}] ${texto}${detalle ? ` — ${detalle}` : ''}`);
    console.log(`  ✗ ${texto}`);
    if (detalle) console.log(`      ${String(detalle).split('\n').join('\n      ')}`);
  }
  return ok;
}

// Un paso del que dependen los siguientes: si falla, la prueba se corta
class Abortar extends Error {}
function exigir(ok, texto, detalle) {
  if (!comprobar(ok, texto, detalle)) throw new Abortar(texto);
}

const igual = (obtenido, esperado) => JSON.stringify(obtenido) === JSON.stringify(esperado);
const diferencia = (obtenido, esperado) => `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(obtenido)}`;
const numero = (n) => Number(n || 0).toLocaleString('es-EC');
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const duracion = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};

// ---------------------------------------------------------------------------
// Docker Compose (siempre con -p PROYECTO y los puertos propios)
// ---------------------------------------------------------------------------

function compose(argumentos, { input } = {}) {
  const r = spawnSync('docker', ['compose', '-p', PROYECTO, ...argumentos], {
    cwd: RAIZ, env: ENV, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { codigo: r.error ? -1 : r.status, salida: `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}` };
}

const ultimasLineas = (texto, n = 25) => texto.trim().split(/\r?\n/).slice(-n).join('\n');

function leerEnv() {
  const ruta = path.join(RAIZ, '.env');
  if (!fs.existsSync(ruta)) return null;
  const variables = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_]\w*)\s*=(.*)$/.exec(linea);
    if (m) variables[m[1]] = m[2].trim();
  }
  return variables;
}

let DB_USER = 'postgres';
let DB_NAME = 'printflow';

function psql(sql) {
  return compose(['exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB_NAME, '-q', '-t', '-A'], { input: sql });
}

// ---------------------------------------------------------------------------
// Simulador: los correos se generan aquí y el «n8n» los procesa dentro de Docker (nginx bloquea la
// ingesta desde fuera). Usa un buzón temporal propio para no mezclarse con simulador/buzon.
// ---------------------------------------------------------------------------

const BUZON = fs.mkdtempSync(path.join(os.tmpdir(), 'printflow-e2e-buzon-'));
// Las carpetas se crean aquí: así lo que escribe el contenedor se puede borrar al final
['entrada', 'procesados', 'con-error', 'alertas'].forEach((d) => fs.mkdirSync(path.join(BUZON, d), { recursive: true }));
const correosEn = (carpeta) => fs.readdirSync(path.join(BUZON, carpeta)).filter((a) => a.endsWith('.eml'));

function enviarCorreos(periodo, { reemplazos = false } = {}) {
  const antes = correosEn('procesados').length;
  const archivos = generarCorreos({ periodo, reemplazos, buzon: path.join(BUZON, 'entrada'), escenario });
  const r = compose(['run', '--rm', '--no-deps', '-T', '-v', `${BUZON.replace(/\\/g, '/')}:/simulador/buzon`, 'simulador', 'procesar-buzon.js']);
  const procesados = correosEn('procesados').length - antes;
  comprobar(r.codigo === 0 && procesados === archivos.length && correosEn('entrada').length === 0,
    `${periodo}: el n8n simulado procesó ${procesados} de ${archivos.length} correos (${archivos.join(', ')})`,
    r.codigo === 0 ? `con error: ${correosEn('con-error').join(', ') || 'ninguno'}` : ultimasLineas(r.salida));
}

// ---------------------------------------------------------------------------
// API (por el puerto de la web, como la usa el navegador)
// ---------------------------------------------------------------------------

async function api(ruta, { token, metodo = 'GET', cuerpo } = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let datos = {};
  try { datos = JSON.parse(texto); } catch { datos = { texto }; }
  return { status: respuesta.status, datos, cabeceras: respuesta.headers };
}

async function iniciarSesion(rol) {
  const { status, datos } = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: `${rol}@printflow.local`, password: CLAVE } });
  exigir(status === 200 && Boolean(datos.token), `Sesión iniciada como ${rol}@printflow.local`, `HTTP ${status}: ${datos.message}`);
  return datos.token;
}

async function esperarApi(segundos = 180) {
  const limite = Date.now() + segundos * 1000;
  let ultimo = '';
  while (Date.now() < limite) {
    try {
      const { status } = await api('/api/auth/validate-token');
      if (status < 500 && status !== 404) return { ok: true };
      ultimo = `HTTP ${status}`;
    } catch (error) {
      ultimo = error.cause?.code || error.message;
    }
    await esperar(2000);
  }
  return { ok: false, ultimo };
}

// Lotes pendientes de un mes, por código: { 'SIM-2026-08-horizonte': { loteId, filas } }
async function lotesPendientes(token, periodo) {
  const { datos } = await api('/api/staging/pendientes', { token });
  const lotes = {};
  for (const fila of datos.data || []) {
    if (!String(fila.lote_codigo || '').startsWith(`SIM-${periodo}-`)) continue;
    lotes[fila.lote_codigo] ||= { loteId: fila.lote_id, filas: [] };
    lotes[fila.lote_codigo].filas.push(fila);
  }
  return lotes;
}

const aprobar = (token, loteId, periodo) => api('/api/staging/approve-batch', { token, metodo: 'POST', cuerpo: { loteId, periodo } });

// ---------------------------------------------------------------------------
// Cálculo a mano del escenario (independiente del código de la API)
// ---------------------------------------------------------------------------

// Total B/N y color acumulado de una máquina al cierre del mes, como lo envía en su correo
const lecturaEsperada = (maquina, periodo) =>
  totalesBnColor(contadoresAlCierre(maquina, periodo, maquina.periodo_base || escenario.periodo_base));

// Dinero en milésimas de dólar (enteros) para no arrastrar errores de coma flotante
const milesimas = (valor) => Math.round(Number(valor) * 1000);
const aDolares = (mil) => (Math.round(mil / 10) / 100).toFixed(2);

// Regla del contrato (S3-06): por separado para B/N y color, cuota fija de las páginas incluidas
// (se cobra siempre) + excedente por lo que pasa de ellas; más la renta de los equipos.
function facturacionEsperada(contrato, consumo, renta = 0) {
  const tramo = (paginas, incluidas, costo, costoExcedente) => {
    const excedente = Math.max(0, paginas - incluidas);
    const cuota = incluidas * milesimas(costo);
    const montoExcedente = excedente * milesimas(costoExcedente);
    return {
      valores: { consumo: paginas, incluidas, excedente, cuota_fija: aDolares(cuota), monto_excedente: aDolares(montoExcedente) },
      centavos: Math.round(cuota / 10) + Math.round(montoExcedente / 10),
    };
  };
  const bn = tramo(consumo.bn, contrato.impresiones_bn_incluidas, contrato.costo_impresion_bn, contrato.costo_excedente_impresion_bn);
  const color = tramo(consumo.color, contrato.impresiones_color_incluidas, contrato.costo_impresion_color, contrato.costo_excedente_impresion_color);
  const rentaCentavos = Math.round(renta * 100);
  return {
    modo: 'DIFERENCIAR',
    bn: bn.valores,
    color: color.valores,
    renta: (rentaCentavos / 100).toFixed(2),
    total: ((bn.centavos + color.centavos + rentaCentavos) / 100).toFixed(2),
  };
}

const soloTramo = (t = {}) => ({
  consumo: t.consumo, incluidas: t.incluidas, excedente: t.excedente, cuota_fija: t.cuota_fija, monto_excedente: t.monto_excedente,
});

async function consolidado(token, clienteId, periodo) {
  const { status, datos } = await api(`/api/reportes/consolidado/${clienteId}/${periodo}`, { token });
  return { status, data: datos.data || {} };
}

// Compara el consolidado de un cliente y mes con el escenario. Devuelve el consolidado.
// `consumoEsperado(maquina)` da { bn, color } o null si ese mes no se compara el consumo.
async function compararConsolidado(token, cliente, clienteId, periodo, { reemplazos = false, primerMes = false } = {}) {
  const { status, data } = await consolidado(token, clienteId, periodo);
  if (!comprobar(status === 200, `${cliente.nombre} · ${periodo}: GET consolidado`, `HTTP ${status}`)) return null;
  const filas = data.detalles || [];
  const maquinas = maquinasDelPeriodo(cliente, periodo, escenario, { reemplazos });

  comprobar(filas.length === maquinas.length, `${cliente.nombre} · ${periodo}: ${maquinas.length} máquinas en el consolidado`,
    diferencia(filas.map((f) => f.info?.serie), maquinas.map((m) => m.serie)));

  const consumo = { bn: 0, color: 0 };
  for (const m of maquinas) {
    const fila = filas.find((f) => f.info?.serie === m.serie);
    if (!comprobar(Boolean(fila), `${periodo} · ${m.serie}: tiene fila en el consolidado`)) continue;
    const lectura = lecturaEsperada(m, periodo);
    const obtenida = { bn: fila.actual?.total_contador_bn, color: fila.actual?.total_contador_color };
    if (primerMes) {
      // Primer mes de la simulación: no hay lectura anterior; se compara la lectura aprobada
      comprobar(igual(obtenida, lectura), `${periodo} · ${m.serie}: lectura aprobada B/N ${numero(lectura.bn)} · color ${numero(lectura.color)}`,
        diferencia(obtenida, lectura));
      continue;
    }
    const anterior = lecturaEsperada(m, sumarMeses(periodo, -1));
    const esperado = { bn: lectura.bn - anterior.bn, color: lectura.color - anterior.color };
    const real = { bn: fila.consumo?.total_bn, color: fila.consumo?.total_color };
    comprobar(igual(obtenida, lectura) && igual(real, esperado),
      `${periodo} · ${m.serie}: consumo B/N ${numero(esperado.bn)} · color ${numero(esperado.color)}`,
      `lectura ${diferencia(obtenida, lectura)}; consumo ${diferencia(real, esperado)}`);
    consumo.bn += esperado.bn;
    consumo.color += esperado.color;
  }
  if (primerMes) return data;

  const esperada = facturacionEsperada(cliente.contrato, consumo, 0);
  const facturacion = data.resumen?.facturacion || [];
  const c = facturacion[0] || {};
  const obtenida = { modo: c.modo, bn: soloTramo(c.bn), color: soloTramo(c.color), renta: c.renta, total: c.total };
  comprobar(facturacion.length === 1 && igual(obtenida, esperada),
    `${cliente.nombre} · ${periodo}: facturación B/N cuota $${esperada.bn.cuota_fija} + excedente $${esperada.bn.monto_excedente}` +
    ` · color cuota $${esperada.color.cuota_fija} + excedente $${esperada.color.monto_excedente} · renta $${esperada.renta} = $${esperada.total}`,
    diferencia(facturacion.length === 1 ? obtenida : facturacion, esperada));
  comprobar(data.resumen?.monto_total_general === esperada.total, `${cliente.nombre} · ${periodo}: total a facturar $${esperada.total}`,
    diferencia(data.resumen?.monto_total_general, esperada.total));
  return data;
}

// ---------------------------------------------------------------------------
// La prueba
// ---------------------------------------------------------------------------

async function prueba() {
  console.log('PrintFlow · prueba de punta a punta (E2E)');
  console.log(`Proyecto de Docker: ${PROYECTO} · web ${BASE} · base 127.0.0.1:${DB_PORT}`);
  console.log('No toca tu base de desarrollo (proyecto «printflow»).');

  // 1 ---------------------------------------------------------------------
  seccion('1. Base limpia y sistema arriba');
  const env = leerEnv();
  exigir(Boolean(env), 'Existe el .env del backend', 'Falta el .env: corre `npm run configurar` y vuelve a intentarlo');
  exigir(Boolean(env.INGESTA_TOKEN && env.DB_PASSWORD && env.SECRET_KEY), 'El .env tiene DB_PASSWORD, SECRET_KEY e INGESTA_TOKEN',
    'Corre `npm run configurar` para completarlo');
  DB_USER = env.DB_USER || DB_USER;
  DB_NAME = env.DB_NAME || DB_NAME;

  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  exigir(info.status === 0, 'Docker está corriendo', 'Abre Docker Desktop y espera «Engine running»');

  let r = compose(['down', '-v', '--remove-orphans']);
  exigir(r.codigo === 0, `docker compose -p ${PROYECTO} down -v (base limpia)`, ultimasLineas(r.salida));

  console.log('  … construyendo y levantando db, api y web (la primera vez tarda unos minutos)');
  const tUp = Date.now();
  r = compose(['up', '-d', '--build', 'db', 'api', 'web']);
  exigir(r.codigo === 0, `docker compose up -d --build db api web (${duracion(Date.now() - tUp)})`, ultimasLineas(r.salida));

  const salud = await esperarApi();
  exigir(salud.ok, `La API responde en ${BASE}`, `Última respuesta: ${salud.ultimo}. Mira: docker compose -p ${PROYECTO} logs api`);

  r = psql(generarSql(escenario));
  exigir(r.codigo === 0 && r.salida.includes('Simulación lista: 5 máquinas asignadas'),
    'preparar-datos.js: clientes, contratos, áreas y 5 máquinas asignadas', ultimasLineas(r.salida));

  const operador = await iniciarSesion('operador');
  const admin = await iniciarSesion('admin');
  const auditor = await iniciarSesion('auditor');

  const ids = {};
  for (const cliente of escenario.clientes) {
    const { status, datos } = await api(`/api/clientes/ruc/${cliente.ruc}`, { token: operador });
    ids[cliente.codigo] = (datos.data || datos)?.id_cliente;
    exigir(status === 200 && Boolean(ids[cliente.codigo]), `Cliente ${cliente.nombre} registrado (#${ids[cliente.codigo]})`, `HTTP ${status}`);
  }

  // 2 ---------------------------------------------------------------------
  seccion(`2. Correos de ${MESES[0]} a ${MESES[MESES.length - 1]}, ingesta y aprobación por la API (operador)`);
  const lotesAprobados = {};
  for (const periodo of MESES) {
    enviarCorreos(periodo);
    const lotes = await lotesPendientes(operador, periodo);
    for (const cliente of escenario.clientes) {
      const codigo = `SIM-${periodo}-${cliente.codigo}`;
      const lote = lotes[codigo];
      if (!comprobar(Boolean(lote), `${codigo}: lote en staging`, `lotes pendientes: ${Object.keys(lotes).join(', ') || 'ninguno'}`)) continue;
      const conError = lote.filas.filter((f) => f.estado_maquina === 'ERROR');
      comprobar(lote.filas.length === cliente.maquinas.length && conError.length === 0,
        `${codigo}: ${lote.filas.length} lecturas, ninguna en ERROR`,
        conError.map((f) => `${f.serie_maquina}: ${f.mensaje_aviso}`).join('; '));
      const { status, datos } = await aprobar(operador, lote.loteId, periodo);
      comprobar(status === 200, `${codigo} (#${lote.loteId}) aprobado`, `HTTP ${status}: ${(datos.errores || [datos.message]).join('; ')}`);
      if (status === 200) lotesAprobados[codigo] = lote.loteId;
    }
  }

  // 3 ---------------------------------------------------------------------
  seccion('3. Consolidado contra el cálculo a mano del escenario (contadoresAlCierre)');
  for (const periodo of MESES) {
    for (const cliente of escenario.clientes) {
      const data = await compararConsolidado(operador, cliente, ids[cliente.codigo], periodo, { primerMes: periodo === MESES[0] });
      if (cliente.codigo === 'horizonte' && periodo === '2026-10') {
        comprobar(data?.resumen?.monto_total_general === '395.48', 'Colegio Horizonte · 2026-10 factura $395,48 (el número de la demo)',
          `obtenido $${data?.resumen?.monto_total_general}`);
      }
    }
  }

  // 4 ---------------------------------------------------------------------
  seccion('4. Seguridad');
  let res = await api('/api/auth/perfil');
  comprobar(res.status === 401, 'Sin token: GET /api/auth/perfil → 401', `HTTP ${res.status}`);
  res = await api('/api/auth/perfil', { token: 'token-falso' });
  comprobar(res.status === 401, 'Token falso: GET /api/auth/perfil → 401', `HTTP ${res.status}`);
  res = await api('/api/auth/perfil', { token: operador });
  comprobar(res.status === 200 && Boolean(res.cabeceras.get('x-nuevo-token')), 'Token válido: 200 y la respuesta trae X-Nuevo-Token',
    `HTTP ${res.status}`);
  res = await aprobar(auditor, lotesAprobados['SIM-2026-10-horizonte'] || 1, '2026-10');
  comprobar(res.status === 403, 'El auditor no puede aprobar lotes: POST /api/staging/approve-batch → 403', `HTTP ${res.status}`);
  res = await api('/api/ingesta/cargar', { metodo: 'POST', cuerpo: [], token: env.INGESTA_TOKEN });
  comprobar(res.status === 403, `Ingesta desde fuera (puerto ${WEB_PORT}), aun con el token de ingesta → 403`, `HTTP ${res.status}`);
  res = await api('/api/auditoria?tabla=lotes_carga', { token: auditor });
  comprobar(res.status === 403, 'La auditoría es solo para admin: el auditor recibe 403', `HTTP ${res.status}`);
  const loteAuditado = lotesAprobados['SIM-2026-10-horizonte'];
  res = await api(`/api/auditoria?tabla=lotes_carga&id_registro=${loteAuditado}`, { token: admin });
  const aprobacion = (res.datos.data || []).find((a) => a.accion === 'APROBAR');
  comprobar(res.status === 200 && aprobacion?.usuario_email === 'operador@printflow.local',
    `GET /api/auditoria (admin) muestra la aprobación del lote #${loteAuditado} por operador@printflow.local`,
    `HTTP ${res.status}: ${JSON.stringify((res.datos.data || []).map((a) => [a.accion, a.usuario_email]))}`);

  // 5 ---------------------------------------------------------------------
  seccion('5. Validaciones de lecturas (S3-01): DUPLICADA, RETROCESO y SALTO_ANOMALO');
  const horizonte = escenario.clientes.find((c) => c.codigo === 'horizonte');
  const andina = escenario.clientes.find((c) => c.codigo === 'andina');
  const maquinaDe = (serie) => escenario.clientes.flatMap((c) => c.maquinas).find((m) => m.serie === serie);
  const instalacion = async (serie) => (await api(`/api/instalacion/serie/${serie}`, { token: operador })).datos.data || {};

  // DUPLICADA con la lectura manual: SIMA0001 ya tiene su lectura de octubre aprobada
  const simA = await instalacion('SIMA0001');
  const octubreA = lecturaEsperada(maquinaDe('SIMA0001'), '2026-10');
  res = await api('/api/lecturas/manual', {
    token: operador,
    metodo: 'POST',
    cuerpo: {
      instalacion_id: simA.id_instalacion, fecha_lectura: '2026-10-20',
      contador_bn: octubreA.bn, contador_color: octubreA.color, observacion: 'Prueba E2E: lectura de un mes ya aprobado',
    },
  });
  comprobar(res.status === 400 && res.datos.codigo === 'DUPLICADA',
    `Lectura manual de SIMA0001 en 2026-10 (ya aprobado) → 400 DUPLICADA: «${res.datos.message}»`,
    `HTTP ${res.status}: ${JSON.stringify(res.datos)}`);

  // DUPLICADA en un lote: el operador registra a mano la lectura de noviembre de SIME0005 y luego
  // llega igual su correo
  const simE = await instalacion('SIME0005');
  const noviembreE = lecturaEsperada(maquinaDe('SIME0005'), NOVIEMBRE);
  res = await api('/api/lecturas/manual', {
    token: operador,
    metodo: 'POST',
    cuerpo: {
      instalacion_id: simE.id_instalacion, fecha_lectura: '2026-11-20',
      contador_bn: noviembreE.bn, contador_color: noviembreE.color, observacion: 'Prueba E2E: el equipo no envió su correo',
    },
  });
  comprobar(res.status === 201, 'Lectura manual de SIME0005 para 2026-11 registrada (201)', `HTTP ${res.status}: ${res.datos.message}`);

  // RETROCESO y SALTO_ANOMALO alterando el historial aprobado de Constructora Andina (como en el PR #58).
  // Solo se tocan máquinas de Andina: el reemplazo de noviembre es de Colegio Horizonte.
  r = psql(`
    UPDATE reportes_oficiales SET contador_impresiones_bn = contador_impresiones_bn + 100000000
     WHERE periodo = '2026-10' AND maquina_id = (SELECT id_maquina FROM maquinas WHERE serie = 'SIMC0003');
    UPDATE reportes_oficiales SET contador_impresiones_bn = contador_impresiones_bn / 10
     WHERE periodo IN ('2026-08', '2026-09', '2026-10') AND maquina_id = (SELECT id_maquina FROM maquinas WHERE serie = 'SIMD0004');
  `);
  comprobar(r.codigo === 0, 'Historial alterado: SIMC0003 +100.000.000 en octubre (retroceso) y SIMD0004 ÷10 de agosto a octubre (salto)',
    ultimasLineas(r.salida));

  // 6 ---------------------------------------------------------------------
  seccion('6. Reemplazo de noviembre: SIMB0002 → SIMF0006 (Colegio Horizonte)');
  const datosReemplazo = reemplazosPorRegistrar(escenario, NOVIEMBRE)[0];
  const saliente = await instalacion(datosReemplazo.saliente);
  const libres = (await api('/api/instalacion/disponibles', { token: admin })).datos.data || [];
  const entrante = libres.find((m) => m.serie === datosReemplazo.entrante) || {};
  comprobar(Boolean(saliente.id_maquina && entrante.id_maquina), `${datosReemplazo.saliente} asignada y ${datosReemplazo.entrante} libre`,
    `saliente #${saliente.id_maquina}, entrante #${entrante.id_maquina}`);
  res = await api('/api/maquinas-cambio', {
    token: admin,
    metodo: 'POST',
    cuerpo: {
      maquina_saliente_id: saliente.id_maquina,
      maquina_entrante_id: entrante.id_maquina,
      fecha_danio: datosReemplazo.fecha_danio,
      fecha_instalacion_entrante: datosReemplazo.fecha_instalacion_entrante,
      periodo_afectado: datosReemplazo.periodo_afectado,
      tipo_cambio: datosReemplazo.tipo_cambio,
      razon_cambio: datosReemplazo.razon_cambio,
      contador_final_saliente_bn: datosReemplazo.contador_final_saliente.bn,
      contador_final_saliente_color: datosReemplazo.contador_final_saliente.color,
      contador_inicial_entrante_bn: datosReemplazo.contador_inicial_entrante.bn,
      contador_inicial_entrante_color: datosReemplazo.contador_inicial_entrante.color,
    },
  });
  const reemplazo = res.datos.data || {};
  comprobar(res.status === 201 && reemplazo.tipo_cambio === 'Daño',
    `Reemplazo registrado por la API (admin, tipo «${reemplazo.tipo_cambio}»): #${reemplazo.id_maquina_cambio}`,
    `HTTP ${res.status}: ${res.datos.message}`);

  enviarCorreos(NOVIEMBRE, { reemplazos: true });
  let lotes = await lotesPendientes(operador, NOVIEMBRE);

  const codigoH = `SIM-${NOVIEMBRE}-horizonte`;
  const loteH = lotes[codigoH];
  if (comprobar(Boolean(loteH), `${codigoH}: lote en staging`)) {
    const filaF = loteH.filas.find((f) => f.serie_maquina === datosReemplazo.entrante);
    if (filaF?.estado_maquina === 'ERROR') {
      res = await api(`/api/staging/${filaF.id_staging_consolidado}/reprocesar`, { token: operador, metodo: 'POST' });
      comprobar(res.status === 200 && res.datos.data?.corregido, `${datosReemplazo.entrante} estaba en ERROR («${filaF.mensaje_aviso}»): reprocesado`,
        `HTTP ${res.status}: ${res.datos.message}`);
      lotes = await lotesPendientes(operador, NOVIEMBRE);
    }
    const filas = (lotes[codigoH] || loteH).filas;
    const conError = filas.filter((f) => f.estado_maquina === 'ERROR');
    comprobar(conError.length === 0 && filas.some((f) => f.serie_maquina === datosReemplazo.entrante),
      `${codigoH}: trae a ${datosReemplazo.entrante} en lugar de ${datosReemplazo.saliente}, sin errores`,
      `${filas.map((f) => `${f.serie_maquina} ${f.estado_maquina} ${f.mensaje_aviso || ''}`).join('; ')}`);
    res = await aprobar(operador, loteH.loteId, NOVIEMBRE);
    comprobar(res.status === 200, `${codigoH} (#${loteH.loteId}) aprobado`, `HTTP ${res.status}: ${(res.datos.errores || [res.datos.message]).join('; ')}`);
  }

  // Consolidado de noviembre: SIMA0001 como siempre y una fila del cambio con los dos tramos
  const { status: stNov, data: nov } = await consolidado(operador, ids.horizonte, NOVIEMBRE);
  comprobar(stNov === 200 && (nov.detalles || []).length === 2, `${horizonte.nombre} · ${NOVIEMBRE}: 2 filas en el consolidado (SIMA0001 y la del cambio)`,
    `HTTP ${stNov}: ${(nov.detalles || []).map((f) => f.info?.serie).join(', ')}`);
  const filaA = (nov.detalles || []).find((f) => f.info?.serie === 'SIMA0001');
  const a = { actual: lecturaEsperada(maquinaDe('SIMA0001'), NOVIEMBRE), anterior: lecturaEsperada(maquinaDe('SIMA0001'), '2026-10') };
  const consumoA = { bn: a.actual.bn - a.anterior.bn, color: a.actual.color - a.anterior.color };
  comprobar(igual({ bn: filaA?.consumo?.total_bn, color: filaA?.consumo?.total_color }, consumoA),
    `${NOVIEMBRE} · SIMA0001: consumo B/N ${numero(consumoA.bn)} · color ${numero(consumoA.color)}`,
    diferencia({ bn: filaA?.consumo?.total_bn, color: filaA?.consumo?.total_color }, consumoA));

  const entranteEsc = maquinasDelPeriodo(horizonte, NOVIEMBRE, escenario, { reemplazos: true }).find((m) => m.serie === datosReemplazo.entrante);
  const octubreB = lecturaEsperada(maquinaDe(datosReemplazo.saliente), '2026-10');
  const tramoSaliente = {
    bn: datosReemplazo.contador_final_saliente.bn - octubreB.bn,
    color: datosReemplazo.contador_final_saliente.color - octubreB.color,
  };
  const lecturaF = lecturaEsperada(entranteEsc, NOVIEMBRE);
  const tramoEntrante = {
    bn: lecturaF.bn - datosReemplazo.contador_inicial_entrante.bn,
    color: lecturaF.color - datosReemplazo.contador_inicial_entrante.color,
  };
  const consumoCambio = { bn: tramoSaliente.bn + tramoEntrante.bn, color: tramoSaliente.color + tramoEntrante.color };
  const filaCambio = (nov.detalles || []).find((f) => f.info?.tiene_cambio);
  comprobar(Boolean(filaCambio) && filaCambio.cambio?.maquina_saliente?.serie === datosReemplazo.saliente &&
    filaCambio.cambio?.maquina_entrante?.serie === datosReemplazo.entrante,
  `${NOVIEMBRE}: fila con cambio (${datosReemplazo.saliente} → ${datosReemplazo.entrante})`,
  filaCambio ? `saliente ${filaCambio.cambio?.maquina_saliente?.serie}, entrante ${filaCambio.cambio?.maquina_entrante?.serie}` : 'no hay fila con tiene_cambio');
  const tramo = (lado) => ({ bn: filaCambio?.cambio?.[lado]?.contadores?.consumo?.total_bn, color: filaCambio?.cambio?.[lado]?.contadores?.consumo?.total_color });
  comprobar(igual(tramo('maquina_saliente'), tramoSaliente),
    `Tramo saliente: contador final ${numero(datosReemplazo.contador_final_saliente.bn)} − octubre ${numero(octubreB.bn)} = B/N ${numero(tramoSaliente.bn)}`,
    diferencia(tramo('maquina_saliente'), tramoSaliente));
  comprobar(igual(tramo('maquina_entrante'), tramoEntrante),
    `Tramo entrante: noviembre ${numero(lecturaF.bn)} − contador inicial ${numero(datosReemplazo.contador_inicial_entrante.bn)} = B/N ${numero(tramoEntrante.bn)}`,
    diferencia(tramo('maquina_entrante'), tramoEntrante));
  const realCambio = { bn: filaCambio?.consumo?.total_bn, color: filaCambio?.consumo?.total_color };
  comprobar(igual(realCambio, consumoCambio), `Consumo de la fila del cambio = saliente + entrante: B/N ${numero(consumoCambio.bn)} · color ${numero(consumoCambio.color)}`,
    diferencia(realCambio, consumoCambio));

  const facturaNov = facturacionEsperada(horizonte.contrato, { bn: consumoA.bn + consumoCambio.bn, color: consumoA.color + consumoCambio.color });
  const cNov = (nov.resumen?.facturacion || [])[0] || {};
  const obtenidaNov = { modo: cNov.modo, bn: soloTramo(cNov.bn), color: soloTramo(cNov.color), renta: cNov.renta, total: cNov.total };
  comprobar(igual(obtenidaNov, facturaNov) && nov.resumen?.monto_total_general === facturaNov.total,
    `${horizonte.nombre} · ${NOVIEMBRE}: facturación con el reemplazo = $${facturaNov.total}`, diferencia(obtenidaNov, facturaNov));

  const { data: octDespues } = await consolidado(operador, ids.horizonte, '2026-10');
  comprobar(octDespues.resumen?.monto_total_general === '395.48', `${horizonte.nombre} · 2026-10 no cambió con el reemplazo: sigue en $395,48`,
    `obtenido $${octDespues.resumen?.monto_total_general}`);

  res = await api(`/api/maquinas-cambio/${reemplazo.id_maquina_cambio}/anular`, { token: admin, metodo: 'POST', cuerpo: { motivo: 'Prueba E2E: anular con el período aprobado' } });
  comprobar(res.status === 409, `Anular el reemplazo #${reemplazo.id_maquina_cambio} con ${NOVIEMBRE} aprobado → 409: «${res.datos.message}»`,
    `HTTP ${res.status}: ${res.datos.message}`);

  // 7 ---------------------------------------------------------------------
  seccion('7. Lote de noviembre de Constructora Andina con las tres validaciones');
  const codigoA = `SIM-${NOVIEMBRE}-andina`;
  const loteA = lotes[codigoA];
  if (comprobar(Boolean(loteA), `${codigoA}: lote en staging`)) {
    const esperados = [
      { serie: 'SIMC0003', regla: 'RETROCESO', texto: 'Retroceso de contador' },
      { serie: 'SIMD0004', regla: 'SALTO_ANOMALO', texto: 'Salto anómalo' },
      { serie: 'SIME0005', regla: 'DUPLICADA', texto: 'Lectura duplicada' },
    ];
    for (const e of esperados) {
      const fila = loteA.filas.find((f) => f.serie_maquina === e.serie);
      comprobar(fila?.estado_maquina === 'ERROR' && fila.procesar_lectura === false && String(fila.mensaje_aviso || '').startsWith(e.texto),
        `${e.regla}: ${e.serie} en ERROR con «${fila?.mensaje_aviso}»`,
        fila ? `estado ${fila.estado_maquina}, procesar_lectura ${fila.procesar_lectura}` : 'sin fila en el lote');
    }
    res = await aprobar(operador, loteA.loteId, NOVIEMBRE);
    const errores = res.datos.errores || [];
    // Los errores de la ingesta vuelven tal cual su mensaje_aviso (sin la serie)
    comprobar(res.status === 409 && esperados.every((e) => errores.some((t) => t.startsWith(e.texto))),
      `Aprobar ${codigoA} (#${loteA.loteId}) → 409 con los tres motivos (retroceso, salto anómalo y duplicada)`,
      `HTTP ${res.status}: ${errores.join('; ') || res.datos.message}`);
    const pendiente = (await lotesPendientes(operador, NOVIEMBRE))[codigoA];
    comprobar(Boolean(pendiente), `${codigoA} sigue pendiente (no se aprobó nada)`);
  }
}

async function main() {
  let error = null;
  try {
    await prueba();
  } catch (e) {
    error = e;
    if (!(e instanceof Abortar)) comprobar(false, 'Error inesperado de la prueba', e.stack || e.message);
    console.log('\n  La prueba se cortó aquí: los pasos siguientes dependen de este.');
  }

  seccion('Cierre');
  if (DEJAR_ARRIBA) {
    console.log(`  El sistema de la prueba sigue arriba: ${BASE} (usuarios de siempre, contraseña ${CLAVE}).`);
    console.log(`  Para bajarlo: docker compose -p ${PROYECTO} down -v`);
  } else {
    const r = compose(['down', '-v', '--remove-orphans']);
    console.log(r.codigo === 0 ? `  Sistema de la prueba bajado (docker compose -p ${PROYECTO} down -v)` : `  No se pudo bajar: ${ultimasLineas(r.salida, 5)}`);
  }
  try { fs.rmSync(BUZON, { recursive: true, force: true }); } catch { /* el buzón temporal no es importante */ }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${total} comprobaciones, ${fallos.length} fallos · ${duracion(Date.now() - inicio)}`);
  if (fallos.length > 0) {
    console.log('\nFallos:');
    fallos.forEach((f) => console.log(`  ✗ ${f}`));
  }
  console.log('='.repeat(70));
  process.exit(fallos.length > 0 || error ? 1 : 0);
}

main();
