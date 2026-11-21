// Los 3 formatos de reporte que "mandan las impresoras" en la simulación.
// Son formatos INVENTADOS para la demo (los reales de DOX no se pueden usar), pero
// representan los casos típicos: contabilidad por cuenta en CSV, página de contadores
// en texto y estado del equipo en XML. Cada formato tiene su generador y su lector.
//
// Todos los lectores devuelven el mismo objeto:
//   { formato, serie, ip, modelo, estado, fechaCorte: 'YYYY-MM-DDTHH:mm',
//     contadores: { impresion_bn, impresion_color, copia_bn, copia_color },
//     cuentas: [ { cuenta, nombre, impresion_bn, ... } ] | null }

const ESTADOS_OK = new Set(['lista', 'listo', 'en reposo', 'imprimiendo', 'ok']);
const estadoEsOk = (estado) => ESTADOS_OK.has(String(estado || '').trim().toLowerCase());

const dosDigitos = (n) => String(n).padStart(2, '0');
const isoCorto = (fecha) =>
  `${fecha.getUTCFullYear()}-${dosDigitos(fecha.getUTCMonth() + 1)}-${dosDigitos(fecha.getUTCDate())}T${dosDigitos(fecha.getUTCHours())}:${dosDigitos(fecha.getUTCMinutes())}`;
// Quita las repeticiones de `caracter` al final del texto. Sin regex: «uno o más al final» retrocede de más
const sinFinal = (texto, caracter) => {
  let fin = texto.length;
  while (fin > 0 && texto[fin - 1] === caracter) fin -= 1;
  return texto.slice(0, fin);
};
const entero = (texto) => {
  const n = Number.parseInt(String(texto).replace(/[^\d-]/g, ''), 10);
  if (Number.isNaN(n)) throw new Error(`Contador ilegible: "${texto}"`);
  return n;
};

