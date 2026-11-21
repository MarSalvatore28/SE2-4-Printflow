// Demo de punta a punta: correo → n8n (simulado) → ingesta → staging → aprobación → consolidado.
//
//   node demo.js                               agosto a octubre de 2026, con casos de error el último mes
//   node demo.js --desde 2026-06 --hasta 2026-10
//   node demo.js --sin-errores
//   node demo.js --maquinas 500 --desde 2026-01 --hasta 2026-10 --sin-errores   (escenario grande, S4-05)
//
// La aprobación la hace aquí el operador por la API para que la demo corra sola (en la aplicación
// se puede hacer desde Notificaciones → Lotes). Requiere haber cargado antes los datos (preparar-datos.js).

const { generarCorreos } = require('./generar-correos');
const { procesarBuzon } = require('./procesar-buzon');
const { validarPeriodo, sumarMeses } = require('./lib/escenario');
const { escenarioDeArgs } = require('./lib/escenarioGrande');

const API_URL = process.env.API_URL || 'http://api:9000';
const USUARIO = process.env.DEMO_EMAIL || 'operador@printflow.local';
const CLAVE = process.env.DEMO_PASSWORD || 'Printflow2026*';

const args = process.argv.slice(2);
const valor = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i === -1 ? porDefecto : args[i + 1];
};

// Con más máquinas que esto por cliente, el consolidado muestra solo los totales (escenario grande)
const MAX_FILAS = 10;

const titulo = (texto) => console.log(`\n${'='.repeat(70)}\n${texto}\n${'='.repeat(70)}`);
const numero = (n) => Number(n || 0).toLocaleString('es-EC');

async function api(ruta, { token, metodo = 'GET', cuerpo } = {}) {
  const respuesta = await fetch(`${API_URL}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: respuesta.status, datos: await respuesta.json().catch(() => ({})) };
}

async function iniciarSesion() {
  const { status, datos } = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: USUARIO, password: CLAVE } });
  if (status !== 200) throw new Error(`No se pudo iniciar sesión como ${USUARIO} (HTTP ${status}: ${datos.message})`);
  console.log(`Sesión iniciada como ${USUARIO} (${datos.usuario?.rol?.nombre || 'sin rol'})`);
  return datos.token;
}

async function comprobarDatos(token, escenario) {
  const ids = {};
  for (const cliente of escenario.clientes) {
    const { status, datos } = await api(`/api/clientes/ruc/${cliente.ruc}`, { token });
    const id = (datos.data || datos)?.id_cliente;
    if (status !== 200 || !id) {
      throw new Error(`No existe el cliente ${cliente.nombre}. Primero carga los datos:\n` +
        '  docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow');
    }
    ids[cliente.codigo] = id;
  }
  return ids;
}

async function aprobarLotes(token, periodo) {
  const { datos } = await api('/api/staging/pendientes', { token });
  const lotes = new Map();
  for (const fila of datos.data || []) {
    if (String(fila.lote_codigo || '').startsWith(`SIM-${periodo}-`)) lotes.set(fila.lote_id, fila.lote_codigo);
  }
  if (lotes.size === 0) console.log('No hay lotes pendientes de este mes (ya estaban aprobados).');

  for (const [loteId, codigo] of lotes) {
    const { status, datos: r } = await api('/api/staging/approve-batch', { token, metodo: 'POST', cuerpo: { loteId, periodo } });
    if (status === 200) {
      console.log(`✓ Lote ${codigo} (#${loteId}) aprobado: sus lecturas pasan a reportes oficiales`);
    } else {
      console.log(`✗ Lote ${codigo} (#${loteId}) NO se puede aprobar (HTTP ${status}). El operador ve:`);
      (r.errores || [r.message]).forEach((e) => console.log(`    - ${e}`));
    }
  }
}

