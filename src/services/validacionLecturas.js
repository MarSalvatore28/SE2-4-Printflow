// S3-01 · Validación de lecturas de contadores (Equipo C · Samuel).
//
// CONTRATO COMPARTIDO. Lo usan:
//   - la ingesta del correo (Samuel la conecta al implementar S3-01),
//   - la lectura manual (S3-04, Roberto),
//   - el reprocesar (S3-05, Roberto).
// Hasta que Samuel lo implemente, ACEPTA TODAS las lecturas (devuelve null). Así cada uno puede
// programar y probar su parte sin esperar al otro. No cambiar la firma sin avisar a los tres.
//
// validarLectura(db, lectura) → Promise<null | { codigo, motivo }>
//   db       pool o client de pg (si hay una transacción abierta, pasar el client)
//   lectura  {
//     maquinaId:     number   id de la máquina
//     instalacionId: number?  asignación vigente (si se conoce)
//     periodo:       string   'YYYY-MM'
//     fecha:         string   'YYYY-MM-DD' (fecha de la lectura o de corte)
//     contadorBn:    number   total B/N acumulado (impresiones + copias), como contador_impresiones_bn
//     contadorColor: number   total color acumulado (impresiones + copias)
//   }
//   Devuelve null si la lectura es válida, o { codigo, motivo } con el primer problema encontrado:
//     RETROCESO       el contador es menor que la última lectura aprobada
//     SALTO_ANOMALO   el incremento supera UMBRAL_SALTO × el promedio histórico (UMBRAL_SALTO en .env, 3 por defecto)
//     DUPLICADA       ya hay una lectura de esa máquina para ese período
//   El motivo es un texto en español para mostrar tal cual («Retroceso de contador: …»).

const CODIGOS = Object.freeze({
  RETROCESO: 'RETROCESO',
  SALTO_ANOMALO: 'SALTO_ANOMALO',
  DUPLICADA: 'DUPLICADA',
});

// eslint-disable-next-line no-unused-vars
async function validarLectura(db, lectura) {
  return null; // TODO S3-01 (Samuel): implementar las 3 reglas
}

module.exports = { validarLectura, CODIGOS };
