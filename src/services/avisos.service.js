// Aviso por correo al operador cuando llega un lote nuevo (S3-03).
// Lo dispara src/socket.js al recibir de PostgreSQL la notificación NUEVO_LOTE. El aviso llega
// después del commit de la ingesta, así que los reportes del lote ya están en staging.
const { enviarCorreo } = require('./correo.service');

// Sin las «/» del final. Sin regex: «una o más al final» retrocede de más
const APP_URL = () => {
  const url = process.env.APP_URL || 'http://localhost:8080';
  let fin = url.length;
  while (fin > 0 && url[fin - 1] === '/') fin -= 1;
  return url.slice(0, fin);
};

// Texto del correo a partir de los datos del lote (función pura, se prueba sin base de datos)
function armarAvisoLote({ codigo, periodo, clientes, reportes, errores }) {
  const conError = errores.length > 0;
  const cuantosConError = conError ? ` (${errores.length} con error)` : '';
  const asunto = `${conError ? '⚠ ' : ''}Nuevo lote de contadores: ${codigo}${cuantosConError}`;
  const lineas = [
    'Llegó un nuevo lote de reportes de contadores a PrintFlow.',
    '',
    `Lote:      ${codigo}`,
    `Período:   ${periodo || '—'}`,
    `Cliente:   ${clientes.length ? clientes.join(', ') : 'sin cliente identificado'}`,
    `Reportes:  ${reportes}`,
    '',
    ...(conError
      ? ['Reportes con error (el lote no se puede aprobar hasta resolverlos):', ...errores.map((e) => `  - ${e.serie}: ${e.motivo}`), '']
      : ['Todos los reportes están correctos: el lote está listo para revisar y aprobar.', '']),
    `Revíselo en: ${APP_URL()}/notificaciones`,
    '',
    'Este es un aviso automático de PrintFlow; no responda a este correo.',
  ];
  return { asunto, texto: lineas.join('\n') };
}

async function datosDelLote(db, loteId) {
  const { rows: [lote] } = await db.query(
    'SELECT id_lote, codigo_referencia, periodo FROM lotes_carga WHERE id_lote = $1', [loteId]);
  if (!lote) return null;
  const { rows } = await db.query(
    `SELECT s.serie_maquina, s.procesar_lectura, s.mensaje_aviso, c.nombre AS cliente
     FROM reportes_consolidado_staging s
     LEFT JOIN clientes c ON c.id_cliente = s.cliente_id_tentativo
     WHERE s.lote_id = $1 ORDER BY s.serie_maquina`, [loteId]);
  return {
    codigo: lote.codigo_referencia,
    periodo: lote.periodo,
    clientes: [...new Set(rows.map((r) => r.cliente).filter(Boolean))],
    reportes: rows.length,
    errores: rows.filter((r) => r.procesar_lectura === false)
      .map((r) => ({ serie: r.serie_maquina, motivo: r.mensaje_aviso || 'Error sin detalle' })),
  };
}

// Operadores y administradores activos: son los que revisan y aprueban lotes
async function destinatarios(db) {
  const { rows } = await db.query(
    `SELECT u.email FROM usuarios u JOIN roles r ON r.id_rol = u.rol_id
     WHERE u.activo = true AND r.nombre IN ('operador', 'admin') ORDER BY u.email`);
  return rows.map((r) => r.email);
}

// notificacion: la fila de «notificaciones» que llega por pg_notify
async function avisarSiEsLoteNuevo(db, notificacion) {
  try {
    if (!notificacion?.lote_id) return null;
    const { rows: [tipo] } = await db.query(
      'SELECT codigo FROM tipos_notificacion WHERE id_tipo_notificacion = $1', [notificacion.tipo_notificacion_id]);
    if (tipo?.codigo !== 'NUEVO_LOTE') return null;

    const datos = await datosDelLote(db, notificacion.lote_id);
    if (!datos) return null;
    const para = await destinatarios(db);
    const { asunto, texto } = armarAvisoLote(datos);
    const resultado = await enviarCorreo({ para, asunto, texto });
    if (resultado.enviado) console.log(`✉ Aviso de lote ${datos.codigo} enviado a ${para.length} destinatario(s) (${resultado.modo})`);
    return resultado;
  } catch (error) {
    console.error('No se pudo preparar el aviso por correo:', error.message);
    return { enviado: false, error: error.message };
  }
}

module.exports = { armarAvisoLote, avisarSiEsLoteNuevo };
