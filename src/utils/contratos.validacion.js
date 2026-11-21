// Reglas de los contratos: validación, modo de facturación y aviso de superposición.
// Funciones puras: no tocan la base de datos, así se prueban en test/contratos.test.js sin PostgreSQL.

const ENTERO_MAX = 2147483647; // columnas integer
const COSTO_MAX = 999999.9999; // contratos.costo_* es numeric(10,4)

// Los dos modos de facturación del contrato, escritos como los compara src/utils/facturacion.js
const FACTURACION = Object.freeze({
  TODO_COLOR: 'Todo como color',
  DIFERENCIAR: 'Diferenciar B/N de Color',
});

// «Todo como Color», «todo como color» o «TODO COMO COLOR» son el mismo modo.
// Devuelve el valor canónico o null si no es ninguno de los dos.
const normalizarFacturacion = (valor) => {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().replace(/\s+/g, ' ').toLowerCase();
  return Object.values(FACTURACION).find((modo) => modo.toLowerCase() === texto) || null;
};

const esTodoColor = (valor) => normalizarFacturacion(valor) === FACTURACION.TODO_COLOR;

// 'AAAA-MM-DD' de una fecha real (rechaza 2026-02-30), o null
const fechaIso = (valor) => {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [anio, mes, dia] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia ? texto : null;
};

// Fecha de una columna date leída con pg (Date en hora local del proceso) o texto, como 'AAAA-MM-DD'
const fechaDeColumna = (valor) => {
  if (valor instanceof Date) {
    const dosDigitos = (n) => String(n).padStart(2, '0');
    return `${valor.getFullYear()}-${dosDigitos(valor.getMonth() + 1)}-${dosDigitos(valor.getDate())}`;
  }
  return valor ? fechaIso(String(valor)) : null;
};

// Número del contrato: vacío = 0. Devuelve { valor } o { error }.
const numeroContrato = (valor, etiqueta, { entero = false, maximo } = {}) => {
  if (valor === undefined || valor === null || valor === '') return { valor: 0 };
  const n = typeof valor === 'string' ? Number(valor.trim()) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { error: `${etiqueta} debe ser un número` };
  if (n < 0) return { error: `${etiqueta} no puede ser negativo` };
  if (entero && !Number.isInteger(n)) return { error: `${etiqueta} debe ser un número entero` };
  if (n > maximo) return { error: `${etiqueta} no puede ser mayor que ${maximo}` };
  return { valor: n };
};

const booleano = (valor) => valor === true || valor === 'true' || valor === 1 || valor === '1';

// Primer valor definido entre los nombres que usa la API para un mismo dato
const primero = (body, ...claves) => {
  for (const clave of claves) if (body[clave] !== undefined) return body[clave];
  return undefined;
};

const CAMPOS_NUMERICOS = [
  ['impresiones_bn_incluidas', ['impresiones_bn_incluidas'], 'Las impresiones B/N incluidas', { entero: true, maximo: ENTERO_MAX }],
  ['impresiones_color_incluidas', ['impresiones_color_incluidas'], 'Las impresiones color incluidas', { entero: true, maximo: ENTERO_MAX }],
  ['costo_impresion_bn', ['costo_impresion_bn'], 'El costo por impresión B/N', { maximo: COSTO_MAX }],
  ['costo_impresion_color', ['costo_impresion_color'], 'El costo por impresión color', { maximo: COSTO_MAX }],
  ['costo_excedente_impresion_bn', ['costo_excedente_impresion_bn', 'costo_x_excedente_impresion_bn'], 'El costo por excedente B/N', { maximo: COSTO_MAX }],
  ['costo_excedente_impresion_color', ['costo_excedente_impresion_color', 'costo_x_excedente_impresion_color'], 'El costo por excedente color', { maximo: COSTO_MAX }],
];

/**
 * Contrato tal como está guardado (fila de contratos), con los nombres que acepta validarContrato.
 * Sirve de base al editar: lo que no viene en la petición conserva su valor.
 */
