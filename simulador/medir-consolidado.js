// Mide cuánto tarda GET /api/reportes/consolidado/:clienteId/:periodo para cada cliente del
// escenario (S4-05). Requiere los datos cargados (preparar-datos.js) y los meses aprobados (demo.js).
//
//   node medir-consolidado.js --periodo 2026-10                    escenario normal
//   node medir-consolidado.js --maquinas 500 --periodo 2026-10     escenario grande
//   node medir-consolidado.js --maquinas 500 --repeticiones 5
//
// Muestra, por cliente, las máquinas del consolidado, el total a facturar y el tiempo (mediana de
// las repeticiones, después de una llamada de calentamiento). Al final: el cliente más grande, la
// suma de los 20 uno tras otro y los 20 a la vez.

const { validarPeriodo } = require('./lib/escenario');
const { escenarioDeArgs } = require('./lib/escenarioGrande');

const API_URL = process.env.API_URL || 'http://api:9000';
const USUARIO = process.env.DEMO_EMAIL || 'operador@printflow.local';
const CLAVE = process.env.DEMO_PASSWORD || 'Printflow2026*';
const LIMITE_MS = 5000;

const args = process.argv.slice(2);
const valor = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i === -1 ? porDefecto : args[i + 1];
};

async function api(ruta, token, opciones = {}) {
  const respuesta = await fetch(`${API_URL}${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: respuesta.status, datos: await respuesta.json().catch(() => ({})) };
}

async function cronometrar(ruta, token) {
  const inicio = process.hrtime.bigint();
  const r = await api(ruta, token);
  return { ...r, ms: Number(process.hrtime.bigint() - inicio) / 1e6 };
}

const mediana = (valores) => {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};
const ms = (n) => `${Math.round(n).toLocaleString('es-EC')} ms`;

async function main() {
  const periodo = validarPeriodo(valor('--periodo', '2026-10'));
  const repeticiones = Math.max(1, Number(valor('--repeticiones', 3)));
  const escenario = escenarioDeArgs(args);

  const login = await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ email: USUARIO, password: CLAVE }) });
  if (login.status !== 200) throw new Error(`No se pudo iniciar sesión como ${USUARIO} (HTTP ${login.status})`);
  const { token } = login.datos;

  const clientes = [];
  for (const c of escenario.clientes) {
    const { status, datos } = await api(`/api/clientes/ruc/${c.ruc}`, token);
    const id = (datos.data || datos)?.id_cliente;
    if (status !== 200 || !id) throw new Error(`No existe el cliente ${c.nombre}: carga primero los datos con preparar-datos.js`);
    clientes.push({ ...c, id, ruta: `/api/reportes/consolidado/${id}/${periodo}` });
  }

  console.log(`Consolidado ${periodo} · ${clientes.length} clientes · ${repeticiones} repeticiones por cliente\n`);
  console.log('Cliente                          Máquinas   A facturar     Tiempo (mediana)');
  const resultados = [];
  for (const c of clientes) {
    const calentamiento = await cronometrar(c.ruta, token);
    if (calentamiento.status !== 200) throw new Error(`${c.nombre}: HTTP ${calentamiento.status}`);
    const tiempos = [];
    for (let i = 0; i < repeticiones; i++) tiempos.push((await cronometrar(c.ruta, token)).ms);
    const r = { nombre: c.nombre, maquinas: calentamiento.datos.data.resumen.total_maquinas, total: calentamiento.datos.data.resumen.monto_total_general, ms: mediana(tiempos) };
    resultados.push(r);
    console.log(`${r.nombre.padEnd(32)} ${String(r.maquinas).padStart(8)}   $${r.total.padStart(10)}   ${ms(r.ms).padStart(10)}`);
  }

  const grande = resultados.reduce((a, b) => (b.maquinas > a.maquinas ? b : a));
  const secuencial = resultados.reduce((s, r) => s + r.ms, 0);
  const inicio = process.hrtime.bigint();
  const paralelo = await Promise.all(clientes.map((c) => api(c.ruta, token)));
  const msParalelo = Number(process.hrtime.bigint() - inicio) / 1e6;
  if (paralelo.some((r) => r.status !== 200)) throw new Error('Alguna llamada en paralelo falló');

  const veredicto = (n) => (n < LIMITE_MS ? 'cumple' : 'NO cumple');
  console.log(`\nCliente más grande (${grande.nombre}, ${grande.maquinas} máquinas): ${ms(grande.ms)} · ${veredicto(grande.ms)} < 5 s`);
  console.log(`Los ${clientes.length} clientes uno tras otro: ${ms(secuencial)} · ${veredicto(secuencial)} < 5 s`);
  console.log(`Los ${clientes.length} clientes a la vez: ${ms(msParalelo)} · ${veredicto(msParalelo)} < 5 s`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
