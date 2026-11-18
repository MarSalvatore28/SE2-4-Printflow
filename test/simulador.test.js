// Simulador del flujo de correo: los 3 formatos se leen igual que se escriben y el
// correo se convierte en el cuerpo que espera POST /api/ingesta/cargar.
const test = require('node:test');
const assert = require('node:assert');
const { FORMATOS, leerReporte } = require('../simulador/lib/formatos');
const { crearCorreo, leerCorreo } = require('../simulador/lib/correo');
const { correoAIngesta } = require('../simulador/lib/n8n');
const { contadoresAlCierre, repartirPorUsuario } = require('../simulador/lib/escenario');

const maquina = {
  serie: 'SIMT0001', ip: '10.0.0.1', modelo: 'Equipo de prueba «ñ»',
  contador_inicial: { impresion_bn: 1000, impresion_color: 200, copia_bn: 50, copia_color: 5 },
  consumo_mensual: { impresion_bn: 300, impresion_color: 40, copia_bn: 20, copia_color: 2 },
};
const fechaCorte = new Date(Date.UTC(2026, 9, 31, 23, 0, 0));
const contadores = { impresion_bn: 1234, impresion_color: 56, copia_bn: 78, copia_color: 9 };
const cuentas = repartirPorUsuario(contadores, [
  { cuenta: '1', nombre: 'Ana', peso: 2 },
  { cuenta: '2', nombre: 'Luis', peso: 1 },
]);

for (const [nombre, formato] of Object.entries(FORMATOS)) {
  test(`formato ${nombre}: se lee lo mismo que se escribió`, () => {
    const texto = formato.generar({ maquina, estado: 'Lista', fechaCorte, contadores, cuentas });
    const r = leerReporte(texto);
    assert.equal(r.formato, nombre);
    assert.equal(r.serie, maquina.serie);
    assert.equal(r.ip, maquina.ip);
    assert.equal(r.fechaCorte, '2026-10-31T23:00');
    assert.deepEqual(r.contadores, contadores);
  });
}

test('el reparto por usuario suma exactamente el total de la máquina', () => {
  for (const campo of Object.keys(contadores)) {
    assert.equal(cuentas.reduce((s, c) => s + c[campo], 0), contadores[campo]);
  }
});

test('los contadores son acumulados y reproducibles', () => {
  const sep = contadoresAlCierre(maquina, '2026-09', '2026-01');
  const oct = contadoresAlCierre(maquina, '2026-10', '2026-01');
  assert.deepEqual(contadoresAlCierre(maquina, '2026-10', '2026-01'), oct);
  for (const campo of Object.keys(oct)) assert.ok(oct[campo] > sep[campo], `${campo} debe crecer`);
});

test('un correo se convierte en un lote con su message_id y el detalle por usuario', () => {
  const eml = crearCorreo({
    de: '"Impresoras" <impresoras@cliente.example>', para: 'buzon@printflow.example',
    asunto: 'Reporte de contadores 2026-10 · Cliente', fecha: fechaCorte, messageId: '<prueba-1@printflow.example>',
    cuerpo: 'Reporte de prueba',
    adjuntos: [
      { nombre: 'a.csv', mime: 'text/csv', contenido: FORMATOS['csv-cuentas'].generar({ maquina, estado: 'Lista', fechaCorte, contadores, cuentas }) },
      { nombre: 'b.txt', mime: 'text/plain', contenido: FORMATOS['texto-contadores'].generar({ maquina: { ...maquina, serie: 'SIMT0002' }, estado: 'Error de comunicación', fechaCorte, contadores }) },
    ],
  });
  const correo = leerCorreo(eml);
  assert.equal(correo.asunto, 'Reporte de contadores 2026-10 · Cliente');

  const { lote, items } = correoAIngesta(correo);
  assert.deepEqual(lote, {
    codigo_referencia: 'SIM-2026-10-cliente', periodo: '2026-10', fecha_carga: '2026-10-31', message_id: '<prueba-1@printflow.example>',
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].consolidado.bn_total, contadores.impresion_bn + contadores.copia_bn);
  assert.equal(items[0].detalles.length, 2);
  assert.equal(items[0].consolidado.procesar_lectura, true);
  assert.equal(items[1].detalles.length, 0);
  assert.equal(items[1].consolidado.procesar_lectura, false, 'un equipo con falla no debe procesar su lectura');
});
