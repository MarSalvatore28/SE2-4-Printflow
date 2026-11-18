const pool = require('@config/db');

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
    SELECT i2.id_instalacion, i2.area_id, i2.contador_acumulativo
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

    let queryText = `
      WITH unique_reports AS (
        SELECT DISTINCT ro.id_reporte
        FROM reportes_oficiales ro
        ${INSTALACION_DEL_PERIODO}
        LEFT JOIN areas a ON i.area_id = a.id_area
        
        WHERE ro.cliente_id = $1
          AND ro.periodo = $2
    `;

    let params = [clienteId, periodo, periodoAnterior];
    let paramCounter = 4;

    if (areaId) {
      queryText += ` AND COALESCE(ro.snap_area_nombre, a.nombre) IN (SELECT nombre FROM areas WHERE id_area = $${paramCounter})`;
      params.push(areaId);
      paramCounter++;
    }
    if (maquinaId) {
      queryText += ` AND ro.maquina_id = $${paramCounter}`;
      params.push(maquinaId);
    }

    queryText += `
      )
      SELECT 
        ro.id_reporte,
        ro.maquina_id,
        ro.fecha_corte,
        ro.snap_maquina_serie as serie,
        COALESCE(mod.nombre, 'No disponible') as modelo,
        ro.snap_maquina_ip as ip,
        COALESCE(ro.snap_area_nombre, a.nombre, 'Sin Área') as area,
        
        -- FECHAS DE CORTE REALES
        ro.fecha_corte as fecha_corte_actual,
        prev.fecha_corte as fecha_corte_anterior,
        
        -- FECHA CORTE ANTERIOR ESPECÍFICA DE LA MÁQUINA SALIENTE
        prev_saliente.fecha_corte as saliente_ultimo_corte,

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

        -- ========== COSTOS ==========
        ro.snap_costo_impresion_bn,
        ro.snap_costo_impresion_color,
        
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
        
        -- ========== CONTADORES REPORTADOS ANTERIORES DE LA MÁQUINA SALIENTE ==========
        COALESCE(prev_saliente.total_servicio, 0) as saliente_contador_inicio_real_global,
        COALESCE(prev_saliente.contador_impresiones_bn, 0) as saliente_imp_bn_inicio_real,
        COALESCE(prev_saliente.contador_impresiones_color, 0) as saliente_imp_col_inicio_real,

        -- ========== ÁREA DEL CAMBIO ==========
        area_cambio.nombre as cambio_area_nombre,
        
        -- ========== INSTALACIONES ==========
        inst_saliente.fecha_instalacion as saliente_fecha_instalacion,
        inst_saliente.fecha_retiro as saliente_fecha_retiro,
        inst_entrante.fecha_instalacion as entrante_fecha_instalacion

      FROM unique_reports ur
      JOIN reportes_oficiales ro ON ro.id_reporte = ur.id_reporte
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

      -- Reporte Anterior ESPECÍFICO de la Saliente
      LEFT JOIN reportes_oficiales prev_saliente
        ON prev_saliente.maquina_id = mc.maquina_saliente_id
        AND prev_saliente.periodo = $3
        AND prev_saliente.cliente_id = $1
      
      -- Contadores Snapshot
      LEFT JOIN cabecera_contadores_cambio ccc_saliente
        ON ccc_saliente.maquina_cambio_id = mc.id_maquina_cambio
        AND ccc_saliente.tipo_maquina = 'SALIENTE'
      
      LEFT JOIN cabecera_contadores_cambio ccc_entrante
        ON ccc_entrante.maquina_cambio_id = mc.id_maquina_cambio
        AND ccc_entrante.tipo_maquina = 'ENTRANTE'
      
      LEFT JOIN areas area_cambio
        ON mc.area_id = area_cambio.id_area
      
      LEFT JOIN instalaciones inst_saliente
        ON inst_saliente.id_instalacion = (
          SELECT id_instalacion 
          FROM instalaciones 
          WHERE maquina_id = mc.maquina_saliente_id 
            AND fecha_retiro IS NOT NULL
          ORDER BY fecha_retiro DESC 
          LIMIT 1
        )
      
      LEFT JOIN instalaciones inst_entrante
        ON inst_entrante.id_instalacion = (
          SELECT id_instalacion 
          FROM instalaciones 
          WHERE maquina_id = mc.maquina_entrante_id 
            AND activo = true
          ORDER BY fecha_instalacion ASC 
          LIMIT 1
        )
      
      -- DETALLES ACTUALES
      LEFT JOIN (
        SELECT reporte_oficial_id,
               SUM(cnt_impresion_bn) as det_cur_imp_bn,
               SUM(cnt_impresion_color) as det_cur_imp_col,
               SUM(cnt_copia_bn) as det_cur_cop_bn,
               SUM(cnt_copia_color) as det_cur_cop_col
        FROM reportes_detalle_oficial
        GROUP BY reporte_oficial_id
      ) det_cur ON det_cur.reporte_oficial_id = ro.id_reporte

      -- DETALLES ANTERIORES
      LEFT JOIN (
        SELECT reporte_oficial_id,
               SUM(cnt_impresion_bn) as det_prev_imp_bn,
               SUM(cnt_impresion_color) as det_prev_imp_col,
               SUM(cnt_copia_bn) as det_prev_cop_bn,
               SUM(cnt_copia_color) as det_prev_cop_col
        FROM reportes_detalle_oficial
        GROUP BY reporte_oficial_id
      ) det_prev_rel ON det_prev_rel.reporte_oficial_id = prev.id_reporte
      
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

    const detalles = rows.map(row => {
      const tieneCambio = row.maquina_cambio_id !== null;
      const tieneDetalle = (row.det_cur_imp_bn !== null && row.det_cur_imp_bn !== undefined) || 
                           (row.det_cur_cop_bn !== null && row.det_cur_cop_bn !== undefined);

      let consumoFinal;

      if (tieneCambio) {
        const esSaliente = row.maquina_id === row.maquina_saliente_id;
        const esEntrante = row.maquina_id === row.maquina_entrante_id;

        if (esSaliente) {
          const final_imp_bn = parseInt(row.saliente_imp_bn_final_snap || 0);
          const final_imp_col = parseInt(row.saliente_imp_col_final_snap || 0);

          const inicio_imp_bn = parseInt(row.saliente_imp_bn_inicio_real || 0);
          const inicio_imp_col = parseInt(row.saliente_imp_col_inicio_real || 0);

          const consumo_imp_bn = final_imp_bn - inicio_imp_bn;
          const consumo_imp_col = final_imp_col - inicio_imp_col;

          consumoFinal = {
            total_bn: Math.max(0, consumo_imp_bn),
            total_color: Math.max(0, consumo_imp_col),
            gran_total: Math.max(0, consumo_imp_bn + consumo_imp_col)
          };

        } else if (esEntrante) {
          const final_imp_bn = parseInt(row.cur_imp_bn || 0);
          const final_imp_col = parseInt(row.cur_imp_col || 0);

          const inicio_imp_bn = parseInt(row.entrante_imp_bn_inicial_snap || 0);
          const inicio_imp_col = parseInt(row.entrante_imp_col_inicial_snap || 0);

          const consumo_imp_bn = final_imp_bn - inicio_imp_bn;
          const consumo_imp_col = final_imp_col - inicio_imp_col;

          consumoFinal = {
            total_bn: Math.max(0, consumo_imp_bn),
            total_color: Math.max(0, consumo_imp_col),
            gran_total: Math.max(0, consumo_imp_bn + consumo_imp_col)
          };
        } else {
          consumoFinal = calcularConsumoNormal(row);
        }
      } else {
        consumoFinal = calcularConsumoNormal(row);
      }

      const dineroTotal = consumoFinal.gran_total * parseFloat(row.snap_costo_impresion_bn || 0);
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
        const dateCorte = new Date(row.fecha_corte_actual);
        const dateInstalacion = new Date(fechaInicioEntrante);

        if (dateCorte < dateInstalacion) {
          fechaFinEntrante = fechaInicioEntrante;
        } else {
          fechaFinEntrante = row.fecha_corte_actual;
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
          es_parte_cambio: row.es_parte_cambio || false
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
              contadores: {
                anterior: {
                  global: parseInt(row.saliente_contador_inicio_real_global || 0),
                  impresion_bn: parseInt(row.saliente_imp_bn_inicio_real || 0),
                  impresion_color: parseInt(row.saliente_imp_col_inicio_real || 0)
                },
                actual: {
                  global: parseInt(row.saliente_contador_final_snap || 0),
                  impresion_bn: parseInt(row.saliente_imp_bn_final_snap || 0),
                  impresion_color: parseInt(row.saliente_imp_col_final_snap || 0)
                },
                consumo: {
                  global: (parseInt(row.saliente_contador_final_snap || 0) - parseInt(row.saliente_contador_inicio_real_global || 0)),
                  total_bn: Math.max(0, parseInt(row.saliente_imp_bn_final_snap || 0) - parseInt(row.saliente_imp_bn_inicio_real || 0)),
                  total_color: Math.max(0, parseInt(row.saliente_imp_col_final_snap || 0) - parseInt(row.saliente_imp_col_inicio_real || 0))
                }
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
                  global: parseInt(row.entrante_contador_inicial_snap || 0),
                  impresion_bn: parseInt(row.entrante_imp_bn_inicial_snap || 0),
                  impresion_color: parseInt(row.entrante_imp_col_inicial_snap || 0)
                },
                actual: {
                  global: parseInt(row.cur_total_servicio || 0),
                  impresion_bn: parseInt(row.cur_imp_bn || 0),
                  impresion_color: parseInt(row.cur_imp_col || 0)
                },
                consumo: {
                  global: (parseInt(row.cur_total_servicio || 0) - parseInt(row.entrante_contador_inicial_snap || 0)),
                  total_bn: Math.max(0, parseInt(row.cur_imp_bn || 0) - parseInt(row.entrante_imp_bn_inicial_snap || 0)),
                  total_color: Math.max(0, parseInt(row.cur_imp_col || 0) - parseInt(row.entrante_imp_col_inicial_snap || 0))
                }
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
          monto_total: dineroTotal.toFixed(2)
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
        )
    ORDER BY mod.nombre ASC
`, [clienteId, periodo]);

    const rentaEquipos = rentaRows.map(r => ({
      id_instalacion: r.id_instalacion,
      serie: r.serie,
      modelo: r.modelo_nombre,
      area: r.area_nombre,
      costo_mensual: parseFloat(r.costo_renta_mensual)
    }));

    const totalRenta = rentaEquipos.reduce((acc, r) => acc + r.costo_mensual, 0);

    const resumen = {
      total_bn: detalles.reduce((acc, d) => acc + d.consumo.total_bn, 0),
      total_color: detalles.reduce((acc, d) => acc + d.consumo.total_color, 0),
      total_impresiones: detalles.reduce((acc, d) => acc + d.consumo.gran_total, 0),
      monto_total_general: detalles.reduce((acc, d) => acc + parseFloat(d.financiero.monto_total), 0),
      total_maquinas: detalles.length,
      total_cambios: detalles.filter(d => d.info.tiene_cambio).length,
      periodo: periodo,
      cliente_id: clienteId,
      renta_equipos: rentaEquipos,
      total_renta: totalRenta,
      total_general: detalles.reduce((acc, d) => acc + parseFloat(d.financiero.monto_total), 0) + totalRenta
    };

    return { detalles, resumen };

  } catch (error) {
    console.error('❌ Error en getReporteConsolidado:', error);
    throw error;
  }
};

