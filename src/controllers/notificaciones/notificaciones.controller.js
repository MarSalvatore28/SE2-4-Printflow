const Notificaciones = require('@models/notificaciones/notificaciones.model');
const Staging = require('@models/reportemes_staging/reportemes_staging.model');
const { contextoAuditoria } = require('@services/auditoria');

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Entero positivo o null (evita que PostgreSQL responda 500 con "invalid input syntax")
const aEntero = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

// AAAA-MM-DD que existe en el calendario (2026-02-31 no)
const esFechaValida = (texto) => {
  if (!FECHA_REGEX.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
};

const error500 = (res, mensaje, err) => {
  console.error(`${mensaje}:`, err);
  return res.status(500).json({ success: false, message: mensaje });
};

// Avisa a las pantallas abiertas que cambió el estado de un lote o de las notificaciones.
// En las pruebas no hay Socket.IO: se ignora.
const avisarCambio = (datos) => {
  try {
    require('../../socket').getIO().emit('notificaciones_actualizadas', datos);
  } catch {
    // Socket.IO no inicializado
  }
};

// ----------------------------- Notificaciones -----------------------------

const listarController = async (req, res) => {
  try {
    let leida;
    if (req.query.leida === 'true') leida = true;
    else if (req.query.leida === 'false') leida = false;
    else if (req.query.leida !== undefined) {
      return res.status(400).json({ success: false, message: 'leida debe ser true o false' });
    }

    let limite;
    if (req.query.limite !== undefined) {
      limite = aEntero(req.query.limite);
      if (!limite || limite > 500) {
        return res.status(400).json({ success: false, message: 'limite debe ser un entero entre 1 y 500' });
      }
    }

    const data = await Notificaciones.listarNotificaciones({ leida, limite, usuarioId: req.user.id });
    res.json({ success: true, data, total: data.length });
  } catch (err) {
    error500(res, 'Error al obtener las notificaciones', err);
  }
};

const listarPorLecturaController = (leida) => async (req, res) => {
  try {
    const data = await Notificaciones.listarNotificaciones({ leida, usuarioId: req.user.id });
    res.json({ success: true, data, total: data.length });
  } catch (err) {
    error500(res, 'Error al obtener las notificaciones', err);
  }
};

const contarNoLeidasController = async (req, res) => {
  try {
    const total = await Notificaciones.contarNoLeidas(req.user.id);
    res.json({ success: true, data: total });
  } catch (err) {
    error500(res, 'Error al contar las notificaciones no leídas', err);
  }
};

const estadisticasController = async (req, res) => {
  try {
    const data = await Notificaciones.obtenerEstadisticas(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    error500(res, 'Error al obtener las estadísticas de notificaciones', err);
  }
};

const obtenerController = async (req, res) => {
  const id = aEntero(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID de notificación inválido' });
  try {
    const data = await Notificaciones.obtenerNotificacion(id, req.user.id);
    if (!data) return res.status(404).json({ success: false, message: 'Notificación no encontrada' });
    res.json({ success: true, data });
  } catch (err) {
    error500(res, 'Error al obtener la notificación', err);
  }
};

const listarPorLoteController = async (req, res) => {
  const loteId = aEntero(req.params.loteId);
  if (!loteId) return res.status(400).json({ success: false, message: 'ID de lote inválido' });
  try {
    const data = await Notificaciones.listarNotificacionesPorLote(loteId, req.user.id);
    res.json({ success: true, data, total: data.length });
  } catch (err) {
    error500(res, 'Error al obtener las notificaciones del lote', err);
  }
};

const crearController = async (req, res) => {
  const { titulo, mensaje, lote_id, tipo_codigo = 'LOTE_PENDIENTE', datos_adicionales } = req.body || {};

  if (typeof titulo !== 'string' || !titulo.trim()) {
    return res.status(400).json({ success: false, message: 'El título es obligatorio' });
  }
  if (titulo.trim().length > 200) {
    return res.status(400).json({ success: false, message: 'El título admite hasta 200 caracteres' });
  }
  if (mensaje !== undefined && mensaje !== null && typeof mensaje !== 'string') {
    return res.status(400).json({ success: false, message: 'El mensaje debe ser texto' });
  }
  if (datos_adicionales !== undefined && datos_adicionales !== null
    && (typeof datos_adicionales !== 'object' || Array.isArray(datos_adicionales))) {
    return res.status(400).json({ success: false, message: 'datos_adicionales debe ser un objeto' });
  }

  let loteId = null;
  if (lote_id !== undefined && lote_id !== null) {
    loteId = aEntero(lote_id);
    if (!loteId) return res.status(400).json({ success: false, message: 'lote_id inválido' });
  }

  try {
    const tipo = await Notificaciones.obtenerTipoPorCodigo(String(tipo_codigo));
    if (!tipo) return res.status(400).json({ success: false, message: `Tipo de notificación desconocido: ${tipo_codigo}` });

    if (loteId && !(await Notificaciones.obtenerLote(loteId))) {
      return res.status(400).json({ success: false, message: 'El lote indicado no existe' });
    }

    const id = await Notificaciones.crearNotificacion({
      titulo: titulo.trim(),
      mensaje,
      lote_id: loteId,
      tipo_notificacion_id: tipo.id_tipo_notificacion,
      datos_adicionales,
    });
    const data = await Notificaciones.obtenerNotificacion(id, req.user.id);
    res.status(201).json({ success: true, data, message: 'Notificación creada' });
  } catch (err) {
    error500(res, 'Error al crear la notificación', err);
  }
};

const marcarLeidaController = async (req, res) => {
  const id = aEntero(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID de notificación inválido' });
  try {
    const data = await Notificaciones.marcarLeida(id, req.user.id);
    if (!data) return res.status(404).json({ success: false, message: 'Notificación no encontrada' });
    avisarCambio({ id_notificacion: id });
    res.json({ success: true, data, message: 'Notificación marcada como leída' });
  } catch (err) {
    error500(res, 'Error al marcar la notificación como leída', err);
  }
};

const marcarVariasLeidasController = async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'Se requiere un arreglo ids con al menos un ID' });
  }
  const enteros = ids.map(aEntero);
  if (enteros.some((n) => n === null)) {
    return res.status(400).json({ success: false, message: 'Todos los ids deben ser enteros positivos' });
  }
  try {
    const actualizadas = await Notificaciones.marcarVariasLeidas([...new Set(enteros)], req.user.id);
    avisarCambio({ ids: enteros });
    res.json({ success: true, data: { actualizadas }, message: `${actualizadas} notificaciones marcadas como leídas` });
  } catch (err) {
    error500(res, 'Error al marcar las notificaciones como leídas', err);
  }
};

