// Caja 9, mejora 3.3 · ¿La máquina de un reporte está autorizada?
// Una serie que no está registrada, o que no tiene una asignación vigente (activa y sin fecha
// de retiro), deja el reporte en ERROR. La usan la ingesta del correo y el reprocesar (S3-05),
// para que las dos apliquen exactamente la misma regla.

// La serie tal como se compara: sin espacios a los lados y en mayúsculas
const normalizarSerie = (serie) => {
  const texto = serie === null || serie === undefined ? '' : String(serie).trim().toUpperCase();
  return texto || null;
};

/**
 * Busca la máquina por serie y su asignación vigente.
 * Devuelve { serie, maquinaId, clienteId, instalacionId }; los ids son null si no se encontró.
 *   db  pool o client de pg
 */
const buscarMaquinaPorSerie = async (db, serie) => {
  const serieLimpia = normalizarSerie(serie);
  const encontrada = { serie: serieLimpia, maquinaId: null, clienteId: null, instalacionId: null };
  if (!serieLimpia) return encontrada;

  const { rows } = await db.query(
    `SELECT m.id_maquina, a.cliente_id, i.id_instalacion
     FROM public.maquinas m
     LEFT JOIN public.instalaciones i
        ON m.id_maquina = i.maquina_id
        AND i.activo = true
        AND i.fecha_retiro IS NULL
     LEFT JOIN public.areas a
        ON i.area_id = a.id_area
     WHERE UPPER(TRIM(m.serie)) = $1 LIMIT 1`,
    [serieLimpia]
  );
  if (rows.length > 0) {
    encontrada.maquinaId = rows[0].id_maquina;
    encontrada.clienteId = rows[0].cliente_id || null;
    encontrada.instalacionId = rows[0].cliente_id ? rows[0].id_instalacion : null;
  }
  return encontrada;
};

const estaAutorizada = ({ maquinaId, clienteId }) => maquinaId !== null && clienteId !== null;

// Motivo para el mensaje_aviso del reporte, o null si la máquina está autorizada
const motivoNoAutorizada = (maquina) => {
  if (estaAutorizada(maquina)) return null;
  return maquina.maquinaId === null
    ? `Máquina no autorizada: la serie ${maquina.serie || '(vacía)'} no está registrada`
    : `Máquina no autorizada: la serie ${maquina.serie} no tiene una asignación vigente`;
};

module.exports = { normalizarSerie, buscarMaquinaPorSerie, estaAutorizada, motivoNoAutorizada };
