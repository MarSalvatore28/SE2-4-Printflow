// Reglas del registro de un reemplazo de máquina que no necesitan la base de datos.
// Las que dependen de los datos guardados (asignación vigente, lecturas aprobadas,
// contrato vigente) están en el modelo, dentro de la transacción.

const INT_MAX = 2147483647;
const RAZON_MAX = 500;
const RAZON_MIN = 5;
const IP_MAX = 15; // instalaciones.ip_address es varchar(15)

const TIPOS_CAMBIO = Object.freeze([
  'Daño',
  'Falla recurrente',
  'Actualización de equipo',
  'Solicitud del cliente',
  'Otro',
]);

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const IPV4_REGEX = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// Entero positivo (id) o null
const parseId = (valor) => {
  if (typeof valor === 'number' && Number.isInteger(valor)) {
    return valor > 0 && valor <= INT_MAX ? valor : null;
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const n = Number(valor.trim());
    return n > 0 && n <= INT_MAX ? n : null;
  }
  return null;
};

// Contador: entero >= 0 (acepta número o texto con dígitos) o null
const parseContador = (valor) => {
  if (typeof valor === 'number' && Number.isInteger(valor)) {
    return valor >= 0 && valor <= INT_MAX ? valor : null;
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const n = Number(valor.trim());
    return n <= INT_MAX ? n : null;
  }
  return null;
};

// 'YYYY-MM-DD' que exista en el calendario, o null
const parseFecha = (valor) => {
  if (typeof valor !== 'string' || !FECHA_REGEX.test(valor.trim())) return null;
  const texto = valor.trim();
  const [anio, mes, dia] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const existe = fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
  return existe ? texto : null;
};

const esPeriodo = (valor) => typeof valor === 'string' && PERIODO_REGEX.test(valor);

const periodoDeFecha = (fecha) => fecha.slice(0, 7);

