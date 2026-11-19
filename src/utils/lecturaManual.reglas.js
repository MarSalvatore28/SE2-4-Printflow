// S3-04 · Reglas de la lectura manual que no necesitan la base de datos.
// La asignación vigente y validarLectura (S3-01) se revisan en el modelo, dentro de la transacción.
const { parseId, parseContador, parseFecha, hoyEcuador } = require('@utils/maquinasCambio.reglas');

const OBSERVACION_MAX = 500;

const error = (status, message) => ({ error: { status, message } });

/**
 * Valida y normaliza el cuerpo de POST /api/lecturas/manual:
 *   { instalacion_id, fecha_lectura, contador_bn, contador_color, observacion }
 * Devuelve { error: { status, message } } o { data }.
 * `hoy` ('YYYY-MM-DD') se recibe para poder probar sin depender de la fecha real.
 */
const validarDatosLecturaManual = (body, hoy = hoyEcuador()) => {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const instalacionId = parseId(b.instalacion_id);
  if (!instalacionId) return error(400, 'Seleccione la asignación vigente de la máquina');

  const fecha = parseFecha(b.fecha_lectura);
  if (!fecha) return error(400, 'La fecha de lectura debe ser una fecha válida (AAAA-MM-DD)');
  if (fecha > hoy) return error(400, 'La fecha de lectura no puede ser posterior a hoy');

  const contadorBn = parseContador(b.contador_bn);
  if (contadorBn === null) return error(400, 'El contador B/N debe ser un número entero mayor o igual a 0');
  const contadorColor = parseContador(b.contador_color);
  if (contadorColor === null) return error(400, 'El contador de color debe ser un número entero mayor o igual a 0');

  const observacion = typeof b.observacion === 'string' ? b.observacion.trim() : '';
  if (!observacion) return error(400, 'La observación es obligatoria: indique por qué se registra la lectura a mano');
  if (observacion.length > OBSERVACION_MAX) {
    return error(400, `La observación no puede superar los ${OBSERVACION_MAX} caracteres`);
  }

  return {
    data: { instalacionId, fecha, periodo: fecha.slice(0, 7), contadorBn, contadorColor, observacion },
  };
};

/**
 * ¿La asignación (fila de instalaciones con su máquina) está vigente en la fecha de la lectura?
 * Devuelve null si lo está, o el motivo para responder 400.
 *   asignacion: { activo, fecha_instalacion, fecha_retiro, maquina_activa, serie } ('YYYY-MM-DD')
 */
const motivoAsignacionNoVigente = (asignacion, fecha) => {
  if (!asignacion) return 'La asignación no existe';
  if (!asignacion.activo || asignacion.fecha_retiro) {
    return `La asignación de la máquina ${asignacion.serie} ya no está vigente`
      + (asignacion.fecha_retiro ? `: se retiró el ${asignacion.fecha_retiro}` : '');
  }
  if (asignacion.maquina_activa === false) return `La máquina ${asignacion.serie} está inactiva`;
  if (asignacion.fecha_instalacion && fecha < asignacion.fecha_instalacion) {
    return `La asignación no estaba vigente el ${fecha}: la máquina ${asignacion.serie} se instaló el ${asignacion.fecha_instalacion}`;
  }
  return null;
};

module.exports = { OBSERVACION_MAX, validarDatosLecturaManual, motivoAsignacionNoVigente };
