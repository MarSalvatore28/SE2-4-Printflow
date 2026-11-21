// Escribe (por la salida estándar) el SQL que registra en PrintFlow los clientes,
// contratos, áreas, máquinas y asignaciones del escenario. Se puede ejecutar varias
// veces: no duplica nada.
//
//   docker compose run --rm -T simulador preparar-datos.js | docker compose exec -T db psql -U postgres -d printflow
//
// Va por SQL para que los datos coincidan siempre con los correos que genera el simulador.
// Con --maquinas 500 (y opcionalmente --clientes 20) registra el escenario grande (S4-05).

const { escenarioDeArgs } = require('./lib/escenarioGrande');

const q = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`);
const FECHA_INSTALACION = '2026-01-15';

function generarSql(escenario) {
  const sql = [
    '-- PrintFlow · datos de la simulación (100 % ficticios). Generado por simulador/preparar-datos.js',
    'BEGIN;',
  ];

  const entrantes = (escenario.reemplazos || []).map((r) => r.entrante);
  const modelos = [...new Set([...escenario.clientes.flatMap((c) => c.maquinas), ...entrantes].map((m) => m.modelo))];
  modelos.forEach((modelo) => sql.push(
    `INSERT INTO modelos (nombre) VALUES (${q(modelo)}) ON CONFLICT (nombre) DO NOTHING;`,
  ));

  for (const cliente of escenario.clientes) {
    const k = cliente.contrato;
    const idCliente = `(SELECT id_cliente FROM clientes WHERE ruc = ${q(cliente.ruc)})`;
    const idContrato = `(SELECT id_contrato FROM contratos WHERE cliente_id = ${idCliente} AND fecha_inicio = ${q(k.fecha_inicio)} ORDER BY id_contrato LIMIT 1)`;

    sql.push(
      '',
      `-- ${cliente.nombre}`,
      `INSERT INTO clientes (nombre, ruc, razon_social) SELECT ${q(cliente.nombre)}, ${q(cliente.ruc)}, ${q(cliente.razon_social)}` +
      ` WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE ruc = ${q(cliente.ruc)});`,
      'INSERT INTO contratos (cliente_id, fecha_inicio, fecha_fin, impresiones_bn_incluidas, impresiones_color_incluidas,' +
      ' costo_impresion_bn, costo_impresion_color, costo_x_excedente_impresion_bn, costo_x_excedente_impresion_color,' +
      ' renta_equipo, software_control, facturacion_de_impresora)' +
      ` SELECT ${idCliente}, ${q(k.fecha_inicio)}, ${q(k.fecha_fin)}, ${k.impresiones_bn_incluidas}, ${k.impresiones_color_incluidas},` +
      ` ${k.costo_impresion_bn}, ${k.costo_impresion_color}, ${k.costo_excedente_impresion_bn}, ${k.costo_excedente_impresion_color},` +
      ` false, false, ${q(k.facturacion_de_impresora)}` +
      ` WHERE NOT EXISTS (SELECT 1 FROM contratos WHERE cliente_id = ${idCliente} AND fecha_inicio = ${q(k.fecha_inicio)});`,
    );
    cliente.areas.forEach((area) => sql.push(
      `INSERT INTO areas (cliente_id, nombre) SELECT ${idCliente}, ${q(area)}` +
      ` WHERE NOT EXISTS (SELECT 1 FROM areas WHERE cliente_id = ${idCliente} AND nombre = ${q(area)});`,
    ));

    for (const m of cliente.maquinas) {
      const idMaquina = `(SELECT id_maquina FROM maquinas WHERE serie = ${q(m.serie)})`;
      sql.push(
        `INSERT INTO maquinas (serie, tipo_impresion_id, modelo_id) VALUES (${q(m.serie)},` +
        ` (SELECT id_tipo_impresion FROM tipos_impresion WHERE nombre = ${q(m.tipo)} LIMIT 1),` +
        ` (SELECT id_modelo FROM modelos WHERE nombre = ${q(m.modelo)})) ON CONFLICT (serie) DO NOTHING;`,
        'INSERT INTO instalaciones (maquina_id, area_id, contrato_id, ip_address, fecha_instalacion, activo,' +
        ' contador_acumulativo, contabilidad_por_usuario, costo_renta_mensual)' +
        ` SELECT ${idMaquina}, (SELECT id_area FROM areas WHERE cliente_id = ${idCliente} AND nombre = ${q(m.area)} LIMIT 1),` +
        ` ${idContrato}, ${q(m.ip)}, ${q(FECHA_INSTALACION)}, true, true, ${m.formato === 'csv-cuentas'}, 0` +
        ` WHERE NOT EXISTS (SELECT 1 FROM instalaciones WHERE maquina_id = ${idMaquina} AND activo = true AND fecha_retiro IS NULL);`,
      );
    }
  }

  // Máquinas de escenario.reemplazos: se registran LIBRES (sin asignación). La asignación la
  // crea PrintFlow cuando se registra el reemplazo en Máquinas → Reemplazos.
  if (entrantes.length > 0) sql.push('', '-- Máquinas para los reemplazos (quedan sin asignar)');
  entrantes.forEach((m) => sql.push(
    `INSERT INTO maquinas (serie, tipo_impresion_id, modelo_id) VALUES (${q(m.serie)},` +
    ` (SELECT id_tipo_impresion FROM tipos_impresion WHERE nombre = ${q(m.tipo)} LIMIT 1),` +
    ` (SELECT id_modelo FROM modelos WHERE nombre = ${q(m.modelo)})) ON CONFLICT (serie) DO NOTHING;`,
  ));

  sql.push(
    '',
    'COMMIT;',
    '',
    "SELECT 'Simulación lista: ' || count(*) || ' máquinas asignadas' AS resultado FROM instalaciones i JOIN maquinas m ON m.id_maquina = i.maquina_id WHERE m.serie LIKE 'SIM%' AND i.activo;",
  );
  return sql.join('\n') + '\n';
}

module.exports = { generarSql };

if (require.main === module) {
  process.stdout.write(generarSql(escenarioDeArgs()));
}
