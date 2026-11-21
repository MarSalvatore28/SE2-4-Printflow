// Reglas de los clientes. Funciones puras: se prueban en test/clientes.test.js sin PostgreSQL.
const { normalizarTexto } = require('@utils/usuarios.validacion');

const NOMBRE_CLIENTE_MAX = 100; // clientes.nombre es varchar(100)
const RAZON_SOCIAL_MAX = 150; // clientes.razon_social es varchar(150)

// RUC de Ecuador: 13 dígitos, provincia 01 a 24 (o 30, extranjeros) y establecimiento 001.
const validarRuc = (valor) => {
  const ruc = typeof valor === 'string' ? valor.trim() : '';
  if (!ruc) return { error: 'El RUC es obligatorio' };
  if (!/^\d{13}$/.test(ruc)) return { error: 'El RUC debe tener 13 dígitos' };
  const provincia = Number(ruc.slice(0, 2));
  if (!((provincia >= 1 && provincia <= 24) || provincia === 30)) {
    return { error: 'Los dos primeros dígitos del RUC deben estar entre 01 y 24 (o ser 30)' };
  }
  if (!ruc.endsWith('001')) return { error: 'El RUC debe terminar en 001' };
  return { ruc };
};

/**
 * Valida el cuerpo de POST /api/clientes (esCreacion) o PUT /api/clientes/:id.
 * Al editar, los campos que no vienen no cambian. `activo` no se toca aquí: la baja y el alta
 * van por DELETE y PATCH /:id/activar, que hacen la cascada.
 * Devuelve { error } o { datos }.
 */
const validarCliente = (body, { esCreacion }) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Faltan los datos del cliente' };
  const datos = {};

  if (esCreacion || body.nombre !== undefined) {
    const nombre = normalizarTexto(body.nombre);
    if (!nombre) return { error: 'El nombre del cliente es obligatorio' };
    if (nombre.length > NOMBRE_CLIENTE_MAX) return { error: `El nombre no puede tener más de ${NOMBRE_CLIENTE_MAX} caracteres` };
    datos.nombre = nombre;
  }

  if (esCreacion || body.ruc !== undefined) {
    const { error, ruc } = validarRuc(body.ruc);
    if (error) return { error };
    datos.ruc = ruc;
  }

  if (body.razon_social !== undefined && body.razon_social !== null) {
    if (typeof body.razon_social !== 'string') return { error: 'La razón social debe ser texto' };
    const razon = normalizarTexto(body.razon_social);
    if (razon.length > RAZON_SOCIAL_MAX) return { error: `La razón social no puede tener más de ${RAZON_SOCIAL_MAX} caracteres` };
    // Vacía: al crear se usa el nombre; al editar queda vacía
    datos.razon_social = razon || (esCreacion ? datos.nombre : null);
  } else if (esCreacion) {
    datos.razon_social = datos.nombre;
  }

  if (!esCreacion && Object.keys(datos).length === 0) return { error: 'No hay datos del cliente para actualizar' };
  return { datos };
};

module.exports = { validarRuc, validarCliente };
