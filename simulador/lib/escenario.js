// Escenario de la demo y cálculo de contadores.
// Los contadores son ACUMULADOS (como los de una impresora real) y deterministas:
// generar dos veces el mismo período da exactamente los mismos números.
const fs = require('node:fs');
const path = require('node:path');

const CAMPOS = ['impresion_bn', 'impresion_color', 'copia_bn', 'copia_color'];

function cargarEscenario(ruta = path.join(__dirname, '..', 'escenario.json')) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

// --- Períodos 'YYYY-MM' ---

function validarPeriodo(periodo) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo || '')) {
    throw new Error(`Período inválido: "${periodo}". Usa el formato YYYY-MM, por ejemplo 2026-10.`);
  }
  return periodo;
}

const indiceMes = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return anio * 12 + (mes - 1);
};

const periodoDesdeIndice = (indice) =>
  `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`;

const sumarMeses = (periodo, n) => periodoDesdeIndice(indiceMes(periodo) + n);

// Último día del mes a las 23:00: la hora a la que el equipo "envía" su reporte
function fechaCorte(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 0, 23, 0, 0));
}

// --- Números pseudoaleatorios reproducibles ---

function semilla(texto) {
  let h = 2166136261;
  for (const c of texto) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

function aleatorio(texto) {
  let t = (semilla(texto) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Contadores acumulados de una máquina al cierre del período.
// Cada mes consume entre el 85 % y el 115 % de su consumo promedio.
function contadoresAlCierre(maquina, periodo, periodoBase) {
  const meses = indiceMes(periodo) - indiceMes(periodoBase);
  if (meses < 0) {
    throw new Error(`El período ${periodo} es anterior al inicio del escenario (${periodoBase}).`);
  }
  const resultado = {};
  for (const campo of CAMPOS) {
    let valor = maquina.contador_inicial[campo] || 0;
    const promedio = maquina.consumo_mensual[campo] || 0;
    for (let m = 1; m <= meses; m++) {
      const factor = 0.85 + 0.3 * aleatorio(`${maquina.serie}|${campo}|${m}`);
      valor += Math.round(promedio * factor);
    }
    resultado[campo] = valor;
  }
  return resultado;
}

// Reparte los contadores de la máquina entre sus cuentas según su peso.
// La suma de las cuentas es exactamente el total de la máquina.
function repartirPorUsuario(contadores, usuarios) {
  const pesoTotal = usuarios.reduce((s, u) => s + u.peso, 0);
  const filas = usuarios.map((u) => ({ cuenta: u.cuenta, nombre: u.nombre }));
  for (const campo of CAMPOS) {
    let asignado = 0;
    filas.forEach((fila, i) => {
      const esUltima = i === filas.length - 1;
      const valor = esUltima
        ? contadores[campo] - asignado
        : Math.floor((contadores[campo] * usuarios[i].peso) / pesoTotal);
      fila[campo] = valor;
      asignado += valor;
    });
  }
  return filas;
}

// --- Reemplazos de máquina (escenario.reemplazos, opcionales) ---

// Total B/N y total color (impresiones + copias): lo que se anota al registrar el reemplazo
const totalesBnColor = (c) => ({
  bn: (c.impresion_bn || 0) + (c.copia_bn || 0),
  color: (c.impresion_color || 0) + (c.copia_color || 0),
});

// Máquinas que reportan en el correo del cliente ese mes. Con reemplazos, desde su período la
// entrante toma el lugar de la saliente (misma área e IP, salvo que traiga la suya) y sus
// contadores parten de su contador_inicial: el primer mes suma un consumo mensual completo.
function maquinasDelPeriodo(cliente, periodo, escenario, { reemplazos = false } = {}) {
  if (!reemplazos) return cliente.maquinas;
  let maquinas = cliente.maquinas;
  for (const r of escenario.reemplazos || []) {
    const i = maquinas.findIndex((m) => m.serie === r.saliente);
    if (i === -1 || indiceMes(periodo) < indiceMes(r.periodo)) continue;
    const saliente = maquinas[i];
    const entrante = {
      area: saliente.area,
      ip: saliente.ip,
      ...r.entrante,
      periodo_base: sumarMeses(r.periodo, -1),
    };
    maquinas = [...maquinas.slice(0, i), entrante, ...maquinas.slice(i + 1)];
  }
  return maquinas;
}

module.exports = {
  CAMPOS,
  totalesBnColor,
  maquinasDelPeriodo,
  cargarEscenario,
  validarPeriodo,
  sumarMeses,
  fechaCorte,
  contadoresAlCierre,
  repartirPorUsuario,
  aleatorio,
};
