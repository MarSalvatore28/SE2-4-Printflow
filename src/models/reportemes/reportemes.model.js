const pool = require('@config/db');
const { consumoDelCambio } = require('@utils/maquinasCambio.consumo');
const { consumoDeCuenta } = require('@utils/consumoPorCuenta');
const { calcularFacturacion } = require('@utils/facturacion');
const { sqlFechaEcuador } = require('@utils/fechaCorte');
const { tarifasDelReporte, preferirTarifas } = require('@utils/tarifasCongeladas');

const getPeriodoAnterior = (periodoActual) => {
  const [year, month] = periodoActual.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  const prevYear = date.getFullYear();
  const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${prevYear}-${prevMonth}`;
};

// Asignación de la máquina EN EL PERÍODO del reporte, no solo la vigente hoy: así un mes ya
// cerrado sigue mostrando su área y su forma de contar aunque después la máquina se haya
// retirado o reemplazado (caja 4). Prefiere la del cliente del reporte; si ninguna cubre el
// período, usa la vigente, como antes.
const INSTALACION_DEL_PERIODO = `
  LEFT JOIN LATERAL (
    SELECT i2.id_instalacion, i2.area_id, i2.contador_acumulativo, i2.contrato_id
    FROM instalaciones i2
    JOIN areas a2 ON a2.id_area = i2.area_id
    WHERE i2.maquina_id = ro.maquina_id
    ORDER BY
      (a2.cliente_id = ro.cliente_id) DESC NULLS LAST,
      (i2.fecha_instalacion < TO_DATE(ro.periodo || '-01', 'YYYY-MM-DD') + INTERVAL '1 month'
        AND (i2.fecha_retiro IS NULL OR i2.fecha_retiro >= TO_DATE(ro.periodo || '-01', 'YYYY-MM-DD'))) DESC NULLS LAST,
      (i2.activo AND i2.fecha_retiro IS NULL) DESC NULLS LAST,
      i2.fecha_instalacion DESC,
      i2.id_instalacion DESC
    LIMIT 1
  ) i ON TRUE`;

const getReporteConsolidado = async (clienteId, periodo, areaId = null, maquinaId = null) => {
  try {
    const periodoAnterior = getPeriodoAnterior(periodo);

    // Rendimiento (S4-05): los reportes del cliente y período se filtran en la misma consulta (índice
    // reportes_oficiales (cliente_id, periodo), migración 020) y la asignación del período se busca
    // una sola vez por reporte. Los detalles por usuario se suman solo para los reportes del
    // resultado (LATERAL), no para toda la tabla. Los resultados son los mismos de antes.
    const params = [clienteId, periodo, periodoAnterior];
    let paramCounter = 4;
    let filtros = '';

    if (areaId) {
      filtros += ` AND COALESCE(ro.snap_area_nombre, a.nombre) IN (SELECT nombre FROM areas WHERE id_area = $${paramCounter})`;
      params.push(areaId);
      paramCounter++;
    }
    if (maquinaId) {
      filtros += ` AND ro.maquina_id = $${paramCounter}`;
      params.push(maquinaId);
    }

    const queryText = `
      SELECT 
        ro.id_reporte,
        ro.maquina_id,
        ${sqlFechaEcuador('ro.fecha_corte')} as fecha_corte,
        -- Trazabilidad (S3-02): el lote que trajo la lectura y quién la aprobó
        ro.lote_origen_id,
        ro.usuario_validacion_id,
        ro.origen,
        ro.snap_maquina_serie as serie,
        COALESCE(mod.nombre, 'No disponible') as modelo,
        ro.snap_maquina_ip as ip,
        COALESCE(ro.snap_area_nombre, a.nombre, 'Sin Área') as area,
        
        -- FECHAS DE CORTE REALES, en hora de Ecuador con su desfase ('2026-10-31T23:00:00-05:00'):
        -- en UTC, un corte del 31 de octubre a las 23:00 se veía como del 1 de noviembre
        ${sqlFechaEcuador('ro.fecha_corte')} as fecha_corte_actual,
        ${sqlFechaEcuador('prev.fecha_corte')} as fecha_corte_anterior,
        
        -- FECHA CORTE ANTERIOR ESPECÍFICA DE LA MÁQUINA SALIENTE
        ${sqlFechaEcuador('prev_saliente.fecha_corte')} as saliente_ultimo_corte,

        -- Configuración Técnica
        i.contador_acumulativo,
        ro.es_maquina_reemplazo,
        m.tipo_impresion_id,
        ti.nombre as tipo_impresion_nombre,

        -- ========== CONTADORES REPORTADOS ACTUALES ==========
        COALESCE(ro.contador_impresiones_bn, 0) as cur_imp_bn,
        COALESCE(ro.contador_impresiones_color, 0) as cur_imp_col,
        COALESCE(ro.contador_copias_bn, 0) as cur_cop_bn,
        COALESCE(ro.contador_copias_color, 0) as cur_cop_col,
        COALESCE(ro.print_total, 0) as cur_print_total,
        COALESCE(ro.copy_total, 0) as cur_copy_total,
        COALESCE(ro.total_servicio, 0) as cur_total_servicio,

        -- ========== CONTADORES REPORTADOS ANTERIORES ==========
        COALESCE(prev.contador_impresiones_bn, 0) as prev_imp_bn,
        COALESCE(prev.contador_impresiones_color, 0) as prev_imp_col,
        COALESCE(prev.contador_copias_bn, 0) as prev_cop_bn,
        COALESCE(prev.contador_copias_color, 0) as prev_cop_col,
        COALESCE(prev.total_servicio, 0) as prev_total_servicio,

        -- ========== TARIFAS CONGELADAS AL APROBAR (snap_contrato_id en NULL = sin congelar) ==========
        ro.snap_contrato_id,
        ro.fecha_congelacion,
        ro.snap_costo_impresion_bn,
        ro.snap_costo_impresion_color,
        ro.snap_impresiones_bn_incluidas,
        ro.snap_impresiones_color_incluidas,
        ro.snap_costo_excedente_bn,
        ro.snap_costo_excedente_color,
        ro.snap_facturacion_de_impresora,

        -- ========== DATOS DEL CONTRATO ACTUAL (el de la asignación de la máquina en el período) ==========
        -- Solo se usan si el reporte no tiene tarifas congeladas
        i.contrato_id,
        c.impresiones_bn_incluidas,
        c.impresiones_color_incluidas,
        c.costo_impresion_bn AS costo_contrato_bn,
        c.costo_impresion_color AS costo_contrato_color,
        c.costo_x_excedente_impresion_bn,
        c.costo_x_excedente_impresion_color,
        c.facturacion_de_impresora,

        -- ========== SUMA DETALLES ACTUAL ==========
        det_cur.det_cur_imp_bn,
        det_cur.det_cur_imp_col,
        det_cur.det_cur_cop_bn,
        det_cur.det_cur_cop_col,

        -- ========== SUMA DETALLES ANTERIOR ==========
        det_prev_rel.det_prev_imp_bn,
        det_prev_rel.det_prev_imp_col,
        det_prev_rel.det_prev_cop_bn,
        det_prev_rel.det_prev_cop_col,
        
        -- ========== FLAGS DE CAMBIO ==========
        ro.maquina_cambio_id,
        ro.tiene_cambio_maquina,
        ro.es_parte_cambio,
        
        -- ========== DATOS COMPLETOS DEL CAMBIO ==========
        mc.id_maquina_cambio,
        mc.fecha_danio,
        mc.fecha_instalacion_entrante,
        mc.periodo_afectado,
        mc.tipo_cambio,
        mc.razon_cambio,
        mc.maquina_saliente_id,
        mc.maquina_entrante_id,
        
        -- SNAPSHOTS DE SERIES/MODELOS
        mc.snap_maquina_saliente_serie,
        mc.snap_maquina_saliente_modelo,
        mc.snap_maquina_entrante_serie,
        mc.snap_maquina_entrante_modelo,
        
        -- ========== CONTADORES SNAPSHOT SALIENTE ==========
        ccc_saliente.tipo_maquina as saliente_tipo,
        ccc_saliente.contador_actual_global as saliente_contador_final_snap, 
        ccc_saliente.contador_actual_imp_bn as saliente_imp_bn_final_snap,
        ccc_saliente.contador_actual_imp_col as saliente_imp_col_final_snap,
        
        -- ========== CONTADORES SNAPSHOT ENTRANTE ==========
        ccc_entrante.tipo_maquina as entrante_tipo,
        ccc_entrante.contador_actual_global as entrante_contador_inicial_snap,
        ccc_entrante.contador_actual_imp_bn as entrante_imp_bn_inicial_snap,
        ccc_entrante.contador_actual_imp_col as entrante_imp_col_inicial_snap,
        
        -- ========== ÚLTIMA LECTURA APROBADA DE LA SALIENTE (B/N y color, impresiones + copias) ==========
        COALESCE(prev_saliente.bn, 0) + COALESCE(prev_saliente.color, 0) as saliente_contador_inicio_real_global,
        COALESCE(prev_saliente.bn, 0) as saliente_imp_bn_inicio_real,
        COALESCE(prev_saliente.color, 0) as saliente_imp_col_inicio_real,

        -- ========== ÁREA DEL CAMBIO ==========
        area_cambio.nombre as cambio_area_nombre,
        
        -- ========== INSTALACIONES ==========
        inst_saliente.fecha_instalacion as saliente_fecha_instalacion,
        inst_saliente.fecha_retiro as saliente_fecha_retiro,
        inst_entrante.fecha_instalacion as entrante_fecha_instalacion

      FROM reportes_oficiales ro
      JOIN maquinas m ON ro.maquina_id = m.id_maquina
      LEFT JOIN tipos_impresion ti ON m.tipo_impresion_id = ti.id_tipo_impresion
      LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
      ${INSTALACION_DEL_PERIODO}
      LEFT JOIN areas a ON i.area_id = a.id_area

      -- Reporte Anterior (General)
      LEFT JOIN reportes_oficiales prev 
        ON ro.maquina_id = prev.maquina_id 
        AND prev.periodo = $3
        AND prev.cliente_id = $1
      
      -- Join Cambio
      LEFT JOIN maquinas_cambio mc 
        ON ro.maquina_cambio_id = mc.id_maquina_cambio

      -- Última lectura aprobada de la Saliente antes del período: de ahí parte su consumo
      LEFT JOIN LATERAL (
        SELECT ps.fecha_corte,
               COALESCE(dps.bn, COALESCE(ps.contador_impresiones_bn, 0) + COALESCE(ps.contador_copias_bn, 0)) AS bn,
               COALESCE(dps.color, COALESCE(ps.contador_impresiones_color, 0) + COALESCE(ps.contador_copias_color, 0)) AS color
        FROM reportes_oficiales ps
        LEFT JOIN LATERAL (
          SELECT SUM(d.cnt_impresion_bn + d.cnt_copia_bn) AS bn,
                 SUM(d.cnt_impresion_color + d.cnt_copia_color) AS color
          FROM reportes_detalle_oficial d
          WHERE d.reporte_oficial_id = ps.id_reporte
        ) dps ON TRUE
        WHERE ps.maquina_id = mc.maquina_saliente_id
          AND ps.cliente_id = $1
          AND ps.periodo < ro.periodo
        ORDER BY ps.periodo DESC, ps.id_reporte DESC
        LIMIT 1
      ) prev_saliente ON TRUE

      -- Contadores Snapshot
      LEFT JOIN cabecera_contadores_cambio ccc_saliente
        ON ccc_saliente.maquina_cambio_id = mc.id_maquina_cambio
        AND ccc_saliente.tipo_maquina = 'SALIENTE'
      
      LEFT JOIN cabecera_contadores_cambio ccc_entrante
        ON ccc_entrante.maquina_cambio_id = mc.id_maquina_cambio
        AND ccc_entrante.tipo_maquina = 'ENTRANTE'
      
      LEFT JOIN areas area_cambio
        ON mc.area_id = area_cambio.id_area

      LEFT JOIN contratos c
        ON c.id_contrato = i.contrato_id
      
      -- Las asignaciones que el registro del reemplazo retiró y creó
      LEFT JOIN instalaciones inst_saliente
        ON inst_saliente.id_instalacion = COALESCE(mc.instalacion_saliente_id, (
          SELECT id_instalacion
          FROM instalaciones
          WHERE maquina_id = mc.maquina_saliente_id
            AND fecha_retiro IS NOT NULL
          ORDER BY fecha_retiro DESC
          LIMIT 1
        ))

      LEFT JOIN instalaciones inst_entrante
        ON inst_entrante.id_instalacion = COALESCE(mc.instalacion_entrante_id, (
          SELECT id_instalacion
          FROM instalaciones
          WHERE maquina_id = mc.maquina_entrante_id
            AND activo = true
          ORDER BY fecha_instalacion ASC
          LIMIT 1
        ))
      
      -- DETALLES ACTUALES (sin detalle por usuario, las sumas quedan en NULL)
      LEFT JOIN LATERAL (
        SELECT SUM(d.cnt_impresion_bn) as det_cur_imp_bn,
               SUM(d.cnt_impresion_color) as det_cur_imp_col,
               SUM(d.cnt_copia_bn) as det_cur_cop_bn,
               SUM(d.cnt_copia_color) as det_cur_cop_col
        FROM reportes_detalle_oficial d
        WHERE d.reporte_oficial_id = ro.id_reporte
      ) det_cur ON TRUE

      -- DETALLES ANTERIORES
      LEFT JOIN LATERAL (
        SELECT SUM(d.cnt_impresion_bn) as det_prev_imp_bn,
               SUM(d.cnt_impresion_color) as det_prev_imp_col,
               SUM(d.cnt_copia_bn) as det_prev_cop_bn,
               SUM(d.cnt_copia_color) as det_prev_cop_col
        FROM reportes_detalle_oficial d
        WHERE d.reporte_oficial_id = prev.id_reporte
      ) det_prev_rel ON TRUE

      WHERE ro.cliente_id = $1
        AND ro.periodo = $2
        ${filtros}

      ORDER BY ro.id_reporte, ro.snap_maquina_ip ASC
    `;

    const { rows } = await pool.query(queryText, params);

    function calcularDiasOperacion(fechaInicio, fechaFin) {
      if (!fechaInicio || !fechaFin) return 0;
      const inicio = new Date(fechaInicio);
      const fin = new Date(fechaFin);
      inicio.setHours(0, 0, 0, 0);
      fin.setHours(0, 0, 0, 0);
      if (fin < inicio) return 0;
      const diffTime = fin.getTime() - inicio.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 0;
    }

    // Los reportes de un mismo reemplazo (caja 4) se agrupan: el consolidado muestra UNA fila por
    // cambio (la de la entrante, o la de la saliente si la entrante no reportó) con el consumo
    // de las dos máquinas. Los demás reportes se calculan como siempre.
    const filasPorCambio = new Map();
    rows.forEach((row) => {
      if (row.maquina_cambio_id === null) return;
      if (!filasPorCambio.has(row.maquina_cambio_id)) filasPorCambio.set(row.maquina_cambio_id, []);
      filasPorCambio.get(row.maquina_cambio_id).push(row);
    });
    const cambios = new Map([...filasPorCambio].map(([id, filas]) => [id, consumoDelCambio(filas)]));
    const filasVisibles = rows.filter((row) => row.maquina_cambio_id === null || cambios.get(row.maquina_cambio_id).filaRepresentante === row);

    const detalles = filasVisibles.map(row => {
      const tieneCambio = row.maquina_cambio_id !== null;
      const tieneDetalle = (row.det_cur_imp_bn !== null && row.det_cur_imp_bn !== undefined) ||
                           (row.det_cur_cop_bn !== null && row.det_cur_cop_bn !== undefined);

      const cambioCalculado = tieneCambio ? cambios.get(row.maquina_cambio_id) : null;
      const consumoFinal = cambioCalculado ? cambioCalculado.total : calcularConsumoNormal(row);

      // Cálculo referencial (solo informativo, por máquina), con las tarifas congeladas si las tiene
      const { contrato: tarifasFila } = tarifasDelReporte(row);
      const dineroReferencial = (consumoFinal.total_bn * parseFloat(tarifasFila.costo_impresion_bn || 0)) +
                                (consumoFinal.total_color * parseFloat(tarifasFila.costo_impresion_color || 0));
      const tipoNombre = row.tipo_impresion_nombre || 'BN';
      const esColor = tipoNombre !== 'BN';

      let fechaInicioSaliente, fechaFinSaliente, fechaInicioEntrante, fechaFinEntrante;

      if (tieneCambio) {
        if (row.saliente_ultimo_corte) {
          fechaInicioSaliente = row.saliente_ultimo_corte;
        } else {
          fechaInicioSaliente = row.saliente_fecha_instalacion;
        }
        fechaFinSaliente = row.fecha_danio;

        fechaInicioEntrante = row.fecha_instalacion_entrante;
        // Sin reporte de la entrante en el período, su tramo termina donde empieza
        const corteEntrante = cambioCalculado.filaEntrante ? cambioCalculado.filaEntrante.fecha_corte_actual : null;
        const dateCorte = new Date(corteEntrante);
        const dateInstalacion = new Date(fechaInicioEntrante);

        if (!corteEntrante || dateCorte < dateInstalacion) {
          fechaFinEntrante = fechaInicioEntrante;
        } else {
          fechaFinEntrante = corteEntrante;
        }
      }

      return {
        info: {
          id_reporte: row.id_reporte,
          maquina_id: row.maquina_id,
          modelo: row.modelo,
          serie: row.serie,
          ip: row.ip,
          area: row.area,
          es_acumulativo: row.contador_acumulativo,
          es_reemplazo: row.es_maquina_reemplazo,
          tipo_impresion: tipoNombre,
          es_color: esColor,
          fecha_corte_actual: row.fecha_corte_actual,
          fecha_corte_anterior: row.fecha_corte_anterior,
          tiene_cambio: tieneCambio,
          es_parte_cambio: row.es_parte_cambio || false,
          // Trazabilidad (S3-02)
          origen: row.origen,
          lote_origen_id: row.lote_origen_id,
          usuario_validacion_id: row.usuario_validacion_id
        },

        ...(tieneCambio && {
          cambio: {
            id: row.id_maquina_cambio,
            fecha: row.fecha_instalacion_entrante ? new Date(row.fecha_instalacion_entrante).toISOString() : new Date().toISOString(),
            fecha_danio: row.fecha_danio,
            fecha_instalacion_entrante: row.fecha_instalacion_entrante,
            periodo: row.periodo_afectado,
            tipo: row.tipo_cambio,
            razon: row.razon_cambio,
            area: row.cambio_area_nombre,

            maquina_saliente: {
              id: row.maquina_saliente_id,
              serie: row.snap_maquina_saliente_serie,
              modelo: row.snap_maquina_saliente_modelo,
              fecha_inicio_operacion: fechaInicioSaliente,
              fecha_fin_operacion: fechaFinSaliente,
              fecha_instalacion: row.saliente_fecha_instalacion,
              fecha_retiro: row.saliente_fecha_retiro,
              // B/N y color = impresiones + copias; global = B/N + color
              contadores: {
                anterior: {
                  global: cambioCalculado.saliente.anterior.bn + cambioCalculado.saliente.anterior.color,
                  impresion_bn: cambioCalculado.saliente.anterior.bn,
                  impresion_color: cambioCalculado.saliente.anterior.color
                },
                actual: {
                  global: cambioCalculado.saliente.actual.bn + cambioCalculado.saliente.actual.color,
                  impresion_bn: cambioCalculado.saliente.actual.bn,
                  impresion_color: cambioCalculado.saliente.actual.color
                },
                consumo: cambioCalculado.saliente.consumo
              }
            },

            maquina_entrante: {
              id: row.maquina_entrante_id,
              serie: row.snap_maquina_entrante_serie,
              modelo: row.snap_maquina_entrante_modelo,
              fecha_inicio_operacion: fechaInicioEntrante,
              fecha_fin_operacion: fechaFinEntrante,
              fecha_instalacion: row.entrante_fecha_instalacion,
              contadores: {
                anterior: {
                  global: cambioCalculado.entrante.anterior.bn + cambioCalculado.entrante.anterior.color,
                  impresion_bn: cambioCalculado.entrante.anterior.bn,
                  impresion_color: cambioCalculado.entrante.anterior.color
                },
                actual: {
                  global: cambioCalculado.entrante.actual.bn + cambioCalculado.entrante.actual.color,
                  impresion_bn: cambioCalculado.entrante.actual.bn,
                  impresion_color: cambioCalculado.entrante.actual.color
                },
                consumo: cambioCalculado.entrante.consumo
              }
            },

            totales: {
              dias_saliente: calcularDiasOperacion(fechaInicioSaliente, fechaFinSaliente),
              dias_entrante: calcularDiasOperacion(fechaInicioEntrante, fechaFinEntrante),
              consumo_total: consumoFinal.gran_total
            }
          }
        }),

        anterior: {
          imp_bn: tieneDetalle ? parseInt(row.det_prev_imp_bn || 0) : parseInt(row.prev_imp_bn),
          imp_color: tieneDetalle ? parseInt(row.det_prev_imp_col || 0) : parseInt(row.prev_imp_col),
          cop_bn: tieneDetalle ? parseInt(row.det_prev_cop_bn || 0) : parseInt(row.prev_cop_bn),
          cop_color: tieneDetalle ? parseInt(row.det_prev_cop_col || 0) : parseInt(row.prev_cop_col),
          total_contador_bn: tieneDetalle ? (parseInt(row.det_prev_imp_bn || 0) + parseInt(row.det_prev_cop_bn || 0)) : (parseInt(row.prev_imp_bn) + parseInt(row.prev_cop_bn)),
          total_contador_color: tieneDetalle ? (parseInt(row.det_prev_imp_col || 0) + parseInt(row.det_prev_cop_col || 0)) : (parseInt(row.prev_imp_col) + parseInt(row.prev_cop_col)),
          total_servicio: tieneDetalle ? (!row.contador_acumulativo ? 0 : (parseInt(row.det_prev_imp_bn || 0) + parseInt(row.det_prev_imp_col || 0) + parseInt(row.det_prev_cop_bn || 0) + parseInt(row.det_prev_cop_col || 0))) : parseInt(row.prev_total_servicio)
        },
        actual: {
          imp_bn: tieneDetalle ? parseInt(row.det_cur_imp_bn || 0) : parseInt(row.cur_imp_bn),
          imp_color: tieneDetalle ? parseInt(row.det_cur_imp_col || 0) : parseInt(row.cur_imp_col),
          cop_bn: tieneDetalle ? parseInt(row.det_cur_cop_bn || 0) : parseInt(row.cur_cop_bn),
          cop_color: tieneDetalle ? parseInt(row.det_cur_cop_col || 0) : parseInt(row.cur_cop_col),
          total_contador_bn: tieneDetalle ? (parseInt(row.det_cur_imp_bn || 0) + parseInt(row.det_cur_cop_bn || 0)) : (parseInt(row.cur_imp_bn) + parseInt(row.cur_cop_bn)),
          total_contador_color: tieneDetalle ? (parseInt(row.det_cur_imp_col || 0) + parseInt(row.det_cur_cop_col || 0)) : (parseInt(row.cur_imp_col) + parseInt(row.cur_cop_col)),
          print_total: tieneDetalle ? (parseInt(row.det_cur_imp_bn || 0) + parseInt(row.det_cur_imp_col || 0)) : parseInt(row.cur_print_total),
          copy_total: tieneDetalle ? (parseInt(row.det_cur_cop_bn || 0) + parseInt(row.det_cur_cop_col || 0)) : parseInt(row.cur_copy_total),
          total_servicio: tieneDetalle ? (parseInt(row.det_cur_imp_bn || 0) + parseInt(row.det_cur_imp_col || 0) + parseInt(row.det_cur_cop_bn || 0) + parseInt(row.det_cur_cop_col || 0)) : parseInt(row.cur_total_servicio)
        },
        consumo: consumoFinal,
        financiero: {
          // Consumo × tarifa por página: solo informativo. El importe oficial es resumen.facturacion.
          monto_total: dineroReferencial.toFixed(2),
          monto_referencial: dineroReferencial.toFixed(2)
        }
      };
    });

    function calcularConsumoNormal(row) {
      const tieneDetalle = (row.det_cur_imp_bn !== null && row.det_cur_imp_bn !== undefined) || 
                           (row.det_cur_cop_bn !== null && row.det_cur_cop_bn !== undefined);

      let consumo_bn, consumo_col;

      if (tieneDetalle) {
        const cur_det_bn = parseInt(row.det_cur_imp_bn || 0) + parseInt(row.det_cur_cop_bn || 0);
        const cur_det_col = parseInt(row.det_cur_imp_col || 0) + parseInt(row.det_cur_cop_col || 0);
        
        if (row.contador_acumulativo) {
          // 1. si tiene detalle por usuario y es acumulado -> Total actual - total anterior pero del total de detalles
          const prev_det_bn = parseInt(row.det_prev_imp_bn || 0) + parseInt(row.det_prev_cop_bn || 0);
          const prev_det_col = parseInt(row.det_prev_imp_col || 0) + parseInt(row.det_prev_cop_col || 0);
          
          consumo_bn = cur_det_bn - prev_det_bn;
          consumo_col = cur_det_col - prev_det_col;
          
          if (consumo_bn < 0) consumo_bn = cur_det_bn;
          if (consumo_col < 0) consumo_col = cur_det_col;
        } else {
          // 2. si tiene detalle por usuario y no es acumulativo -> solo se suma el Id o sea el total de detalle
          consumo_bn = cur_det_bn;
          consumo_col = cur_det_col;
        }
      } else {
        // 3. cuando no es por detalle de usuario o sea es por totales y ahi siempre es acumulativo
        const act_bn = parseInt(row.cur_imp_bn || 0) + parseInt(row.cur_cop_bn || 0);
        const act_col = parseInt(row.cur_imp_col || 0) + parseInt(row.cur_cop_col || 0);
        const ant_bn = parseInt(row.prev_imp_bn || 0) + parseInt(row.prev_cop_bn || 0);
        const ant_col = parseInt(row.prev_imp_col || 0) + parseInt(row.prev_cop_col || 0);

        consumo_bn = act_bn - ant_bn;
        consumo_col = act_col - ant_col;
        
        if (consumo_bn < 0) consumo_bn = act_bn;
        if (consumo_col < 0) consumo_col = act_col;
      }

      return {
        total_bn: consumo_bn,
        total_color: consumo_col,
        gran_total: consumo_bn + consumo_col
      };
    }

    const { rows: rentaRows } = await pool.query(`
    SELECT 
        i.id_instalacion,
        i.contrato_id,
        i.costo_renta_mensual,
        m.serie,
        mod.nombre as modelo_nombre,
        a.nombre as area_nombre
    FROM instalaciones i
    INNER JOIN maquinas m ON i.maquina_id = m.id_maquina
    LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo
    INNER JOIN areas a ON i.area_id = a.id_area
    WHERE a.cliente_id = $1
        AND i.costo_renta_mensual > 0
        AND TO_CHAR(i.fecha_instalacion, 'YYYY-MM') <= $2
        AND (i.fecha_retiro IS NULL OR TO_CHAR(i.fecha_retiro, 'YYYY-MM') >= $2)
        AND NOT EXISTS (
            SELECT 1 FROM maquinas_cambio mc 
            WHERE mc.maquina_saliente_id = i.maquina_id 
            AND mc.periodo_afectado = $2
            AND mc.activo = TRUE -- un reemplazo anulado no cambia la renta
        )
    ORDER BY mod.nombre ASC
`, [clienteId, periodo]);

    const rentaEquipos = rentaRows.map(r => ({
      id_instalacion: r.id_instalacion,
      contrato_id: r.contrato_id,
      serie: r.serie,
      modelo: r.modelo_nombre,
      area: r.area_nombre,
      costo_mensual: parseFloat(r.costo_renta_mensual)
    }));

    const totalRenta = rentaEquipos.reduce((acc, r) => acc + r.costo_mensual, 0);

    // --- FACTURACIÓN POR CONTRATO (S3-06): cuota fija + excedente + renta, por contrato y por mes ---
    // Se suma el consumo de todas las máquinas de cada contrato (detalles va en el mismo orden que filasVisibles).
    // Un mes ya aprobado se factura con las tarifas congeladas al aprobar (src/utils/tarifasCongeladas.js):
    // si después cambia el contrato, el importe de ese mes no cambia.
    const consumosPorContrato = new Map();
    filasVisibles.forEach((row, indice) => {
      const tarifas = tarifasDelReporte(row);
      if (!tarifas.contratoId) return;
      const acumulado = consumosPorContrato.get(tarifas.contratoId) || { bn: 0, color: 0, tarifas: null };
      acumulado.tarifas = preferirTarifas(acumulado.tarifas, tarifas);
      acumulado.bn += detalles[indice].consumo.total_bn;
      acumulado.color += detalles[indice].consumo.total_color;
      consumosPorContrato.set(tarifas.contratoId, acumulado);
    });

    const rentaDelContrato = (contratoId) => rentaEquipos
      .filter((r) => r.contrato_id === contratoId)
      .reduce((acc, r) => acc + r.costo_mensual, 0);

    const filtrado = Boolean(areaId || maquinaId);
    let facturacion = [...consumosPorContrato.entries()]
      .sort(([a], [b]) => a - b)
      .map(([contratoId, { bn, color, tarifas }]) => ({
        contrato_id: contratoId,
        ...calcularFacturacion(tarifas.contrato, { bn, color }, rentaDelContrato(contratoId), filtrado)
      }));

    // Con filtro por área o máquina, la facturación sigue siendo la del contrato completo (filtrado: true).
    if (filtrado) {
      const completo = await getReporteConsolidado(clienteId, periodo);
      facturacion = completo.resumen.facturacion.map((c) => ({ ...c, filtrado: true }));
    }

    const montoTotalGeneral = facturacion.reduce((acc, c) => acc + parseFloat(c.total), 0);

    const resumen = {
      total_bn: detalles.reduce((acc, d) => acc + d.consumo.total_bn, 0),
      total_color: detalles.reduce((acc, d) => acc + d.consumo.total_color, 0),
      total_impresiones: detalles.reduce((acc, d) => acc + d.consumo.gran_total, 0),
      facturacion,
      monto_total_general: montoTotalGeneral.toFixed(2),
      filtrado,
      total_maquinas: detalles.length,
      total_cambios: detalles.filter(d => d.info.tiene_cambio).length,
      periodo: periodo,
      cliente_id: clienteId,
      renta_equipos: rentaEquipos,
      total_renta: totalRenta,
      // La renta ya está dentro del total de cada contrato
      total_general: Math.round(montoTotalGeneral * 100) / 100
    };

    return { detalles, resumen };

  } catch (error) {
    console.error('❌ Error en getReporteConsolidado:', error);
    throw error;
  }
};

// Informe por usuario: lo que imprimió y copió cada cuenta EN EL PERÍODO. Las cuentas traen
// contadores acumulados, así que se resta su lectura del período anterior (consumoPorCuenta).
const getReporteDetallado = async (clienteId, periodo, areaId = null, maquinaId = null) => {
  try {
    let queryText = `
      SELECT
        -- DATOS DEL DETALLE (Hijo)
        rd.id_detalle,
        rd.fecha_transaccion,
        rd.cuenta_id,
        rd.usuario_trabajo,

        -- Lectura acumulada de la cuenta al corte del período
        rd.cnt_impresion_bn,
        rd.cnt_impresion_color,
        rd.cnt_copia_bn,
        rd.cnt_copia_color,

        -- Lectura de la misma cuenta y máquina en el período anterior (null si no hay)
        rd_prev.cnt_impresion_bn as prev_impresion_bn,
        rd_prev.cnt_impresion_color as prev_impresion_color,
        rd_prev.cnt_copia_bn as prev_copia_bn,
        rd_prev.cnt_copia_color as prev_copia_color,
        (rd_prev.id_detalle IS NOT NULL) as tiene_anterior,
        COALESCE(i.contador_acumulativo, false) as contador_acumulativo,

        rd.monto_detalle,

        -- DATOS DEL CONTEXTO (Padre - Reporte Oficial)
        ro.periodo,
        ro.snap_maquina_serie as serie,
        COALESCE(mod.nombre, 'No disponible') as modelo,
        ro.snap_maquina_ip as ip,

        COALESCE(ro.snap_costo_impresion_bn, 0) as costo_imp_bn,
        COALESCE(ro.snap_costo_impresion_color, 0) as costo_imp_col,

        -- Área: el snapshot histórico; si no lo tiene, la de la asignación del período
        COALESCE(ro.snap_area_nombre, a.nombre, 'Sin Área') as area

      FROM reportes_detalle_oficial rd

      -- UNIÓN CON EL PADRE (Necesaria para filtrar por Cliente y Periodo)
      JOIN reportes_oficiales ro ON rd.reporte_oficial_id = ro.id_reporte

      -- JOINS PARA OBTENER EL MODELO
      LEFT JOIN maquinas m ON ro.maquina_id = m.id_maquina
      LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo

      -- Asignación de la máquina en el período (área y forma de contar), como el consolidado
      ${INSTALACION_DEL_PERIODO}
      LEFT JOIN areas a ON i.area_id = a.id_area

      -- Última lectura de la misma cuenta en esa máquina y cliente en el período anterior
      LEFT JOIN LATERAL (
        SELECT d2.id_detalle, d2.cnt_impresion_bn, d2.cnt_impresion_color, d2.cnt_copia_bn, d2.cnt_copia_color
        FROM reportes_detalle_oficial d2
        JOIN reportes_oficiales r2 ON r2.id_reporte = d2.reporte_oficial_id
        WHERE r2.maquina_id = ro.maquina_id
          AND r2.cliente_id = ro.cliente_id
          AND r2.periodo = $3
          AND d2.cuenta_id IS NOT DISTINCT FROM rd.cuenta_id
        ORDER BY d2.fecha_transaccion DESC NULLS LAST, d2.id_detalle DESC
        LIMIT 1
      ) rd_prev ON TRUE

      WHERE ro.cliente_id = $1
        AND ro.periodo = $2
    `;

    const params = [clienteId, periodo, getPeriodoAnterior(periodo)];
    let paramCounter = 4;

    if (areaId) {
      queryText += ` AND a.id_area = $${paramCounter}`;
      params.push(areaId);
      paramCounter++;
    }
    if (maquinaId) {
      queryText += ` AND ro.maquina_id = $${paramCounter}`;
      params.push(maquinaId);
    }

    queryText += ` ORDER BY rd.fecha_transaccion DESC, rd.usuario_trabajo ASC`;

    const { rows } = await pool.query(queryText, params);

    const detalles = rows.map(row => {
      const lectura = {
        print_bn: row.cnt_impresion_bn,
        print_color: row.cnt_impresion_color,
        copia_bn: row.cnt_copia_bn,
        copia_color: row.cnt_copia_color
      };
      const anterior = row.tiene_anterior ? {
        print_bn: row.prev_impresion_bn,
        print_color: row.prev_impresion_color,
        copia_bn: row.prev_copia_bn,
        copia_color: row.prev_copia_color
      } : null;
      // contadores = consumo del período (lo que suman la pantalla, el Excel y el PDF)
      const consumo = consumoDeCuenta(lectura, anterior, row.contador_acumulativo);

      const montoImpBN = consumo.print_bn * parseFloat(row.costo_imp_bn || 0);
      const montoImpCol = consumo.print_color * parseFloat(row.costo_imp_col || 0);
      const montoCopBN = consumo.copia_bn * parseFloat(row.costo_imp_bn || 0);
      const montoCopCol = consumo.copia_color * parseFloat(row.costo_imp_col || 0);

      const montoTotalImpresiones = montoImpBN + montoImpCol;
      const montoTotalCopias = montoCopBN + montoCopCol;
      const montoTotal = montoTotalImpresiones + montoTotalCopias;

      return {
        id: row.id_detalle,
        transaccion: {
          fecha: row.fecha_transaccion,
        },
        usuario: {
          id: row.cuenta_id,
          nombre: row.usuario_trabajo || 'Desconocido'
        },
        maquina: {
          serie: row.serie,
          modelo: row.modelo,
          ip: row.ip,
          area: row.area
        },
        contadores: consumo,
        // Lecturas acumuladas de la cuenta, por si se quieren mostrar o auditar
        lectura: {
          actual: lectura,
          anterior,
          acumulativo: row.contador_acumulativo
        },
        totales: {
          bn: consumo.print_bn + consumo.copia_bn,
          color: consumo.print_color + consumo.copia_color,
          general: consumo.print_bn + consumo.print_color + consumo.copia_bn + consumo.copia_color
        },
        costos: {
          monto: parseFloat(montoTotal.toFixed(2)),
          impresion_bn: parseFloat(montoImpBN.toFixed(2)),
          impresion_color: parseFloat(montoImpCol.toFixed(2)),
          copia_bn: parseFloat(montoCopBN.toFixed(2)),
          copia_color: parseFloat(montoCopCol.toFixed(2)),
          total_impresiones: parseFloat(montoTotalImpresiones.toFixed(2)),
          total_copias: parseFloat(montoTotalCopias.toFixed(2)),
          costo_unit_imp_bn: parseFloat(row.costo_imp_bn || 0),
          costo_unit_imp_col: parseFloat(row.costo_imp_col || 0),
          costo_unit_cop_bn: parseFloat(row.costo_imp_bn || 0),
          costo_unit_cop_col: parseFloat(row.costo_imp_col || 0)
        }
      };
    });

    const resumen = {
      total_registros: detalles.length,
      suma_impresiones: detalles.reduce((acc, item) => acc + item.totales.general, 0),
      suma_monto: detalles.reduce((acc, item) => acc + item.costos.monto, 0),
      suma_monto_impresiones: detalles.reduce((acc, item) => acc + item.costos.total_impresiones, 0),
      suma_monto_copias: detalles.reduce((acc, item) => acc + item.costos.total_copias, 0),
      periodo: periodo,
      cliente_id: clienteId
    };

    return { detalles, resumen };

  } catch (error) {
    console.error('❌ Error en getReporteDetallado:', error);
    throw error;
  }
};

const getPeriodosDisponibles = async (clienteId) => {
  try {
    const queryText = `SELECT DISTINCT periodo FROM reportes_oficiales WHERE cliente_id = $1 ORDER BY periodo DESC`;
    const { rows } = await pool.query(queryText, [clienteId]);
    return rows.map(r => r.periodo);
  } catch (error) {
    console.error(error);
    return [];
  }
};

module.exports = {
  getReporteConsolidado,
  getReporteDetallado,
  getPeriodosDisponibles,
};