const contratoComoCuerpo = (fila) => ({
  fecha_inicio: fechaDeColumna(fila.fecha_inicio),
  fecha_fin: fechaDeColumna(fila.fecha_fin),
  impresiones_bn_incluidas: fila.impresiones_bn_incluidas,
  impresiones_color_incluidas: fila.impresiones_color_incluidas,
  costo_impresion_bn: fila.costo_impresion_bn,
  costo_impresion_color: fila.costo_impresion_color,
  costo_excedente_impresion_bn: fila.costo_x_excedente_impresion_bn,
  costo_excedente_impresion_color: fila.costo_x_excedente_impresion_color,
  renta_equipo: fila.renta_equipo,
  software_control: fila.software_control,
  facturacion_de_impresora: fila.facturacion_de_impresora,
});

/**
 * Valida y normaliza un contrato (POST /api/contratos o PUT /api/contratos/:id).
 * `base`: el contrato guardado, al editar; los campos que no vienen en `body` conservan su valor.
 * Acepta los nombres alternativos que manda la web (tiene_renta, tiene_software_control, printer_bill).
 * Devuelve { error } o { datos } con los nombres de las columnas que usa el modelo.
 */
const validarContrato = (body, base = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Faltan los datos del contrato' };
  const valor = (...claves) => {
    const enCuerpo = primero(body, ...claves);
    return enCuerpo === undefined ? primero(base, ...claves) : enCuerpo;
  };

  const inicioCrudo = valor('fecha_inicio');
  if (!inicioCrudo) return { error: 'Fecha de inicio es obligatoria' };
  const fechaInicio = fechaIso(String(inicioCrudo));
  if (!fechaInicio) return { error: 'La fecha de inicio no es válida' };

  const finCrudo = valor('fecha_fin');
  let fechaFin = null;
  if (finCrudo) {
    fechaFin = fechaIso(String(finCrudo));
    if (!fechaFin) return { error: 'La fecha fin no es válida' };
    if (fechaFin < fechaInicio) return { error: 'La fecha fin no puede ser anterior a la de inicio' };
  }

  const datos = { fecha_inicio: fechaInicio, fecha_fin: fechaFin };
  for (const [campo, claves, etiqueta, opciones] of CAMPOS_NUMERICOS) {
    const { error, valor: numero } = numeroContrato(valor(...claves), etiqueta, opciones);
    if (error) return { error };
    datos[campo] = numero;
  }
  if (!(datos.costo_impresion_bn > 0) && !(datos.costo_impresion_color > 0)) {
    return { error: 'Al menos un costo (B/N o color) debe ser mayor que 0' };
  }

  datos.renta_equipo = booleano(valor('renta_equipo', 'tiene_renta'));
  datos.software_control = booleano(valor('software_control', 'tiene_software_control'));

  const facturacion = valor('facturacion_de_impresora', 'printer_bill');
  if (facturacion === undefined || facturacion === null || facturacion === '') {
    datos.facturacion_de_impresora = FACTURACION.DIFERENCIAR;
  } else {
    datos.facturacion_de_impresora = normalizarFacturacion(facturacion);
    if (!datos.facturacion_de_impresora) {
      return { error: `La facturación debe ser «${FACTURACION.DIFERENCIAR}» o «${FACTURACION.TODO_COLOR}»` };
    }
  }

  return { datos };
};

// 'AAAA-MM-DD' → 'DD/MM/AAAA'
const fechaLegible = (valor) => {
  const iso = fechaDeColumna(valor);
  return iso ? iso.split('-').reverse().join('/') : '';
};

// Aviso cuando el contrato se cruza con otro activo del mismo cliente (sin mostrar ids)
const avisoSuperposicion = (otro) => {
  if (!otro) return undefined;
  const desde = fechaLegible(otro.fecha_inicio);
  const hasta = otro.fecha_fin ? ` al ${fechaLegible(otro.fecha_fin)}` : ' sin fecha de fin';
  return `Se superpone con el contrato vigente del ${desde}${hasta}`;
};

module.exports = {
  FACTURACION,
  normalizarFacturacion,
  esTodoColor,
  fechaIso,
  fechaDeColumna,
  contratoComoCuerpo,
  validarContrato,
  avisoSuperposicion,
};