const getReporteDetallado = async (clienteId, periodo, areaId = null, maquinaId = null) => {
  try {
    let queryText = `
      SELECT DISTINCT
        -- DATOS DEL DETALLE (Hijo)
        rd.id_detalle,
        rd.fecha_transaccion,
        rd.cuenta_id,
        rd.usuario_trabajo,
        
        -- Los contadores específicos
        rd.cnt_impresion_bn,
        rd.cnt_impresion_color,
        rd.cnt_copia_bn,
        rd.cnt_copia_color,
        
        -- Totales calculados de la fila (BN vs Color)
        (rd.cnt_impresion_bn + rd.cnt_copia_bn) as total_bn,
        (rd.cnt_impresion_color + rd.cnt_copia_color) as total_color,
        (rd.cnt_impresion_bn + rd.cnt_impresion_color + rd.cnt_copia_bn + rd.cnt_copia_color) as gran_total,
        
        rd.monto_detalle,

        -- DATOS DEL CONTEXTO (Padre - Reporte Oficial)
        ro.periodo,
        ro.snap_maquina_serie as serie,
        COALESCE(mod.nombre, 'No disponible') as modelo,
        ro.snap_maquina_ip as ip,
        
        COALESCE(ro.snap_costo_impresion_bn, 0) as costo_imp_bn,
        COALESCE(ro.snap_costo_impresion_color, 0) as costo_imp_col,
        
        -- Área: Priorizamos el snapshot histórico, si es nulo ponemos 'Sin Área'
        COALESCE(ro.snap_area_nombre, 'Sin Área') as area

      FROM reportes_detalle_oficial rd
      
      -- UNIÓN CON EL PADRE (Necesaria para filtrar por Cliente y Periodo)
      JOIN reportes_oficiales ro ON rd.reporte_oficial_id = ro.id_reporte
      
      -- JOINS PARA OBTENER EL MODELO
      LEFT JOIN maquinas m ON ro.maquina_id = m.id_maquina
      LEFT JOIN modelos mod ON m.modelo_id = mod.id_modelo

      -- JOINS OPCIONALES (Solo para aplicar el filtro de area_id si se envía)
      LEFT JOIN instalaciones i ON ro.maquina_id = i.maquina_id AND i.activo = true
      LEFT JOIN areas a ON i.area_id = a.id_area

      WHERE ro.cliente_id = $1 
        AND ro.periodo = $2
    `;

    const params = [clienteId, periodo];
    let paramCounter = 3;

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
      const montoImpBN = row.cnt_impresion_bn * parseFloat(row.costo_imp_bn || 0);
      const montoImpCol = row.cnt_impresion_color * parseFloat(row.costo_imp_col || 0);
      const montoCopBN = row.cnt_copia_bn * parseFloat(row.costo_imp_bn || 0);
      const montoCopCol = row.cnt_copia_color * parseFloat(row.costo_imp_col || 0);

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
        contadores: {
          print_bn: row.cnt_impresion_bn,
          print_color: row.cnt_impresion_color,
          copia_bn: row.cnt_copia_bn,
          copia_color: row.cnt_copia_color
        },
        totales: {
          bn: parseInt(row.total_bn),
          color: parseInt(row.total_color),
          general: parseInt(row.gran_total)
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