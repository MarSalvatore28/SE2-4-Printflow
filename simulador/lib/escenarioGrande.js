// Escenario grande para medir el rendimiento del consolidado (S4-05).
//
// Parte del escenario normal (Colegio Horizonte y Constructora Andina, sin cambios: sus totales
// siguen siendo los de la demo) y le agrega clientes ficticios hasta llegar a N máquinas entre
// M clientes. Todo es determinista: el mismo N y M dan siempre las mismas máquinas y contadores.
//
//   node preparar-datos.js --maquinas 500            (20 clientes por defecto)
//   node demo.js --maquinas 500 --desde 2026-01 --hasta 2026-10 --sin-errores
//   node generar-correos.js --periodo 2026-11 --maquinas 500 --clientes 20
//
// El primer cliente agregado («Cliente de carga 01») es el más grande: se lleva la quinta parte
// de las máquinas agregadas. El resto se reparte en partes iguales.

const path = require('node:path');
const { cargarEscenario, aleatorio } = require('./escenario');

const MODELOS = {
  'csv-cuentas': { modelo: 'Multifuncional láser color A4 (demo)', tipo: 'Color' },
  'texto-contadores': { modelo: 'Impresora láser B/N (demo)', tipo: 'BN' },
  'xml-estado': { modelo: 'Plotter color A0 (demo)', tipo: 'Color' },
};
const FORMATOS = Object.keys(MODELOS);
const AREAS = ['Administración', 'Operaciones', 'Ventas', 'Talento humano', 'Bodega'];
const CUENTAS = [
  { cuenta: '001', nombre: 'Administración', peso: 5 },
  { cuenta: '002', nombre: 'Gerencia', peso: 3 },
  { cuenta: '003', nombre: 'Asistencia', peso: 2 },
];

const dosDigitos = (n) => String(n).padStart(2, '0');
// Número entre min y max (incluidos), reproducible a partir de un texto
const entre = (texto, min, max) => min + Math.floor(aleatorio(texto) * (max - min + 1));
const redondear = (n, a) => Math.round(n / a) * a;

// Cuántas máquinas le tocan a cada cliente agregado: el primero, la quinta parte; el resto, igual
function repartirMaquinas(total, clientes) {
  if (clientes === 1) return [total];
  const grande = Math.max(1, Math.round(total / 5));
  const resto = total - grande;
  const base = Math.floor(resto / (clientes - 1));
  const sobrante = resto - base * (clientes - 1);
  return [grande, ...Array.from({ length: clientes - 1 }, (_, i) => base + (i < sobrante ? 1 : 0))];
}

function maquinaDeCarga(numero, cliente, indice) {
  const serie = `SIMG${String(numero).padStart(4, '0')}`;
  const formato = FORMATOS[numero % FORMATOS.length];
  const { modelo, tipo } = MODELOS[formato];
  const color = tipo !== 'BN';
  const bn = entre(`${serie}|bn`, 800, 6000);
  const col = color ? entre(`${serie}|color`, 100, 1500) : 0;
  const maquina = {
    serie,
    modelo,
    tipo,
    formato,
    area: AREAS[indice % AREAS.length],
    ip: `10.${100 + cliente}.${Math.floor(indice / 200)}.${10 + (indice % 200)}`,
    contador_inicial: {
      impresion_bn: entre(`${serie}|ini-bn`, 5000, 200000),
      impresion_color: color ? entre(`${serie}|ini-color`, 1000, 30000) : 0,
      copia_bn: formato === 'xml-estado' ? 0 : entre(`${serie}|ini-copia`, 1000, 40000),
      copia_color: formato === 'csv-cuentas' ? entre(`${serie}|ini-copia-color`, 100, 3000) : 0,
    },
    consumo_mensual: {
      impresion_bn: bn,
      impresion_color: col,
      copia_bn: formato === 'xml-estado' ? 0 : Math.round(bn / 4),
      copia_color: formato === 'csv-cuentas' ? Math.round(col / 6) : 0,
    },
  };
  if (formato === 'csv-cuentas') maquina.usuarios = CUENTAS;
  return maquina;
}