const marcarTodasLeidasController = async (req, res) => {
  try {
    const actualizadas = await Notificaciones.marcarTodasLeidas(req.user.id);
    avisarCambio({ todas: true });
    res.json({ success: true, data: { actualizadas }, message: `${actualizadas} notificaciones marcadas como leídas` });
  } catch (err) {
    error500(res, 'Error al marcar todas las notificaciones como leídas', err);
  }
};

const eliminarController = async (req, res) => {
  const id = aEntero(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID de notificación inválido' });
  try {
    const notificacion = await Notificaciones.obtenerNotificacion(id, req.user.id);
    if (!notificacion) return res.status(404).json({ success: false, message: 'Notificación no encontrada' });
    if (!notificacion.leida) {
      return res.status(409).json({ success: false, message: 'Solo se pueden eliminar notificaciones leídas' });
    }
    await Notificaciones.eliminarNotificacion(id);
    avisarCambio({ id_notificacion: id });
    res.json({ success: true, data: { id_notificacion: id }, message: 'Notificación eliminada' });
  } catch (err) {
    error500(res, 'Error al eliminar la notificación', err);
  }
};

const limpiarAntiguasController = async (req, res) => {
  const dias = req.query.dias === undefined ? 30 : aEntero(req.query.dias);
  if (!dias || dias > 3650) {
    return res.status(400).json({ success: false, message: 'dias debe ser un entero entre 1 y 3650' });
  }
  try {
    const eliminadas = await Notificaciones.eliminarLeidasAntiguas(dias);
    if (eliminadas > 0) avisarCambio({ limpieza: true });
    res.json({ success: true, data: { eliminadas }, message: `${eliminadas} notificaciones leídas de más de ${dias} días eliminadas` });
  } catch (err) {
    error500(res, 'Error al limpiar las notificaciones antiguas', err);
  }
};

// --------------------------------- Lotes ----------------------------------

const vieneValor = (valor) => valor !== undefined && valor !== '';

// Filtros de GET /api/notificaciones/lotes. Devuelve { error } (mensaje para el 400) o { filtros }.
const filtrosDeLotes = ({ estado, cliente_id, desde, hasta }) => {
  const filtros = {};

  if (vieneValor(estado)) {
    filtros.estado = String(estado).toUpperCase();
    if (!Notificaciones.ESTADOS_LOTE.includes(filtros.estado)) {
      return { error: `estado debe ser uno de: ${Notificaciones.ESTADOS_LOTE.join(', ')}` };
    }
  }
  if (vieneValor(cliente_id)) {
    filtros.clienteId = aEntero(cliente_id);
    if (!filtros.clienteId) return { error: 'cliente_id inválido' };
  }
  for (const [nombre, valor] of [['desde', desde], ['hasta', hasta]]) {
    if (!vieneValor(valor)) continue;
    if (!esFechaValida(String(valor))) return { error: `${nombre} debe tener el formato AAAA-MM-DD` };
    filtros[nombre] = String(valor);
  }
  if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) {
    return { error: 'La fecha desde no puede ser posterior a la fecha hasta' };
  }
  return { filtros };
};