const periodoSiguiente = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, '0')}`;
};

// Fecha de hoy en Ecuador (America/Guayaquil, UTC-5 sin horario de verano) como 'YYYY-MM-DD'
const hoyEcuador = (ahora = new Date()) => new Date(ahora.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const error = (status, message) => ({ error: { status, message } });

/**
 * Valida y normaliza el cuerpo de POST /api/maquinas-cambio.
 * Devuelve { error: { status, message } } o { data }.
 * `hoy` ('YYYY-MM-DD') se recibe para poder probar sin depender de la fecha real.
 */
const validarDatosReemplazo = (body, hoy = hoyEcuador()) => {
  const b = body && typeof body === 'object' ? body : {};

  const salienteId = parseId(b.maquina_saliente_id);
  if (!salienteId) return error(400, 'Seleccione la máquina saliente');
  const entranteId = parseId(b.maquina_entrante_id);
  if (!entranteId) return error(400, 'Seleccione la máquina entrante');
  if (salienteId === entranteId) return error(400, 'La máquina entrante debe ser distinta de la saliente');

  const fechaDanio = parseFecha(b.fecha_danio);
  if (!fechaDanio) return error(400, 'La fecha del daño es obligatoria y debe tener el formato AAAA-MM-DD');
  const fechaInstalacion = parseFecha(b.fecha_instalacion_entrante);
  if (!fechaInstalacion) {
    return error(400, 'La fecha de instalación de la entrante es obligatoria y debe tener el formato AAAA-MM-DD');
  }
  if (fechaDanio > hoy) return error(400, 'La fecha del daño no puede ser futura');
  if (fechaInstalacion > hoy) return error(400, 'La fecha de instalación de la entrante no puede ser futura');
  if (fechaInstalacion < fechaDanio) {
    return error(400, 'La fecha de instalación de la entrante no puede ser anterior a la fecha del daño');
  }

  const periodo = typeof b.periodo_afectado === 'string' ? b.periodo_afectado.trim() : '';
  if (!esPeriodo(periodo)) return error(400, 'El período afectado debe tener el formato AAAA-MM');
  // El cambio se factura en el mes del daño o, si el daño fue después del corte, en el siguiente
  const mesDanio = periodoDeFecha(fechaDanio);
  if (periodo !== mesDanio && periodo !== periodoSiguiente(mesDanio)) {
    return error(400, `El período afectado debe ser el mes del daño (${mesDanio}) o el siguiente (${periodoSiguiente(mesDanio)})`);
  }
  // La entrante tiene que reportar en el período afectado: su lectura al corte completa el consumo
  if (periodoDeFecha(fechaInstalacion) > periodo) {
    return error(400, `La entrante debe instalarse dentro del período afectado (${periodo}) para que su lectura entre en ese consolidado`);
  }

  const tipo = typeof b.tipo_cambio === 'string' ? b.tipo_cambio.trim() : '';
  if (!TIPOS_CAMBIO.includes(tipo)) {
    return error(400, `Seleccione un tipo de cambio válido: ${TIPOS_CAMBIO.join(', ')}`);
  }

  const razon = typeof b.razon_cambio === 'string' ? b.razon_cambio.trim().replace(/\s+/g, ' ') : '';
  if (razon.length < RAZON_MIN) return error(400, `Describa la razón del cambio (mínimo ${RAZON_MIN} caracteres)`);
  if (razon.length > RAZON_MAX) return error(400, `La razón del cambio admite hasta ${RAZON_MAX} caracteres`);

  const contadores = {};
  const campos = [
    ['contador_final_saliente_bn', 'El contador final B/N de la saliente'],
    ['contador_final_saliente_color', 'El contador final color de la saliente'],
    ['contador_inicial_entrante_bn', 'El contador inicial B/N de la entrante'],
    ['contador_inicial_entrante_color', 'El contador inicial color de la entrante'],
  ];
  for (const [campo, nombre] of campos) {
    const valor = parseContador(b[campo]);
    if (valor === null) return error(400, `${nombre} es obligatorio y debe ser un número entero mayor o igual a 0`);
    contadores[campo] = valor;
  }

  // IP opcional: si no viene, la entrante usa la IP de la saliente
  let ip = null;
  if (b.ip_address !== undefined && b.ip_address !== null && String(b.ip_address).trim() !== '') {
    ip = String(b.ip_address).trim();
    if (ip.length > IP_MAX || !IPV4_REGEX.test(ip)) return error(400, 'La IP debe ser una dirección IPv4 válida (p. ej. 10.20.1.12)');
  }

  return {
    data: {
      maquina_saliente_id: salienteId,
      maquina_entrante_id: entranteId,
      fecha_danio: fechaDanio,
      fecha_instalacion_entrante: fechaInstalacion,
      periodo_afectado: periodo,
      tipo_cambio: tipo,
      razon_cambio: razon,
      ...contadores,
      ip_address: ip,
    },
  };
};

/**
 * Filtros de GET /api/maquinas-cambio (?cliente_id=&periodo=&maquina_id=&incluir_anulados=).
 * Devuelve { error } o { data }.
 */
const validarFiltrosListado = (query) => {
  const q = query && typeof query === 'object' ? query : {};
  const data = {};
  const vacio = (v) => v === undefined || v === null || String(v).trim() === '';

  if (!vacio(q.cliente_id)) {
    data.cliente_id = parseId(String(q.cliente_id));
    if (!data.cliente_id) return error(400, 'cliente_id inválido');
  }
  if (!vacio(q.maquina_id)) {
    data.maquina_id = parseId(String(q.maquina_id));
    if (!data.maquina_id) return error(400, 'maquina_id inválido');
  }
  if (!vacio(q.periodo)) {
    data.periodo = String(q.periodo).trim();
    if (!esPeriodo(data.periodo)) return error(400, 'El período debe tener el formato AAAA-MM');
  }
  // Los anulados no se listan salvo que se pidan (?incluir_anulados=true)
  if (!vacio(q.incluir_anulados)) {
    const valor = String(q.incluir_anulados).trim().toLowerCase();
    if (!['true', 'false', '1', '0'].includes(valor)) return error(400, 'incluir_anulados debe ser true o false');
    data.incluir_anulados = valor === 'true' || valor === '1';
  }
  return { data };
};

/**
 * Compara un contador ingresado con la última lectura aprobada de la máquina.
 * Un contador acumulado no puede bajar. Devuelve el mensaje de error o null.
 */
const contadorMenorQueLectura = (rotulo, serie, ingresado, lectura) => {
  if (!lectura) return null;
  if (ingresado.bn < lectura.bn) {
    return `${rotulo} B/N de ${serie} (${ingresado.bn}) es menor que su última lectura aprobada (${lectura.bn}, período ${lectura.periodo})`;
  }
  if (ingresado.color < lectura.color) {
    return `${rotulo} color de ${serie} (${ingresado.color}) es menor que su última lectura aprobada (${lectura.color}, período ${lectura.periodo})`;
  }
  return null;
};

/**
 * Cuerpo de POST /api/maquinas-cambio/:id/anular: { motivo? }. El motivo es opcional.
 * Devuelve { error } o { data: { motivo } } (motivo null si no viene).
 */
const validarDatosAnulacion = (body) => {
  const b = body && typeof body === 'object' ? body : {};
  if (b.motivo !== undefined && b.motivo !== null && typeof b.motivo !== 'string') {
    return error(400, 'El motivo de la anulación debe ser un texto');
  }
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim().replace(/\s+/g, ' ') : '';
  if (motivo.length > RAZON_MAX) return error(400, `El motivo de la anulación admite hasta ${RAZON_MAX} caracteres`);
  return { data: { motivo: motivo || null } };
};

/**
 * ¿Se puede anular el reemplazo? Recibe lo que el modelo leyó dentro de la transacción:
 *   cambio              fila de maquinas_cambio (null si no existe)
 *   lecturaAprobada     { serie, periodo } de una lectura aprobada que lo impide, o null:
 *                       un reporte oficial enlazado al cambio, o de cualquiera de las dos
 *                       máquinas en el período afectado o después
 *   lotePendiente       { serie, codigo } de un lote sin aprobar con lecturas de esas
 *                       máquinas desde el período afectado, o null
 *   asignacionEntrante  la asignación que el registro creó para la entrante, con `vigente`
 *                       (activa y sin retiro), o null si ya no existe
 *   asignacionSaliente  asignación vigente que la saliente tenga HOY (null si está libre)
 *   ipEnUso             serie de otra máquina que hoy usa la IP de la saliente, o null
 * Devuelve { status, message } o null si se puede anular.
 */
const motivoNoAnulable = ({ cambio, lecturaAprobada, lotePendiente, asignacionEntrante, asignacionSaliente, ipEnUso } = {}) => {
  if (!cambio) return { status: 404, message: 'Reemplazo no encontrado' };
  const n = `el reemplazo #${cambio.id_maquina_cambio}`;
  const sal = cambio.snap_maquina_saliente_serie;
  const ent = cambio.snap_maquina_entrante_serie;
  if (cambio.activo === false) return { status: 409, message: `El reemplazo #${cambio.id_maquina_cambio} ya está anulado` };
  if (lecturaAprobada) {
    return {
      status: 409,
      message: `No se puede anular ${n}: el período ${lecturaAprobada.periodo} ya tiene lecturas aprobadas de ${lecturaAprobada.serie}. Un período aprobado no se recalcula`,
    };
  }
  if (lotePendiente) {
    return {
      status: 409,
      message: `No se puede anular ${n}: el lote pendiente ${lotePendiente.codigo} trae lecturas de ${lotePendiente.serie}. Rechace ese lote, anule el reemplazo y vuelva a cargar el lote`,
    };
  }
  if (!cambio.instalacion_saliente_id) {
    return { status: 409, message: `No se puede anular ${n}: no guarda la asignación de ${sal} que retiró` };
  }
  if (!asignacionEntrante || !asignacionEntrante.vigente) {
    return {
      status: 409,
      message: `No se puede anular ${n}: la asignación de ${ent} que creó el reemplazo ya no está vigente (se retiró o se reemplazó después)`,
    };
  }
  if (asignacionSaliente) {
    return {
      status: 409,
      message: `No se puede anular ${n}: ${sal} ya está asignada de nuevo a ${asignacionSaliente.cliente_nombre} · ${asignacionSaliente.area_nombre}`,
    };
  }
  if (ipEnUso) {
    return { status: 409, message: `No se puede anular ${n}: la IP de ${sal} ya la usa la máquina ${ipEnUso}` };
  }
  return null;
};

/**
 * Observaciones de la asignación de la saliente sin la nota que agregó el registro del
 * reemplazo (`<antes> | RETIRO: reemplazo #N ...`), para que vuelva a quedar como estaba.
 */
const quitarNotaRetiro = (observaciones, cambioId) => {
  if (typeof observaciones !== 'string') return observaciones ?? null;
  const marca = `RETIRO: reemplazo #${cambioId} `;
  const i = observaciones.lastIndexOf(marca);
  if (i === -1) return observaciones;
  if (i === 0) return null;
  const separador = ' | ';
  return observaciones.slice(i - separador.length, i) === separador ? observaciones.slice(0, i - separador.length) : observaciones;
};

module.exports = {
  TIPOS_CAMBIO,
  validarDatosAnulacion,
  motivoNoAnulable,
  quitarNotaRetiro,
  parseId,
  parseContador,
  parseFecha,
  periodoSiguiente,
  hoyEcuador,
  validarDatosReemplazo,
  validarFiltrosListado,
  contadorMenorQueLectura,
};