// Contrato con páginas incluidas parecidas al consumo promedio de sus máquinas, para que unos
// meses haya excedente y otros no
function contratoDeCarga(maquinas, k) {
  const bn = maquinas.reduce((s, m) => s + m.consumo_mensual.impresion_bn + m.consumo_mensual.copia_bn, 0);
  const color = maquinas.reduce((s, m) => s + m.consumo_mensual.impresion_color + m.consumo_mensual.copia_color, 0);
  return {
    fecha_inicio: '2026-01-01',
    fecha_fin: null,
    impresiones_bn_incluidas: redondear(bn, 1000),
    impresiones_color_incluidas: redondear(color, 100),
    costo_impresion_bn: 0.02,
    costo_impresion_color: 0.1,
    costo_excedente_impresion_bn: 0.025,
    costo_excedente_impresion_color: 0.12,
    facturacion_de_impresora: k % 4 === 0 ? 'Todo como color' : 'Diferenciar B/N de Color',
  };
}

function generarEscenarioGrande({ maquinas = 500, clientes = 20, base = cargarEscenario() } = {}) {
  const maquinasBase = base.clientes.reduce((s, c) => s + c.maquinas.length, 0);
  const agregar = { clientes: clientes - base.clientes.length, maquinas: maquinas - maquinasBase };
  if (!Number.isInteger(maquinas) || !Number.isInteger(clientes) || agregar.clientes < 1 || agregar.maquinas < agregar.clientes) {
    throw new Error(`El escenario grande necesita más de ${base.clientes.length} clientes y al menos una máquina nueva por cliente` +
      ` (el escenario normal ya trae ${maquinasBase} máquinas). Pediste ${maquinas} máquinas y ${clientes} clientes.`);
  }

  let numero = 0;
  const nuevos = repartirMaquinas(agregar.maquinas, agregar.clientes).map((cantidad, i) => {
    const k = i + 1;
    const codigo = `carga${dosDigitos(k)}`;
    const lista = Array.from({ length: cantidad }, (_, j) => maquinaDeCarga(++numero, k, j));
    return {
      codigo,
      nombre: `Cliente de carga ${dosDigitos(k)} (demo)`,
      ruc: `0990000${String(k).padStart(3, '0')}001`,
      razon_social: `Cliente de carga ${dosDigitos(k)} Demo S.A.`,
      remitente: `reportes@${codigo}.example`,
      contrato: contratoDeCarga(lista, k),
      areas: AREAS.slice(0, Math.min(AREAS.length, cantidad)),
      maquinas: lista,
    };
  });

  return { ...base, _nota_grande: `Escenario grande: ${maquinas} máquinas entre ${clientes} clientes (generado)`, clientes: [...base.clientes, ...nuevos] };
}

// Escenario según los argumentos: --maquinas N [--clientes M] genera el grande; --escenario <archivo>
// carga otro JSON; sin nada, el normal. SIM_MAQUINAS y SIM_CLIENTES hacen lo mismo por variable.
function escenarioDeArgs(args = process.argv.slice(2), env = process.env) {
  const valor = (nombre) => {
    const i = args.indexOf(nombre);
    return i === -1 ? undefined : args[i + 1];
  };
  const archivo = valor('--escenario');
  if (archivo) return cargarEscenario(path.resolve(archivo));
  const maquinas = valor('--maquinas') ?? env.SIM_MAQUINAS;
  if (!maquinas) return cargarEscenario();
  return generarEscenarioGrande({ maquinas: Number(maquinas), clientes: Number(valor('--clientes') ?? env.SIM_CLIENTES ?? 20) });
}

module.exports = { generarEscenarioGrande, escenarioDeArgs, repartirMaquinas };