// ---------------------------------------------------------------------------
// 1. csv-cuentas · contabilidad por cuenta (equipos con contabilidad por usuario)
// ---------------------------------------------------------------------------
const csvCuentas = {
  extension: 'csv',
  mime: 'text/csv',

  generar({ maquina, estado, fechaCorte, cuentas }) {
    const [fecha, hora] = isoCorto(fechaCorte).split('T');
    const lineas = [
      '# REPORTE DE CONTABILIDAD POR CUENTA',
      `# Serie;${maquina.serie}`,
      `# IP;${maquina.ip}`,
      `# Modelo;${maquina.modelo}`,
      `# Fecha de corte;${fecha} ${hora}`,
      `# Estado;${estado}`,
      'Cuenta;Usuario;Impresion BN;Impresion Color;Copia BN;Copia Color',
      ...cuentas.map((c) => [c.cuenta, c.nombre, c.impresion_bn, c.impresion_color, c.copia_bn, c.copia_color].join(';')),
    ];
    return lineas.join('\r\n') + '\r\n';
  },

  reconocer: (texto) => texto.startsWith('# REPORTE DE CONTABILIDAD POR CUENTA'),

  leer(texto) {
    const cabecera = {};
    const cuentas = [];
    for (const linea of texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (linea.startsWith('#')) {
        const [clave, ...valor] = linea.slice(1).split(';');
        if (valor.length) cabecera[clave.trim().toLowerCase()] = valor.join(';').trim();
      } else if (!linea.startsWith('Cuenta;')) {
        const [cuenta, nombre, ib, ic, cb, cc] = linea.split(';');
        cuentas.push({
          cuenta, nombre,
          impresion_bn: entero(ib), impresion_color: entero(ic), copia_bn: entero(cb), copia_color: entero(cc),
        });
      }
    }
    const sumar = (campo) => cuentas.reduce((s, c) => s + c[campo], 0);
    return {
      formato: 'csv-cuentas',
      serie: cabecera.serie,
      ip: cabecera.ip,
      modelo: cabecera.modelo,
      estado: cabecera.estado,
      fechaCorte: (cabecera['fecha de corte'] || '').replace(' ', 'T'),
      contadores: {
        impresion_bn: sumar('impresion_bn'), impresion_color: sumar('impresion_color'),
        copia_bn: sumar('copia_bn'), copia_color: sumar('copia_color'),
      },
      cuentas,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. texto-contadores · página de contadores en texto plano (fecha DD/MM/YYYY)
// ---------------------------------------------------------------------------
const ETIQUETAS_TEXTO = {
  serie: 'Numero de serie',
  ip: 'Direccion IP',
  modelo: 'Modelo',
  estado: 'Estado del equipo',
  fecha: 'Fecha del informe',
  total: 'Contador total',
  impresion_bn: 'Impresiones B/N',
  impresion_color: 'Impresiones color',
  copia_bn: 'Copias B/N',
  copia_color: 'Copias color',
};

const textoContadores = {
  extension: 'txt',
  mime: 'text/plain',

  generar({ maquina, estado, fechaCorte, contadores }) {
    const [fecha, hora] = isoCorto(fechaCorte).split('T');
    const [a, m, d] = fecha.split('-');
    const fila = (clave, valor) => `${ETIQUETAS_TEXTO[clave].padEnd(22, '.')} : ${valor}`;
    const total = contadores.impresion_bn + contadores.impresion_color + contadores.copia_bn + contadores.copia_color;
    return [
      '==== INFORME DE CONTADORES ====',
      fila('serie', maquina.serie),
      fila('ip', maquina.ip),
      fila('modelo', maquina.modelo),
      fila('estado', estado),
      fila('fecha', `${d}/${m}/${a} ${hora}`),
      fila('total', total),
      fila('impresion_bn', contadores.impresion_bn),
      fila('impresion_color', contadores.impresion_color),
      fila('copia_bn', contadores.copia_bn),
      fila('copia_color', contadores.copia_color),
      '===============================',
    ].join('\r\n') + '\r\n';
  },

  reconocer: (texto) => texto.startsWith('==== INFORME DE CONTADORES ===='),

  leer(texto) {
    const valores = {};
    for (const linea of texto.split(/\r?\n/)) {
      const partes = linea.split(' : ');
      if (partes.length < 2) continue;
      const etiqueta = sinFinal(partes[0], '.').trim();
      const clave = Object.keys(ETIQUETAS_TEXTO).find((k) => ETIQUETAS_TEXTO[k] === etiqueta);
      if (clave) valores[clave] = partes.slice(1).join(' : ').trim();
    }
    const [fecha, hora = '00:00'] = (valores.fecha || '').split(' ');
    const [d, m, a] = fecha.split('/');
    return {
      formato: 'texto-contadores',
      serie: valores.serie,
      ip: valores.ip,
      modelo: valores.modelo,
      estado: valores.estado,
      fechaCorte: `${a}-${m}-${d}T${hora}`,
      contadores: {
        impresion_bn: entero(valores.impresion_bn), impresion_color: entero(valores.impresion_color),
        copia_bn: entero(valores.copia_bn), copia_color: entero(valores.copia_color),
      },
      cuentas: null,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. xml-estado · estado del equipo en XML (plotters y equipos con servicio web)
// ---------------------------------------------------------------------------
const escaparXml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const desescaparXml = (s) => String(s).replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const xmlEstado = {
  extension: 'xml',
  mime: 'application/xml',

  generar({ maquina, estado, fechaCorte, contadores }) {
    const codigo = estadoEsOk(estado) ? 'OK' : 'ERROR';
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<InformeEquipo version="1.0">',
      `  <Equipo serie="${escaparXml(maquina.serie)}" ip="${escaparXml(maquina.ip)}" modelo="${escaparXml(maquina.modelo)}"/>`,
      `  <Estado codigo="${codigo}">${escaparXml(estado)}</Estado>`,
      `  <FechaCorte>${isoCorto(fechaCorte)}:00</FechaCorte>`,
      '  <Contadores>',
      `    <Contador tipo="impresion" color="bn">${contadores.impresion_bn}</Contador>`,
      `    <Contador tipo="impresion" color="color">${contadores.impresion_color}</Contador>`,
      `    <Contador tipo="copia" color="bn">${contadores.copia_bn}</Contador>`,
      `    <Contador tipo="copia" color="color">${contadores.copia_color}</Contador>`,
      '  </Contadores>',
      '</InformeEquipo>',
    ].join('\r\n') + '\r\n';
  },

  reconocer: (texto) => texto.includes('<InformeEquipo'),

  leer(texto) {
    const atributo = (etiqueta, nombre) => {
      const m = texto.match(new RegExp(String.raw`<${etiqueta}[^>]*\s${nombre}="([^"]*)"`));
      return m ? desescaparXml(m[1]) : undefined;
    };
    const contador = (tipo, color) => {
      const m = texto.match(new RegExp(`<Contador tipo="${tipo}" color="${color}">([^<]*)</Contador>`));
      if (!m) throw new Error(`Falta el contador ${tipo} ${color} en el XML`);
      return entero(m[1]);
    };
    const estado = (texto.match(/<Estado[^>]*>([^<]*)<\/Estado>/) || [])[1];
    const fecha = (texto.match(/<FechaCorte>([^<]*)<\/FechaCorte>/) || [])[1] || '';
    return {
      formato: 'xml-estado',
      serie: atributo('Equipo', 'serie'),
      ip: atributo('Equipo', 'ip'),
      modelo: atributo('Equipo', 'modelo'),
      estado: estado ? desescaparXml(estado) : undefined,
      fechaCorte: fecha.slice(0, 16),
      contadores: {
        impresion_bn: contador('impresion', 'bn'), impresion_color: contador('impresion', 'color'),
        copia_bn: contador('copia', 'bn'), copia_color: contador('copia', 'color'),
      },
      cuentas: null,
    };
  },
};

const FORMATOS = {
  'csv-cuentas': csvCuentas,
  'texto-contadores': textoContadores,
  'xml-estado': xmlEstado,
};

// Detecta el formato por el contenido, no por el nombre del archivo (como haría n8n)
function leerReporte(texto) {
  const entrada = Object.entries(FORMATOS).find(([, f]) => f.reconocer(texto));
  if (!entrada) throw new Error('Formato de reporte desconocido');
  const reporte = entrada[1].leer(texto);
  if (!reporte.serie || !reporte.ip) throw new Error(`Reporte ${entrada[0]} sin serie o sin IP`);
  return reporte;
}

module.exports = { FORMATOS, leerReporte, estadoEsOk };