async function mostrarConsolidado(token, escenario, ids, periodo) {
  for (const cliente of escenario.clientes) {
    const { status, datos } = await api(`/api/reportes/consolidado/${ids[cliente.codigo]}/${periodo}`, { token });
    if (status !== 200) {
      console.log(`${cliente.nombre}: no se pudo obtener el consolidado (HTTP ${status})`);
      continue;
    }
    const filas = datos.data?.detalles || [];
    console.log(`\n${cliente.nombre} · ${periodo}`);
    if (filas.length === 0) {
      console.log('  (sin lecturas aprobadas en el período)');
      continue;
    }
    if (filas.length > MAX_FILAS) console.log(`  (${filas.length} máquinas: el detalle por máquina está en Informes)`);
    else console.log('  Serie       Tipo    Consumo B/N   Consumo color   Total     Monto ref.');
    for (const f of filas.length > MAX_FILAS ? [] : filas) {
      console.log(`  ${String(f.info.serie).padEnd(11)} ${String(f.info.tipo_impresion).padEnd(7)}` +
        ` ${numero(f.consumo.total_bn).padStart(11)} ${numero(f.consumo.total_color).padStart(15)}` +
        ` ${numero(f.consumo.gran_total).padStart(7)}   $${f.financiero.monto_referencial ?? f.financiero.monto_total}`);
    }
    const r = datos.data.resumen || {};
    const tramo = (nombre, t) => `${nombre} ${numero(t.consumo)} págs. (incluidas ${numero(t.incluidas)}): cuota $${t.cuota_fija} + excedente $${t.monto_excedente}`;
    for (const c of r.facturacion || []) {
      console.log(`  Contrato #${c.contrato_id}: ${tramo('B/N', c.bn)} · ${tramo('color', c.color)} · renta $${c.renta} = $${c.total}`);
    }
    console.log(`  Total del cliente: ${numero(r.total_impresiones)} páginas · a facturar $${Number(r.monto_total_general || 0).toFixed(2)}`);
  }
}

async function main() {
  const desde = validarPeriodo(valor('--desde', '2026-08'));
  const hasta = validarPeriodo(valor('--hasta', '2026-10'));
  const conErrores = !args.includes('--sin-errores');
  const escenario = escenarioDeArgs(args);

  titulo('PrintFlow · simulación del flujo de correo (n8n)');
  const totalMaquinas = escenario.clientes.reduce((s, c) => s + c.maquinas.length, 0);
  console.log(`API: ${API_URL} · meses: ${desde} a ${hasta}${conErrores ? ' · con casos de error el último mes' : ''}` +
    ` · ${escenario.clientes.length} clientes, ${totalMaquinas} máquinas`);
  const salud = await api('/health').catch(() => ({ status: 0 }));
  if (salud.status !== 200) throw new Error(`La API no responde en ${API_URL}/health. ¿Está arriba con docker compose up?`);
  const token = await iniciarSesion();
  const ids = await comprobarDatos(token, escenario);

  const meses = [];
  for (let p = desde; p <= hasta; p = sumarMeses(p, 1)) meses.push(p);

  for (const periodo of meses) {
    const ultimo = periodo === hasta;
    titulo(`Mes ${periodo}`);
    console.log('1) Las impresoras envían sus reportes al buzón');
    generarCorreos({ periodo, errores: conErrores && ultimo, escenario }).forEach((a) => console.log(`   ✉ ${a}`));

    console.log('\n2) n8n (simulado) lee el buzón y llama a la ingesta');
    await procesarBuzon();

    console.log('\n3) El operador revisa y aprueba los lotes del mes');
    await aprobarLotes(token, periodo);
  }

  titulo('4) Consolidado mensual (lo que se factura)');
  console.log('El consumo es la diferencia entre el contador de este mes y el del mes anterior.');
  console.log('Se factura por contrato: cuota fija de las páginas incluidas + excedente (+ renta). El monto por máquina es solo referencial.');
  for (const periodo of meses.slice(1)) await mostrarConsolidado(token, escenario, ids, periodo);
  if (meses.length < 2) console.log('Se necesitan al menos 2 meses para calcular consumos.');
  console.log('\nListo. Los correos quedaron en simulador/buzon/procesados y simulador/buzon/con-error.');
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
