// Reglas de las áreas. Funciones puras: se prueban en test/areas.test.js sin PostgreSQL.
const { normalizarTexto, parseId } = require('@utils/usuarios.validacion');

const NOMBRE_AREA_MAX = 100; // areas.nombre es varchar(100)

/**
 * Valida el cuerpo de POST /api/areas (esCreacion) o PUT /api/areas/:id.
 * Al editar, lo que no viene conserva su valor. `activo` no se toca aquí (DELETE y PATCH /:id/activar).
 * Devuelve { error } o { datos: { cliente_id?, nombre?, descripcion? } }.
 */
const validarArea = (body, { esCreacion }) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Faltan los datos del área' };
  const datos = {};

  if (esCreacion || body.cliente_id !== undefined) {
    const clienteId = parseId(body.cliente_id);
    if (!clienteId) return { error: 'Seleccione un cliente válido' };
    datos.cliente_id = clienteId;
  }

  if (esCreacion || body.nombre !== undefined) {
    const nombre = normalizarTexto(body.nombre);
    if (!nombre) return { error: 'El nombre del área es obligatorio' };
    if (nombre.length > NOMBRE_AREA_MAX) return { error: `El nombre no puede tener más de ${NOMBRE_AREA_MAX} caracteres` };
    datos.nombre = nombre;
  }

  if (body.descripcion !== undefined) {
    if (body.descripcion !== null && typeof body.descripcion !== 'string') return { error: 'La descripción debe ser texto' };
    datos.descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() || null : null;
  }

  if (!esCreacion && Object.keys(datos).length === 0) return { error: 'No hay datos del área para actualizar' };
  return { datos };
};

module.exports = { validarArea };
