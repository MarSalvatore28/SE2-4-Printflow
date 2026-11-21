// S3-01 · Validación de lecturas de contadores (Equipo C · Samuel).
//
// CONTRATO COMPARTIDO. Lo usan:
//   - la ingesta del correo (Samuel la conecta al implementar S3-01),
//   - la lectura manual (S3-04),
//   - el reprocesar (S3-05).
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

const UMBRAL_POR_DEFECTO = 3;
const MESES_HISTORIAL = 6;

const num = (v) => Number(v ?? 0);
const fmt = (n) => num(n).toLocaleString('es-EC');

async function validarLectura(db, lectura) {
  const { maquinaId, periodo, contadorBn, contadorColor } = lectura;
  const bn = num(contadorBn);
  const color = num(contadorColor);

  // 1. DUPLICADA
  const dup = await db.query(
    'SELECT 1 FROM reportes_oficiales WHERE maquina_id = $1 AND periodo = $2 LIMIT 1',
    [maquinaId, periodo]
  );
  if (dup.rows.length > 0) {
    return {
      codigo: CODIGOS.DUPLICADA,
      motivo: `Lectura duplicada: la máquina ya tiene una lectura aprobada para ${periodo}`,
    };
  }

  // 2. Historial de lecturas aprobadas (la más nueva primero)
  const hist = await db.query(
    `SELECT periodo,
            COALESCE(contador_impresiones_bn, 0)    + COALESCE(contador_copias_bn, 0)    AS bn,
            COALESCE(contador_impresiones_color, 0) + COALESCE(contador_copias_color, 0) AS color
       FROM reportes_oficiales
      WHERE maquina_id = $1 AND periodo < $2
      ORDER BY periodo DESC
      LIMIT $3`,
    [maquinaId, periodo, MESES_HISTORIAL + 1]
  );
  let filas = hist.rows.map((r) => ({
    origen: `lectura de ${r.periodo}`,
    bn: num(r.bn),
    color: num(r.color),
  }));

  // 3. Sin historial: ¿es la máquina entrante de un reemplazo de este período?
  if (filas.length === 0) {
    const ini = await db.query(
      `SELECT c.contador_anterior_imp_bn  + c.contador_anterior_cop_bn  AS bn,
              c.contador_anterior_imp_col + c.contador_anterior_cop_col AS color
         FROM cabecera_contadores_cambio c
         JOIN maquinas_cambio mc ON mc.id_maquina_cambio = c.maquina_cambio_id
        WHERE c.maquina_id = $1
          AND c.tipo_maquina = 'ENTRANTE'
          AND mc.periodo_afectado = $2
          AND mc.activo = true
        LIMIT 1`,
      [maquinaId, periodo]
    );
    if (ini.rows.length === 0) return null; // primera lectura: nada con qué comparar
    filas = [{ origen: 'contador inicial del reemplazo', bn: num(ini.rows[0].bn), color: num(ini.rows[0].color) }];
  }

  const ultima = filas[0];

  // 4. RETROCESO
  if (bn < ultima.bn) {
    return {
      codigo: CODIGOS.RETROCESO,
      motivo: `Retroceso de contador: B/N ${fmt(bn)} < ${fmt(ultima.bn)} (${ultima.origen})`,
    };
  }
  if (color < ultima.color) {
    return {
      codigo: CODIGOS.RETROCESO,
      motivo: `Retroceso de contador: color ${fmt(color)} < ${fmt(ultima.color)} (${ultima.origen})`,
    };
  }

  // 5. SALTO_ANOMALO (necesita al menos 3 lecturas para tener 2 incrementos)
  if (filas.length >= 3) {
    const umbral = Number(process.env.UMBRAL_SALTO) || UMBRAL_POR_DEFECTO;
    const asc = [...filas].reverse();
    const incBn = [];
    const incColor = [];
    for (let i = 1; i < asc.length; i++) {
      incBn.push(asc[i].bn - asc[i - 1].bn);
      incColor.push(asc[i].color - asc[i - 1].color);
    }
    const prom = (a) => a.reduce((s, x) => s + x, 0) / a.length;

    const revisar = (nombre, nuevo, anterior, incrementos) => {
      const promedio = prom(incrementos);
      const incremento = nuevo - anterior;
      if (promedio > 0 && incremento > umbral * promedio) {
        return {
          codigo: CODIGOS.SALTO_ANOMALO,
          motivo: `Salto anómalo en ${nombre}: incremento de ${fmt(incremento)} páginas, supera ${umbral}× el promedio histórico (${fmt(Math.round(promedio))})`,
        };
      }
      return null;
    };
    const salto = revisar('B/N', bn, ultima.bn, incBn) || revisar('color', color, ultima.color, incColor);
    if (salto) return salto;
  }

  return null;
}

module.exports = { validarLectura, CODIGOS };
