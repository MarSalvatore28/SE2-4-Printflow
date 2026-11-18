// Genera los correos que "mandan las impresoras" de un mes y los deja en el buzón.
//
//   node generar-correos.js --periodo 2026-10
//   node generar-correos.js --periodo 2026-10 --errores          (+ casos de error)
//   node generar-correos.js --periodo 2026-10 --falla SIMB0002   (equipo con falla)
//
// Un correo por cliente y mes, con un adjunto por impresora en el formato de su marca.
// El Message-ID es fijo por cliente y mes: generar dos veces el mismo mes simula un reenvío.

const fs = require('fs');
const path = require('path');
const { cargarEscenario, validarPeriodo, fechaCorte, contadoresAlCierre, repartirPorUsuario } = require('./lib/escenario');
const { FORMATOS } = require('./lib/formatos');
const { crearCorreo } = require('./lib/correo');

const BUZON = path.join(__dirname, 'buzon', 'entrada');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const nombreMes = (periodo) => `${MESES[Number(periodo.slice(5)) - 1]} de ${periodo.slice(0, 4)}`;

function adjuntoDe(maquina, periodo, periodoBase, fallas) {
  const contadores = contadoresAlCierre(maquina, periodo, periodoBase);
  const formato = FORMATOS[maquina.formato];
  if (!formato) throw new Error(`La máquina ${maquina.serie} tiene un formato desconocido: ${maquina.formato}`);
  return {
    nombre: `contadores_${maquina.serie}_${periodo}.${formato.extension}`,
    mime: formato.mime,
    contenido: formato.generar({
      maquina,
      estado: fallas.includes(maquina.serie) ? 'Error de comunicación' : 'Lista',
      fechaCorte: fechaCorte(periodo),
      contadores,
      cuentas: maquina.usuarios ? repartirPorUsuario(contadores, maquina.usuarios) : null,
    }),
  };
}

function correoDe({ remitente, nombre, codigo, maquinas }, periodo, escenario, fallas) {
  const corte = fechaCorte(periodo);
  return crearCorreo({
    de: `"Reportes de impresoras · ${nombre}" <${remitente}>`,
    para: escenario.buzon_destino,
    asunto: `Reporte de contadores ${periodo} · ${nombre}`,
    fecha: new Date(corte.getTime() + 30 * 60 * 1000),
    messageId: `<sim-${periodo}-${codigo}@printflow.example>`,
    cuerpo: `Reporte automático de contadores de ${nombre} al cierre de ${nombreMes(periodo)}.\r\n` +
      `Equipos incluidos: ${maquinas.length}. Correo generado por el simulador de PrintFlow (datos ficticios).\r\n`,
    adjuntos: maquinas.map((m) => adjuntoDe(m, periodo, escenario.periodo_base, fallas)),
  });
}

function generarCorreos({ periodo, errores = false, fallas = [], buzon = BUZON } = {}) {
  validarPeriodo(periodo);
  const escenario = cargarEscenario();
  fs.mkdirSync(buzon, { recursive: true });
  const archivos = [];
  const guardar = (nombreArchivo, contenido) => {
    const ruta = path.join(buzon, nombreArchivo);
    fs.writeFileSync(ruta, contenido);
    archivos.push(nombreArchivo);
  };

  for (const cliente of escenario.clientes) {
    guardar(`${periodo}_${cliente.codigo}.eml`, correoDe(cliente, periodo, escenario, fallas));
  }

  if (errores) {
    // 1. Un equipo que nadie registró en PrintFlow → «Máquina no autorizada»
    guardar(`${periodo}_desconocido.eml`, correoDe({
      remitente: 'reportes@desconocido.example',
      nombre: 'Remitente sin registrar',
      codigo: 'desconocido',
      maquinas: [{
        serie: 'SIMX9999', modelo: 'Equipo no registrado (demo)', formato: 'texto-contadores', ip: '10.99.9.99',
        contador_inicial: { impresion_bn: 5000, impresion_color: 0, copia_bn: 0, copia_color: 0 },
        consumo_mensual: { impresion_bn: 900, impresion_color: 0, copia_bn: 0, copia_color: 0 },
      }],
    }, periodo, escenario, fallas));

    // 2. El mismo correo del primer cliente llega dos veces → la segunda se descarta
    const primero = escenario.clientes[0];
    guardar(`${periodo}_${primero.codigo}_reenvio.eml`, correoDe(primero, periodo, escenario, fallas));
  }

  return archivos;
}

module.exports = { generarCorreos };

if (require.main === module) {
  const args = process.argv.slice(2);
  const valor = (nombre) => {
    const i = args.indexOf(nombre);
    return i === -1 ? undefined : args[i + 1];
  };
  try {
    const archivos = generarCorreos({
      periodo: valor('--periodo'),
      errores: args.includes('--errores'),
      fallas: (valor('--falla') || '').split(',').map((s) => s.trim()).filter(Boolean),
    });
    console.log(`Correos generados en simulador/buzon/entrada (${archivos.length}):`);
    archivos.forEach((a) => console.log(`  ✉  ${a}`));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
