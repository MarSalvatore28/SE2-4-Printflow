// Reglas de las asignaciones (instalaciones) que no necesitan la base de datos: formato de
// los ids, la IP, las fechas, la renta y la forma de contar. Las que dependen de los datos
// guardados (máquina libre, área del cliente del contrato, contrato vigente, IP en uso,
// lecturas aprobadas) están en el modelo, dentro de la transacción.
const { parseId, parseFecha, hoyEcuador } = require('@utils/maquinasCambio.reglas');

const OBSERVACIONES_MAX = 500;
const RENTA_MAX = 99999999.99; // instalaciones.costo_renta_mensual es numeric(10,2)

const error = (status, message) => ({ error: { status, message } });
const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * IPv4 en su forma normal: «010.020.001.011» → «10.20.1.11». null si no es una IPv4 válida.
 * Se guarda así para que la misma IP escrita de dos maneras cuente como repetida.
 */
const normalizarIp = (valor) => {
  if (typeof valor !== 'string') return null;
  const partes = valor.trim().split('.');
  if (partes.length !== 4 || !partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return partes.map(Number).join('.');
};

const MSG_IP = 'La IP debe ser una dirección IPv4 válida (p. ej. 10.20.1.12)';

// La fecha (opcional) como 'YYYY-MM-DD', que exista y no sea futura
const validarFecha = (valor, nombre, hoy) => {
  if (vacio(valor)) return { fecha: null };
  const fecha = parseFecha(valor);
  if (!fecha) return error(400, `La fecha de ${nombre} debe ser una fecha válida (AAAA-MM-DD)`);
  if (fecha > hoy) return error(400, `La fecha de ${nombre} no puede ser futura`);
  return { fecha };
};

// Renta mensual (opcional): número de 0 a 99.999.999,99, con hasta dos decimales
const validarRenta = (valor) => {
  if (vacio(valor)) return { renta: 0 };
  const n = typeof valor === 'string' ? Number(valor.trim()) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > RENTA_MAX) {
    return error(400, 'El costo de renta mensual debe ser un número mayor o igual a 0');
  }
  return { renta: Math.round(n * 100) / 100 };
};

// true / false (opcional): si no viene, el valor por defecto
const validarBooleano = (valor, nombre, porDefecto) => {
  if (valor === undefined || valor === null) return { valor: porDefecto };
  if (typeof valor !== 'boolean') return error(400, `${nombre} debe ser true o false`);
  return { valor };
};

const validarObservaciones = (valor) => {
  if (vacio(valor)) return { observaciones: null };
  if (typeof valor !== 'string') return error(400, 'Las observaciones deben ser un texto');
  const texto = valor.trim();
  if (texto.length > OBSERVACIONES_MAX) return error(400, `Las observaciones admiten hasta ${OBSERVACIONES_MAX} caracteres`);
  return { observaciones: texto };
};

// IP, renta y forma de contar: lo que comparten el alta y la edición
const validarDatosComunes = (b, hoy) => {
  if (vacio(b.ip_address)) return error(400, 'La dirección IP es obligatoria');
  const ip = normalizarIp(b.ip_address);
  if (!ip) return error(400, MSG_IP);

  const fecha = validarFecha(b.fecha_instalacion, 'instalación', hoy);
  if (fecha.error) return fecha;
  const renta = validarRenta(b.costo_renta_mensual);
  if (renta.error) return renta;
  const acumulativo = validarBooleano(b.contador_acumulativo, 'El contador acumulativo', true);
  if (acumulativo.error) return acumulativo;
  const contabilidad = validarBooleano(b.contabilidad_por_usuario, 'La contabilidad por usuario', false);
  if (contabilidad.error) return contabilidad;

  return {
    data: {
      ip_address: ip,
      fecha_instalacion: fecha.fecha,
      costo_renta_mensual: renta.renta,
      contador_acumulativo: acumulativo.valor,
      contabilidad_por_usuario: contabilidad.valor,
    },
  };
};

const cuerpo = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * Cuerpo de POST /api/instalacion. Devuelve { error: { status, message } } o { data }.
 * `hoy` ('YYYY-MM-DD') se recibe para poder probar sin depender de la fecha real.
 */
const validarDatosInstalacion = (body, hoy = hoyEcuador()) => {
  const b = cuerpo(body);
  const maquinaId = parseId(b.maquina_id);
  if (!maquinaId) return error(400, 'Seleccione la máquina');
  const areaId = parseId(b.area_id);
  if (!areaId) return error(400, 'Seleccione el área');
  const contratoId = parseId(b.contrato_id);
  if (!contratoId) return error(400, 'Seleccione el contrato');

  const comunes = validarDatosComunes(b, hoy);
  if (comunes.error) return comunes;
  const obs = validarObservaciones(b.observaciones);
  if (obs.error) return obs;

  return {
    data: { maquina_id: maquinaId, area_id: areaId, contrato_id: contratoId, ...comunes.data, observaciones: obs.observaciones },
  };
};

/** Cuerpo de PATCH /api/instalacion/:id (IP, fecha, renta y forma de contar). */
const validarDatosEdicionInstalacion = (body, hoy = hoyEcuador()) => validarDatosComunes(cuerpo(body), hoy);

/** Cuerpo de PATCH /api/instalacion/:id/retirar: { fecha_retiro?, observaciones_retiro? } */
const validarDatosRetiro = (body, hoy = hoyEcuador()) => {
  const b = cuerpo(body);
  const fecha = validarFecha(b.fecha_retiro, 'retiro', hoy);
  if (fecha.error) return fecha;
  const obs = validarObservaciones(b.observaciones_retiro);
  if (obs.error) return obs;
  return { data: { fecha_retiro: fecha.fecha, observaciones_retiro: obs.observaciones } };
};

module.exports = {
  OBSERVACIONES_MAX,
  normalizarIp,
  validarDatosInstalacion,
  validarDatosEdicionInstalacion,
  validarDatosRetiro,
};
