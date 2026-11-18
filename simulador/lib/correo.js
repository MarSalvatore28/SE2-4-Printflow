// Correos .eml (MIME multipart) como los que llegan al buzón: un cuerpo de texto y
// un adjunto por impresora. Sin dependencias: Node trae todo lo necesario.

const crypto = require('crypto');

const encabezadoUtf8 = (texto) =>
  /^[\x20-\x7e]*$/.test(texto) ? texto : `=?UTF-8?B?${Buffer.from(texto, 'utf8').toString('base64')}?=`;

const decodificarEncabezado = (valor) =>
  valor.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));

const base64EnLineas = (texto) =>
  Buffer.from(texto, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');

// adjuntos: [{ nombre, mime, contenido }]
function crearCorreo({ de, para, asunto, fecha, messageId, cuerpo, adjuntos }) {
  const limite = `----=_PrintFlowSim_${crypto.randomBytes(8).toString('hex')}`;
  const partes = [
    [
      `--${limite}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      base64EnLineas(cuerpo),
    ].join('\r\n'),
    ...adjuntos.map((a) => [
      `--${limite}`,
      `Content-Type: ${a.mime}; charset="utf-8"; name="${a.nombre}"`,
      `Content-Disposition: attachment; filename="${a.nombre}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64EnLineas(a.contenido),
    ].join('\r\n')),
  ];
  return [
    `From: ${de}`,
    `To: ${para}`,
    `Subject: ${encabezadoUtf8(asunto)}`,
    `Date: ${fecha.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    '',
    ...partes,
    `--${limite}--`,
    '',
  ].join('\r\n');
}

function separarEncabezados(texto) {
  const corte = texto.search(/\r?\n\r?\n/);
  const bloque = corte === -1 ? texto : texto.slice(0, corte);
  const cuerpo = corte === -1 ? '' : texto.slice(corte).replace(/^\r?\n\r?\n/, '');
  const encabezados = {};
  // Las líneas que empiezan con espacio continúan el encabezado anterior
  for (const linea of bloque.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = linea.indexOf(':');
    if (i > 0) encabezados[linea.slice(0, i).trim().toLowerCase()] = linea.slice(i + 1).trim();
  }
  return { encabezados, cuerpo };
}

function decodificarParte(encabezados, cuerpo) {
  const codificacion = (encabezados['content-transfer-encoding'] || '').toLowerCase();
  return codificacion === 'base64'
    ? Buffer.from(cuerpo.replace(/\s+/g, ''), 'base64').toString('utf8')
    : cuerpo;
}

// Devuelve { de, asunto, fecha, messageId, cuerpo, adjuntos: [{ nombre, contenido }] }
function leerCorreo(texto) {
  const { encabezados, cuerpo } = separarEncabezados(texto);
  const limite = ((encabezados['content-type'] || '').match(/boundary="?([^";]+)"?/i) || [])[1];
  const resultado = {
    de: decodificarEncabezado(encabezados.from || ''),
    asunto: decodificarEncabezado(encabezados.subject || ''),
    fecha: encabezados.date ? new Date(encabezados.date) : null,
    messageId: encabezados['message-id'] || null,
    cuerpo: '',
    adjuntos: [],
  };
  if (!limite) {
    resultado.cuerpo = decodificarParte(encabezados, cuerpo);
    return resultado;
  }
  for (const bruto of cuerpo.split(`--${limite}`).slice(1)) {
    if (bruto.startsWith('--')) break;
    const parte = separarEncabezados(bruto.replace(/^\r?\n/, ''));
    const contenido = decodificarParte(parte.encabezados, parte.cuerpo.trim());
    const disposicion = parte.encabezados['content-disposition'] || '';
    const nombre = (disposicion.match(/filename="?([^";]+)"?/i) || [])[1];
    if (/attachment/i.test(disposicion)) resultado.adjuntos.push({ nombre, contenido });
    else if (!resultado.cuerpo) resultado.cuerpo = contenido;
  }
  return resultado;
}

module.exports = { crearCorreo, leerCorreo };
