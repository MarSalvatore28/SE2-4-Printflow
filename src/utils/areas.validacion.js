// Reglas de las áreas. Funciones puras: se prueban en test/areas.test.js sin PostgreSQL.
const { normalizarTexto, parseId } = require('@utils/usuarios.validacion');

const NOMBRE_AREA_MAX = 100; // areas.nombre es varchar(100)

const esObjeto = (body) => Boolean(body) && typeof body === 'object' && !Array.isArray(body);

// Cada campo devuelve { error } o { valor }
const validarClienteId = (valor) => {
  const clienteId = parseId(valor);
  return clienteId ? { valor: clienteId } : { error: 'Seleccione un cliente válido' };
};

const validarNombre = (valor) => {
  const nombre = normalizarTexto(valor);
  if (!nombre) return { error: 'El nombre del área es obligatorio' };
  if (nombre.length > NOMBRE_AREA_MAX) return { error: `El nombre no puede tener más de ${NOMBRE_AREA_MAX} caracteres` };
  return { valor: nombre };
};

const validarDescripcion = (valor) => {
  if (valor === null) return { valor: null };
  if (typeof valor !== 'string') return { error: 'La descripción debe ser texto' };
  return { valor: valor.trim() || null };
};

/**
 * Valida el cuerpo de POST /api/areas (esCreacion) o PUT /api/areas/:id.
 * Al editar, lo que no viene conserva su valor. `activo` no se toca aquí (DELETE y PATCH /:id/activar).
 * Devuelve { error } o { datos: { cliente_id?, nombre?, descripcion? } }.
 */
const validarArea = (body, { esCreacion }) => {
  if (!esObjeto(body)) return { error: 'Faltan los datos del área' };

  // [campo, validación, ¿obligatorio al crear?]
  const campos = [
    ['cliente_id', validarClienteId, true],
    ['nombre', validarNombre, true],
    ['descripcion', validarDescripcion, false],
  ];
  const datos = {};
  for (const [campo, validar, obligatorio] of campos) {
    if (body[campo] === undefined && !(esCreacion && obligatorio)) continue;
    const { error, valor } = validar(body[campo]);
    if (error) return { error };
    datos[campo] = valor;
  }

  if (!esCreacion && Object.keys(datos).length === 0) return { error: 'No hay datos del área para actualizar' };
  return { datos };
};

module.exports = { validarArea };
