// Entrega a la ingesta con reintentos y alerta al administrador (S3-08).
// Es lo que hacía el flujo n8n de DOX cuando la API no respondía: reintentar con espera
// creciente, no perder el correo y avisar al administrador si el problema sigue.

const fs = require('fs');
const path = require('path');
const { crearCorreo } = require('./correo');

const configuracion = () => ({
  reintentos: Number(process.env.REINTENTOS ?? 3),
  esperaBaseMs: Number(process.env.ESPERA_BASE_MS ?? 1000),
  fallosParaAlerta: Number(process.env.FALLOS_PARA_ALERTA ?? 3),
  alertaPara: process.env.ALERTA_PARA || 'admin@printflow.local',
});

// Espera antes del reintento n (1, 2, 3…): base, 2 × base, 4 × base…
const esperaParaReintento = (n, base) => base * 2 ** (n - 1);

// Vale la pena reintentar si la API no respondió (status 0), está saturada (429) o falló (5xx).
// Un 4xx (por ejemplo, token de ingesta incorrecto) no se arregla reintentando.
const esReintentable = (status) => status === 0 || status === 429 || status >= 500;

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// enviar() devuelve { status, cuerpo, error }. Reintenta solo los fallos reintentables.
async function enviarConReintentos(enviar, { reintentos, esperaBaseMs, esperar = dormir, log = () => {} }) {
  let resultado;
  for (let intento = 0; intento <= reintentos; intento++) {
    if (intento > 0) {
      const ms = esperaParaReintento(intento, esperaBaseMs);
      log(`   … reintento ${intento} de ${reintentos} en ${ms / 1000} s`);
      await esperar(ms);
    }
    resultado = await enviar();
    if (!esReintentable(resultado.status)) return { ...resultado, intentos: intento + 1, agotado: false };
  }
  return { ...resultado, intentos: reintentos + 1, agotado: true };
}

// --- Estado entre ciclos: cuántas veces falló cada correo y si ya se avisó ---

function leerEstado(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return {};
  }
}

const guardarEstado = (ruta, estado) => fs.writeFileSync(ruta, `${JSON.stringify(estado, null, 2)}\n`);

// --- Alerta al administrador: un correo .eml en buzon/alertas (lo que enviaría n8n por SMTP) ---

function crearAlerta({ archivo, asunto, motivo, fallos, pendientes, para, fecha = new Date() }) {
  const lineas = [
    'El flujo de correo de PrintFlow no pudo registrar un reporte de contadores.',
    '',
    `Correo:            ${archivo}`,
    `Asunto:            ${asunto || '(sin asunto)'}`,
    `Motivo:            ${motivo}`,
    fallos ? `Ciclos fallidos:   ${fallos}` : null,
    pendientes ? `En espera:         ${pendientes} correo(s) en el buzón de entrada` : null,
    '',
    fallos
      ? 'El correo NO se perdió: sigue en el buzón y se volverá a intentar en cada ciclo.'
      : 'El correo se movió a buzon/con-error para revisarlo a mano.',
    'Revise que la API de PrintFlow esté arriba y que INGESTA_TOKEN sea el correcto.',
  ].filter((l) => l !== null);

  return crearCorreo({
    de: '"PrintFlow · flujo de correo" <flujo@printflow.example>',
    para,
    asunto: `⚠ PrintFlow: no se pudo registrar «${archivo}»`,
    fecha,
    messageId: `<alerta-${fecha.getTime()}-${archivo.replace(/[^\w.-]/g, '')}@printflow.example>`,
    cuerpo: `${lineas.join('\r\n')}\r\n`,
    adjuntos: [],
  });
}

function guardarAlerta(dir, archivo, contenido, fecha = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const marca = fecha.toISOString().replace(/[:.]/g, '-');
  const nombre = `${marca}_${archivo}`;
  fs.writeFileSync(path.join(dir, nombre), contenido);
  return nombre;
}

module.exports = {
  configuracion,
  esperaParaReintento,
  esReintentable,
  enviarConReintentos,
  leerEstado,
  guardarEstado,
  crearAlerta,
  guardarAlerta,
};
