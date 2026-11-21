// Fechas de corte en hora de Ecuador (America/Guayaquil, UTC-5 todo el año: no hay horario de verano).
//
// Antes la ingesta guardaba el corte a medianoche UTC ('2026-10-31T00:00:00Z'), que en Ecuador es el
// 30 de octubre a las 19:00, y el consolidado devolvía las fechas en UTC: un corte del 31 de octubre a
// las 23:00 salía como '2026-11-01T04:00:00Z' y el informe decía «inicio del período 2026/11/01».
// Ahora cada fecha viaja con su desfase explícito (-05:00), así no depende de la zona de la base.

const ZONA = 'America/Guayaquil';
const DESFASE = '-05:00';
const DESFASE_MS = 5 * 60 * 60 * 1000;

const esFechaValida = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

// Día de Ecuador ('YYYY-MM-DD') de un instante
const diaEcuador = (fecha) => new Date(new Date(fecha).getTime() - DESFASE_MS).toISOString().slice(0, 10);

// 'YYYY-MM-DD...', 'DD/MM/YYYY' o 'DD-MM-YYYY' → 'YYYY-MM-DD'. Otra cosa que entienda Date → su día en Ecuador.
const extraerFecha = (valor) => {
  if (!valor) return null;
  const s = String(valor).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    // Con hora y zona ('2026-10-31T23:00:00Z'), el día es el de Ecuador; sin zona, el escrito
    if (/[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return diaEcuador(s);
    const fecha = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return esFechaValida(fecha) ? fecha : null;
  }
  const partes = s.split(/[/-]/);
  if (partes.length === 3 && partes[2].length === 4) {
    const fecha = `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
    return esFechaValida(fecha) ? fecha : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : diaEcuador(d);
};

// 'H:MM', 'HH:MM' o 'HH:MM:SS' → 'HH:MM:SS'; cualquier otra cosa → null
const normalizarHora = (valor) => {
  if (valor === undefined || valor === null) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(valor).trim());
  if (!m) return null;
  const [h, min, seg = '00'] = [Number(m[1]), m[2], m[3]];
  if (h > 23 || Number(min) > 59 || Number(seg) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}:${seg}`;
};

// Instante en hora de Ecuador con su desfase: '2026-10-31T23:00:00-05:00'
const instanteEcuador = (fecha, hora = '12:00:00') => `${fecha}T${hora}${DESFASE}`;

/**
 * Fecha de corte de un reporte de la ingesta.
 * - Si los detalles traen fecha (y hora), el corte es la transacción más reciente, en hora de Ecuador.
 * - Si no hay hora, el mediodía de Ecuador de ese día (igual que la lectura manual): así ningún
 *   cambio de zona lo pasa al día anterior o al siguiente.
 * - Sin detalles con fecha, el día de `fecha_carga` del lote, o el de hoy en Ecuador.
 * @returns {{ fechaCorte: string, fechaLectura: string }} fechaCorte 'YYYY-MM-DD'; fechaLectura con desfase
 */
const fechaCorteDelReporte = (detalles, fechaCarga, ahora = new Date()) => {
  let mejor = null;
  for (const d of detalles || []) {
    const fecha = extraerFecha(d?.fecha_transaccion);
    if (!fecha) continue;
    const hora = normalizarHora(d.hora_transaccion);
    const clave = `${fecha}T${hora || '00:00:00'}`;
    if (!mejor || clave > mejor.clave) mejor = { clave, fecha, hora };
  }
  if (mejor) return { fechaCorte: mejor.fecha, fechaLectura: instanteEcuador(mejor.fecha, mejor.hora || undefined) };

  const fecha = extraerFecha(fechaCarga) || diaEcuador(ahora);
  return { fechaCorte: fecha, fechaLectura: instanteEcuador(fecha) };
};

// Fecha de lectura de un detalle (cuenta) en hora de Ecuador; null si no trae fecha
const fechaLecturaDelDetalle = (detalle) => {
  const fecha = extraerFecha(detalle?.fecha_transaccion);
  if (!fecha) return null;
  return instanteEcuador(fecha, normalizarHora(detalle.hora_transaccion) || '00:00:00');
};

// SQL: una columna timestamptz como texto en hora de Ecuador con su desfase
// ('2026-10-31T23:00:00-05:00'). Así el día que se ve (los primeros 10 caracteres) es el de Ecuador.
const sqlFechaEcuador = (columna) =>
  `(TO_CHAR(${columna} AT TIME ZONE '${ZONA}', 'YYYY-MM-DD"T"HH24:MI:SS') || '${DESFASE}')`;

// SQL: el día de Ecuador de una columna timestamptz ('YYYY-MM-DD')
const sqlDiaEcuador = (columna) => `TO_CHAR(${columna} AT TIME ZONE '${ZONA}', 'YYYY-MM-DD')`;

module.exports = {
  ZONA,
  extraerFecha,
  normalizarHora,
  diaEcuador,
  instanteEcuador,
  fechaCorteDelReporte,
  fechaLecturaDelDetalle,
  sqlFechaEcuador,
  sqlDiaEcuador,
};
