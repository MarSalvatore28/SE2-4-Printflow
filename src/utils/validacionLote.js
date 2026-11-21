// Validación de un lote de staging antes de aprobarlo, por cada cliente del lote.
//
// Antes se tomaba el cliente del primer reporte (LIMIT 1): en un lote con reportes de dos
// clientes, las máquinas del segundo salían como «no asignadas a este cliente» y faltaban sus
// reportes en la cuenta. Ahora cada cliente se valida con sus propias máquinas y reportes.

/**
 * Agrupa los reportes del lote por cliente (cliente_id_tentativo).
 * Los reportes sin cliente (serie no registrada o sin asignación) van con el único cliente del
 * lote, como antes; si el lote tiene varios clientes, quedan aparte en `sinCliente`.
 * @returns {{ porCliente: Map<number, Object[]>, sinCliente: Object[] }}
 */
const agruparPorCliente = (reportes) => {
  const porCliente = new Map();
  const sinCliente = [];
  for (const r of reportes) {
    if (r.cliente_id_tentativo === null || r.cliente_id_tentativo === undefined) {
      sinCliente.push(r);
      continue;
    }
    const id = Number(r.cliente_id_tentativo);
    if (!porCliente.has(id)) porCliente.set(id, []);
    porCliente.get(id).push(r);
  }
  if (porCliente.size === 1 && sinCliente.length > 0) {
    porCliente.values().next().value.push(...sinCliente.splice(0));
  }
  return { porCliente, sinCliente };
};

// Motivo de una lectura bloqueada, con la máquina a la que corresponde: «Máquina SIMC0003: Retroceso
// de contador…». Si el aviso ya nombra la serie (p. ej. «la serie SIMX9999 no está registrada»), va tal cual.
const mensajeBloqueada = (stg) => {
  const serie = stg.serie_maquina;
  if (!stg.mensaje_aviso) return `La máquina ${serie} tiene un error de estado y sus lecturas fueron bloqueadas.`;
  if (!serie || stg.mensaje_aviso.includes(serie)) return stg.mensaje_aviso;
  return `Máquina ${serie}: ${stg.mensaje_aviso}`;
};

/**
 * Errores de un cliente: cantidad de reportes, máquinas no asignadas, IP distinta, lecturas
 * bloqueadas, reportes que faltan y contadores por usuario que no llegaron.
 * @param {Object[]} maquinasDB  asignaciones vigentes del cliente ({ serie, ip_address, contabilidad_por_usuario })
 * @param {Object[]} reportes    reportes del lote de ese cliente
 * @param {Set<number>} consolidadosConDetalle  ids de staging que trajeron contadores por usuario
 * @param {string} prefijo       'Cliente X: ' cuando el lote tiene varios clientes; '' si no
 */
const erroresDelCliente = (maquinasDB, reportes, consolidadosConDetalle, prefijo = '') => {
  const errores = [];

  if (maquinasDB.length !== reportes.length) {
    errores.push(`${prefijo}Cantidad inconsistente: El cliente tiene ${maquinasDB.length} máquinas instaladas, pero el lote trajo ${reportes.length} reportes.`);
  }

  reportes.forEach((stg) => {
    const maquinaBD = maquinasDB.find((m) => m.serie === stg.serie_maquina);
    if (!maquinaBD) {
      errores.push(`${prefijo}La máquina con Serie ${stg.serie_maquina} (IP: ${stg.ip_detectada}) reportada en el lote no está asignada a este cliente en el sistema.`);
    } else if (maquinaBD.ip_address !== stg.ip_detectada) {
      errores.push(`${prefijo}Discrepancia de IP en la máquina ${stg.serie_maquina}: El archivo indica ${stg.ip_detectada}, pero en el sistema está registrada con ${maquinaBD.ip_address}.`);
    }
    if (stg.procesar_lectura === false) errores.push(`${prefijo}${mensajeBloqueada(stg)}`);
  });

  maquinasDB.forEach((m) => {
    if (!reportes.some((stg) => stg.serie_maquina === m.serie)) {
      errores.push(`${prefijo}Falta el reporte de la máquina: Serie ${m.serie} (IP: ${m.ip_address}).`);
    }
  });

  maquinasDB
    .filter((m) => m.contabilidad_por_usuario === true)
    .forEach((m) => {
      const reporte = reportes.find((stg) => stg.serie_maquina === m.serie);
      if (reporte && reporte.procesar_lectura !== false && !consolidadosConDetalle.has(reporte.id_staging_consolidado)) {
        errores.push(`${prefijo}La máquina Serie ${m.serie} (IP: ${m.ip_address}) requiere contabilidad por usuario, pero no se reportaron los contadores de los usuarios.`);
      }
    });

  return errores;
};

// Reportes de un lote con varios clientes que no son de ninguno
const erroresSinCliente = (reportes) => reportes.flatMap((stg) => {
  const errores = [`La máquina con Serie ${stg.serie_maquina} (IP: ${stg.ip_detectada}) reportada en el lote no está asignada a ningún cliente en el sistema.`];
  if (stg.procesar_lectura === false) errores.push(mensajeBloqueada(stg));
  return errores;
});

// Cómo se nombra a un cliente en los errores de un lote con varios clientes: su nombre, o su RUC,
// nunca el id de la base. `cliente` es la fila de clientes ({ nombre, ruc }) o null si no está.
const nombreDelCliente = (cliente) => {
  const nombre = typeof cliente?.nombre === 'string' ? cliente.nombre.trim() : '';
  if (nombre) return nombre;
  const ruc = typeof cliente?.ruc === 'string' ? cliente.ruc.trim() : '';
  return ruc ? `con RUC ${ruc}` : 'sin nombre registrado';
};

module.exports = { agruparPorCliente, erroresDelCliente, erroresSinCliente, nombreDelCliente };
