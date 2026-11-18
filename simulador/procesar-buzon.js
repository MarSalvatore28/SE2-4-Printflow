// Hace el trabajo de n8n: lee los correos del buzón, los convierte y los envía a la
// ingesta de PrintFlow con el token propio (INGESTA_TOKEN).
//
//   node procesar-buzon.js              procesa lo que haya en buzon/entrada y termina
//   node procesar-buzon.js --vigilar    revisa el buzón cada 10 s (como el disparador de n8n)
//
// Según la respuesta, cada correo pasa a buzon/procesados o a buzon/con-error.
// Si la API no responde, el correo se queda en la entrada para el próximo intento.

const fs = require('fs');
const path = require('path');
const { leerCorreo } = require('./lib/correo');
const { correoAIngesta } = require('./lib/n8n');

const API_URL = process.env.API_URL || 'http://api:9000';
const BUZON = path.join(__dirname, 'buzon');
const DIR = {
  entrada: path.join(BUZON, 'entrada'),
  procesados: path.join(BUZON, 'procesados'),
  error: path.join(BUZON, 'con-error'),
};

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
    throw Object.assign(new Error(`La API no responde en ${API_URL} (${error.cause?.code || error.message})`), { reintentar: true });
  }
  const cuerpo = await respuesta.json().catch(() => ({}));
  return { status: respuesta.status, cuerpo };
}

// Procesa todo el buzón una vez. Devuelve un resumen por correo.
async function procesarBuzon({ silencioso = false } = {}) {
  const log = silencioso ? () => {} : console.log;
  fs.mkdirSync(DIR.entrada, { recursive: true });
  const archivos = fs.readdirSync(DIR.entrada).filter((a) => a.endsWith('.eml')).sort();
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
      resumen.push({ archivo, resultado: 'ERROR_LECTURA', detalle: error.message });
      continue;
    }

    const formatos = [...new Set(ingesta.reportes.map((r) => r.formato))].join(', ');
    log(`✉ ${archivo} · «${correo.asunto}»`);
    log(`   ${ingesta.items.length} reporte(s) [${formatos}] → lote ${ingesta.lote.codigo_referencia}`);
    ingesta.avisos.forEach((a) => log(`   ⚠ ${a}`));

    let envio;
    try {
      envio = await enviarAIngesta(ingesta.items);
    } catch (error) {
      if (error.fatal) throw error;
      log(`   … ${error.message}. Se reintenta en el próximo ciclo.`);
      resumen.push({ archivo, resultado: 'REINTENTAR', detalle: error.message });
      break;
    }

    const { status, cuerpo } = envio;
    if (status === 200 && cuerpo.success) {
      const estado = cuerpo.estado || 'PROCESADO';
      mover(archivo, DIR.procesados);
      log(estado === 'DESCARTADO'
        ? `   ↺ DESCARTADO: este correo (${correo.messageId}) ya se había procesado`
        : `   ✓ PROCESADO: ${cuerpo.data?.total_procesados} reporte(s) en staging`);
      resumen.push({ archivo, resultado: estado, lote: ingesta.lote.codigo_referencia });
    } else {
      const motivo = `HTTP ${status}: ${cuerpo.message || 'sin mensaje'}`;
      mover(archivo, DIR.error, motivo);
      log(`   ✗ ${motivo} → con-error`);
      resumen.push({ archivo, resultado: 'RECHAZADO', detalle: motivo });
    }
  }

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