const listarLotesController = async (req, res) => {
  const { error, filtros } = filtrosDeLotes(req.query);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const data = await Notificaciones.listarLotes(filtros);
    res.json({ success: true, data, total: data.length });
  } catch (err) {
    error500(res, 'Error al obtener los lotes', err);
  }
};

const obtenerLoteController = async (req, res) => {
  const loteId = aEntero(req.params.loteId);
  if (!loteId) return res.status(400).json({ success: false, message: 'ID de lote inválido' });
  try {
    const data = await Notificaciones.obtenerLote(loteId);
    if (!data) return res.status(404).json({ success: false, message: 'Lote no encontrado' });
    res.json({ success: true, data });
  } catch (err) {
    error500(res, 'Error al obtener el lote', err);
  }
};

// Aprueba el lote con la validación de staging. Responde 409 con `errores` si no se puede.
const aprobarLote = async (loteId, req, res) => {
  const { periodo, fecha_corte } = req.body || {};

  if (periodo !== undefined && periodo !== null && periodo !== '' && !PERIODO_REGEX.test(String(periodo))) {
    return res.status(400).json({ success: false, message: 'El período debe tener el formato AAAA-MM' });
  }

  const lote = await Notificaciones.obtenerLote(loteId);
  if (!lote) return res.status(404).json({ success: false, message: 'Lote no encontrado' });
  if (lote.estado === 'PROCESADO') {
    return res.status(409).json({ success: false, message: 'El lote ya fue aprobado', errores: ['El lote ya fue aprobado'] });
  }
  if (lote.estado === 'DESCARTADO') {
    return res.status(409).json({ success: false, message: 'El lote fue rechazado y no se puede aprobar', errores: ['El lote fue rechazado'] });
  }

  const validacion = await Staging.validarLoteStaging(loteId);
  if (!validacion.esValido) {
    return res.status(409).json({
      success: false,
      message: 'No se puede aprobar el lote porque la información está incompleta o inconsistente.',
      errores: validacion.errores,
    });
  }

  // Período: el que manda el usuario, si no el del lote, si no el mes de la fecha de corte
  let periodoFinal = periodo || lote.periodo || null;
  if (!periodoFinal && typeof fecha_corte === 'string' && PERIODO_REGEX.test(fecha_corte.slice(0, 7))) {
    periodoFinal = fecha_corte.slice(0, 7);
  }

  await Staging.approveStagingBatch(loteId, periodoFinal, req.user.id, req.ip);
  await Notificaciones.registrarAprobador(loteId, req.user.id);
  avisarCambio({ lote_id: loteId, estado: 'PROCESADO' });

  const data = await Notificaciones.obtenerLote(loteId);
  res.json({ success: true, data, message: 'Lote aprobado correctamente' });
};

