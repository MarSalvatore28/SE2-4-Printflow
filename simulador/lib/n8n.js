// Lo que hacía el flujo n8n de DOX, en código: toma un correo del buzón, lee cada
// adjunto (detecta el formato por su contenido) y arma el cuerpo que espera
// POST /api/ingesta/cargar. Un correo = un cliente y un mes = un lote.

const { leerReporte, estadoEsOk } = require('./formatos');

// "impresoras@andina.example" -> "andina"
function codigoRemitente(de) {
  const correo = (de.match(/<([^>]+)>/) || [null, de])[1].trim().toLowerCase();
  const dominio = correo.split('@')[1] || 'desconocido';
  return dominio.split('.')[0];
}

// Convierte un correo leído (lib/correo.leerCorreo) en { lote, items, avisos }
function correoAIngesta(correo) {
  if (!correo.messageId) throw new Error('El correo no tiene Message-ID');
  if (correo.adjuntos.length === 0) throw new Error('El correo no trae adjuntos');

  const avisos = [];
  const reportes = correo.adjuntos.map((adjunto) => {
    try {
      return leerReporte(adjunto.contenido);
    } catch (error) {
      throw new Error(`Adjunto ${adjunto.nombre}: ${error.message}`);
    }
  });

  const periodo = reportes[0].fechaCorte.slice(0, 7);
  const lote = {
    codigo_referencia: `SIM-${periodo}-${codigoRemitente(correo.de)}`,
    periodo,
    fecha_carga: reportes[0].fechaCorte.slice(0, 10),
    message_id: correo.messageId,
  };

  const items = reportes.map((r) => {
    const c = r.contadores;
    const ok = estadoEsOk(r.estado);
    if (!ok) avisos.push(`${r.serie}: el equipo reportó «${r.estado}»; su lectura queda bloqueada`);

    const [fecha, hora] = r.fechaCorte.split('T');
    return {
      lote_info: lote,
      consolidado: {
        serie_maquina: r.serie,
        ip_detectada: r.ip,
        // Contadores acumulados del equipo al corte
        print_total: c.impresion_bn + c.impresion_color + c.copia_bn + c.copia_color,
        copy_total: c.copia_bn + c.copia_color,
        bn_total: c.impresion_bn + c.copia_bn,
        color_total: c.impresion_color + c.copia_color,
        estado_maquina: r.estado || 'Desconocido',
        procesar_lectura: ok,
        mensaje_aviso: ok ? null : `El equipo reportó: ${r.estado}`,
      },
      // Solo los equipos con contabilidad por cuenta traen detalle por usuario
      detalles: (r.cuentas || []).map((cta) => ({
        cuenta_id: cta.cuenta,
        usuario_trabajo: cta.nombre,
        fecha_transaccion: fecha,
        hora_transaccion: `${hora}:00`,
        print_diario: cta.impresion_bn + cta.impresion_color,
        copy_diario: cta.copia_bn + cta.copia_color,
        impresion_bn: cta.impresion_bn,
        impresion_color: cta.impresion_color,
        copia_bn: cta.copia_bn,
        copia_color: cta.copia_color,
        ip_detectada: r.ip,
      })),
    };
  });

  return { lote, items, avisos, reportes };
}

module.exports = { correoAIngesta, codigoRemitente };
