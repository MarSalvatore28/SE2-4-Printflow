// Hace el trabajo de n8n: lee los correos del buzón, los convierte y los envía a la
// ingesta de PrintFlow con el token propio (INGESTA_TOKEN).
//
//   node procesar-buzon.js              procesa lo que haya en buzon/entrada y termina
//   node procesar-buzon.js --vigilar    revisa el buzón cada 10 s (como el disparador de n8n)
//
// Según la respuesta, cada correo pasa a buzon/procesados o a buzon/con-error.
// Si la API no responde (S3-08): reintenta con espera creciente; si sigue caída, el correo
// se queda en la entrada para el próximo ciclo y, al llegar a FALLOS_PARA_ALERTA ciclos, se
// avisa al administrador con un correo en buzon/alertas. Un correo ilegible o rechazado por la
// API también genera alerta.
//
// Variables: REINTENTOS (3), ESPERA_BASE_MS (1000), FALLOS_PARA_ALERTA (3), ALERTA_PARA (admin@printflow.local)

const fs = require('fs');
const path = require('path');
const { leerCorreo } = require('./lib/correo');
const { correoAIngesta } = require('./lib/n8n');
const entrega = require('./lib/entrega');

const API_URL = process.env.API_URL || 'http://api:9000';
const BUZON = path.join(__dirname, 'buzon');
const DIR = {
  entrada: path.join(BUZON, 'entrada'),
  procesados: path.join(BUZON, 'procesados'),
  error: path.join(BUZON, 'con-error'),
  alertas: path.join(BUZON, 'alertas'),
};
const RUTA_ESTADO = path.join(BUZON, 'estado.json');

function mover(archivo, destino, motivo) {
  fs.mkdirSync(destino, { recursive: true });
  fs.renameSync(path.join(DIR.entrada, archivo), path.join(destino, archivo));
  if (motivo) fs.writeFileSync(path.join(destino, `${archivo}.motivo.txt`), `${motivo}\n`);
}

async function enviarAIngesta(items) {
  const token = process.env.INGESTA_TOKEN;
  if (!token) throw Object.assign(new Error('Falta INGESTA_TOKEN (ponlo en el .env del backend)'), { fatal: true });
  let respuesta;
  try {
    respuesta = await fetch(`${API_URL}/api/ingesta/cargar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(items),
    });
  } catch (error) {
    // status 0 = la API no respondió (se puede reintentar)
    return { status: 0, cuerpo: {}, error: `La API no responde en ${API_URL} (${error.cause?.code || error.message})` };
  }
  const cuerpo = await respuesta.json().catch(() => ({}));
  return { status: respuesta.status, cuerpo };
}

function alertar({ archivo, asunto, motivo, fallos, pendientes, log }) {
  const { alertaPara } = entrega.configuracion();
  const nombre = entrega.guardarAlerta(DIR.alertas, archivo,
    entrega.crearAlerta({ archivo, asunto, motivo, fallos, pendientes, para: alertaPara }));
  log(`   🔔 Alerta enviada a ${alertaPara} (buzon/alertas/${nombre})`);
}

// Procesa todo el buzón una vez. Devuelve un resumen por correo.
async function procesarBuzon({ silencioso = false } = {}) {
  const log = silencioso ? () => {} : console.log;
  const config = entrega.configuracion();
  fs.mkdirSync(DIR.entrada, { recursive: true });
  const archivos = fs.readdirSync(DIR.entrada).filter((a) => a.endsWith('.eml')).sort();
  const estado = entrega.leerEstado(RUTA_ESTADO);
  const resumen = [];

  for (const archivo of archivos) {
    let correo;
    let ingesta;
    try {
      correo = leerCorreo(fs.readFileSync(path.join(DIR.entrada, archivo), 'utf8'));
      ingesta = correoAIngesta(correo);
    } catch (error) {
      mover(archivo, DIR.error, `No se pudo leer el correo: ${error.message}`);
      log(`✗ ${archivo}: no se pudo leer (${error.message}) → con-error`);
      alertar({ archivo, motivo: `Correo ilegible: ${error.message}`, log });
      delete estado[archivo];
      resumen.push({ archivo, resultado: 'ERROR_LECTURA', detalle: error.message });
      continue;
    }

    const formatos = [...new Set(ingesta.reportes.map((r) => r.formato))].join(', ');
    log(`✉ ${archivo} · «${correo.asunto}»`);
    log(`   ${ingesta.items.length} reporte(s) [${formatos}] → lote ${ingesta.lote.codigo_referencia}`);
    ingesta.avisos.forEach((a) => log(`   ⚠ ${a}`));

    const envio = await entrega.enviarConReintentos(() => enviarAIngesta(ingesta.items), {
      reintentos: config.reintentos, esperaBaseMs: config.esperaBaseMs, log,
    });
    const { status, cuerpo } = envio;

    if (envio.agotado) {
      // La API sigue sin responder: el correo NO se pierde, queda para el próximo ciclo
      const registro = estado[archivo] || { fallos: 0, alertado: false };
      registro.fallos += 1;
      registro.ultimoError = envio.error || `HTTP ${status}`;
      estado[archivo] = registro;
      const pendientes = fs.readdirSync(DIR.entrada).filter((a) => a.endsWith('.eml')).length;
      log(`   … ${registro.ultimoError}. Ciclo fallido ${registro.fallos}; el correo se queda en la entrada.`);
      if (registro.fallos >= config.fallosParaAlerta && !registro.alertado) {
        alertar({ archivo, asunto: correo.asunto, motivo: registro.ultimoError, fallos: registro.fallos, pendientes, log });
        registro.alertado = true;
      }
      resumen.push({ archivo, resultado: 'REINTENTAR', detalle: registro.ultimoError, fallos: registro.fallos });
      break; // si la API está caída, los demás correos fallarían igual
    }

    delete estado[archivo];
    if (status === 200 && cuerpo.success) {
      const resultado = cuerpo.estado || 'PROCESADO';
      mover(archivo, DIR.procesados);
      log(resultado === 'DESCARTADO'
        ? `   ↺ DESCARTADO: este correo (${correo.messageId}) ya se había procesado`
        : `   ✓ PROCESADO: ${cuerpo.data?.total_procesados} reporte(s) en staging`);
      resumen.push({ archivo, resultado, lote: ingesta.lote.codigo_referencia, intentos: envio.intentos });
    } else {
      const motivo = `HTTP ${status}: ${cuerpo.message || 'sin mensaje'}`;
      mover(archivo, DIR.error, motivo);
      log(`   ✗ ${motivo} → con-error`);
      alertar({ archivo, asunto: correo.asunto, motivo: `La API rechazó el correo (${motivo})`, log });
      resumen.push({ archivo, resultado: 'RECHAZADO', detalle: motivo });
    }
  }

  entrega.guardarEstado(RUTA_ESTADO, estado);
  if (archivos.length === 0) log('Buzón vacío: no hay correos nuevos.');
  return resumen;
}

module.exports = { procesarBuzon };

if (require.main === module) {
  const vigilar = process.argv.includes('--vigilar');
  const ciclo = async () => {
    try {
      await procesarBuzon();
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  };
  if (!vigilar) {
    ciclo();
  } else {
    console.log(`Vigilando simulador/buzon/entrada cada 10 s (API: ${API_URL}). Ctrl+C para salir.`);
    const repetir = async () => {
      const hayCorreos = fs.existsSync(DIR.entrada) && fs.readdirSync(DIR.entrada).some((a) => a.endsWith('.eml'));
      if (hayCorreos) await ciclo();
      setTimeout(repetir, 10000);
    };
    repetir();
  }
}
