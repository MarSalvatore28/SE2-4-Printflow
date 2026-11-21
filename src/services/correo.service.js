// Envío de correos (S3-03). No depende de ningún proveedor: el modo se elige en el .env.
//
//   CORREO_MODO=archivo     (por defecto) cada correo se guarda como .eml en CORREO_DIR (buzón de
//                           salida); se abre con Outlook o Thunderbird. Sin servicios ni cuentas.
//   CORREO_MODO=smtp        se envía por SMTP: el servidor que ponga DOX en producción, o Mailpit
//                           (docker compose --profile correo) para verlos en http://localhost:8025.
//   CORREO_MODO=desactivado no se envía nada.
//
// Si el envío falla, se devuelve { enviado: false, error } y se registra en el log: un correo nunca
// debe tumbar la API ni la ingesta.
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

const MODOS = new Set(['archivo', 'smtp', 'desactivado']);

function configuracion() {
  const modo = (process.env.CORREO_MODO || 'archivo').trim().toLowerCase();
  return {
    modo: MODOS.has(modo) ? modo : 'archivo',
    dir: process.env.CORREO_DIR || path.resolve(__dirname, '../../buzon-salida'),
    remitente: process.env.CORREO_REMITENTE || 'PrintFlow <no-responder@printflow.example>',
    smtp: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    },
  };
}

// El cifrado lo decide el .env: SMTP_SECURE=true para TLS directo (puerto 465); si no, nodemailer
// pasa a TLS con STARTTLS cuando el servidor lo ofrece (puerto 587, el de DOX). Mailpit, solo local,
// no ofrece TLS.
let transporteSmtp;
const crearTransporteSmtp = ({ host, port, secure, auth }) => {
  transporteSmtp ||= nodemailer.createTransport({ host, port, secure, auth });
  return transporteSmtp;
};

// Arma el .eml con el mismo formato MIME que se enviaría por SMTP. No abre ninguna conexión: el
// mensaje queda en memoria y se guarda en el buzón de salida.
const transporteArchivo = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }); // NOSONAR: no usa la red

const nombreArchivo = (asunto, fecha = new Date()) => {
  const marca = fecha.toISOString().replace(/[:.]/g, '-');
  const corto = String(asunto).normalize('NFD').replace(/[^\w-]+/g, '_').slice(0, 50);
  return `${marca}_${corto}.eml`;
};

async function enviarCorreo({ para, asunto, texto, html }) {
  const config = configuracion();
  const destinatarios = (Array.isArray(para) ? para : [para]).filter(Boolean);
  if (config.modo === 'desactivado') return { enviado: false, modo: 'desactivado' };
  if (destinatarios.length === 0) return { enviado: false, error: 'Sin destinatarios' };

  const mensaje = { from: config.remitente, to: destinatarios.join(', '), subject: asunto, text: texto, html };
  try {
    if (config.modo === 'smtp') {
      if (!config.smtp.host) throw new Error('Falta SMTP_HOST en el .env');
      const info = await crearTransporteSmtp(config.smtp).sendMail(mensaje);
      return { enviado: true, modo: 'smtp', id: info.messageId };
    }
    const { message } = await transporteArchivo.sendMail(mensaje);
    fs.mkdirSync(config.dir, { recursive: true });
    const archivo = path.join(config.dir, nombreArchivo(asunto));
    fs.writeFileSync(archivo, message);
    return { enviado: true, modo: 'archivo', archivo };
  } catch (error) {
    console.error(`No se pudo enviar el correo «${asunto}»:`, error.message);
    return { enviado: false, error: error.message };
  }
}

module.exports = { enviarCorreo, configuracion };