const rechazarLote = async (loteId, req, res) => {
  const { motivo } = req.body || {};
  if (motivo !== undefined && motivo !== null && typeof motivo !== 'string') {
    return res.status(400).json({ success: false, message: 'El motivo debe ser texto' });
  }
  if (typeof motivo === 'string' && motivo.length > 500) {
    return res.status(400).json({ success: false, message: 'El motivo admite hasta 500 caracteres' });
  }

  const lote = await Notificaciones.obtenerLote(loteId);
  if (!lote) return res.status(404).json({ success: false, message: 'Lote no encontrado' });
  if (lote.estado === 'PROCESADO') {
    return res.status(409).json({ success: false, message: 'El lote ya fue aprobado y no se puede rechazar' });
  }
  if (lote.estado === 'DESCARTADO') {
    return res.status(409).json({ success: false, message: 'El lote ya fue rechazado' });
  }

  const motivoLimpio = typeof motivo === 'string' ? motivo.trim() : null;
  await Staging.rejectStagingBatch(loteId, { ...contextoAuditoria(req), motivo: motivoLimpio });
  await Notificaciones.registrarRechazo(
    loteId,
    req.user.id,
    motivoLimpio,
    (lote.clientes || []).map((c) => c.id_cliente)
  );
  avisarCambio({ lote_id: loteId, estado: 'DESCARTADO' });

  const data = await Notificaciones.obtenerLote(loteId);
  res.json({ success: true, data, message: 'Lote rechazado correctamente' });
};

const accionLotePorId = (accion, mensajeError) => async (req, res) => {
  const loteId = aEntero(req.params.loteId);
  if (!loteId) return res.status(400).json({ success: false, message: 'ID de lote inválido' });
  try {
    await accion(loteId, req, res);
  } catch (err) {
    error500(res, mensajeError, err);
  }
};

// Mismas acciones, pero a partir de la notificación del lote
const accionLotePorNotificacion = (accion, mensajeError) => async (req, res) => {
  const id = aEntero(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID de notificación inválido' });
  try {
    const notificacion = await Notificaciones.obtenerNotificacion(id, req.user.id);
    if (!notificacion) return res.status(404).json({ success: false, message: 'Notificación no encontrada' });
    if (!notificacion.lote_id) {
      return res.status(400).json({ success: false, message: 'La notificación no está asociada a un lote' });
    }
    await accion(notificacion.lote_id, req, res);
  } catch (err) {
    error500(res, mensajeError, err);
  }
};

module.exports = {
  listarController,
  listarNoLeidasController: listarPorLecturaController(false),
  listarLeidasController: listarPorLecturaController(true),
  contarNoLeidasController,
  estadisticasController,
  obtenerController,
  listarPorLoteController,
  crearController,
  marcarLeidaController,
  marcarVariasLeidasController,
  marcarTodasLeidasController,
  eliminarController,
  limpiarAntiguasController,
  listarLotesController,
  obtenerLoteController,
  aprobarLoteController: accionLotePorId(aprobarLote, 'Error al aprobar el lote'),
  rechazarLoteController: accionLotePorId(rechazarLote, 'Error al rechazar el lote'),
  aprobarPorNotificacionController: accionLotePorNotificacion(aprobarLote, 'Error al aprobar el lote'),
  rechazarPorNotificacionController: accionLotePorNotificacion(rechazarLote, 'Error al rechazar el lote'),
};
