#!/usr/bin/env node
// Crea o completa el .env para desarrollo local, sin pedirle claves a nadie.
//
//   npm run configurar
//   (sin Node instalado) docker run --rm -v "${PWD}:/app" -w /app node:22-slim node scripts/configurar.js
//
// - Si no hay .env, lo crea a partir de .env.example.
// - Llena con valores aleatorios las claves que estén vacías: DB_PASSWORD, SECRET_KEY e INGESTA_TOKEN.
// - Agrega al final las variables nuevas de .env.example que todavía no estén en tu .env.
// - Nunca cambia un valor que ya tenga contenido, y nunca muestra las claves en pantalla.
//
// Cada integrante tiene sus propias claves. No se comparten ni se suben al repo: el .env está en .gitignore.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Claves que se generan solas y su largo en bytes (el texto sale en hexadecimal, el doble de caracteres).
const CLAVES_GENERADAS = {
  DB_PASSWORD: 24,
  SECRET_KEY: 48,
  INGESTA_TOKEN: 32,
};

const LINEA_VARIABLE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

const generarClave = (bytes) => crypto.randomBytes(bytes).toString('hex');

const leerVariables = (texto) => {
  const variables = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    const coincidencia = LINEA_VARIABLE.exec(linea);
    if (coincidencia) variables.set(coincidencia[1], coincidencia[2].trim());
  }
  return variables;
};

// Función pura: recibe el texto de .env.example y el del .env actual (o null si no existe)
// y devuelve el .env completo, más la lista de lo que cambió (solo nombres, nunca valores).
const completarEnv = (textoEjemplo, textoActual, generar = generarClave) => {
  const base = textoActual ?? textoEjemplo;
  const generadas = [];

  const lineas = base.split(/\r?\n/).map((linea) => {
    const coincidencia = LINEA_VARIABLE.exec(linea);
    if (!coincidencia) return linea;
    const [, nombre, valor] = coincidencia;
    if (CLAVES_GENERADAS[nombre] && valor.trim() === '') {
      generadas.push(nombre);
      return `${nombre}=${generar(CLAVES_GENERADAS[nombre])}`;
    }
    return linea;
  });

  const agregadas = [];
  if (textoActual !== null && textoActual !== undefined) {
    const actuales = leerVariables(textoActual);
    for (const [nombre, valor] of leerVariables(textoEjemplo)) {
      if (actuales.has(nombre)) continue;
      if (CLAVES_GENERADAS[nombre] && valor === '') {
        generadas.push(nombre);
        agregadas.push(`${nombre}=${generar(CLAVES_GENERADAS[nombre])}`);
      } else {
        agregadas.push(`${nombre}=${valor}`);
      }
    }
  }

  while (lineas.length > 0 && lineas.at(-1) === '') lineas.pop();
  if (agregadas.length > 0) {
    lineas.push('', '# Agregadas por npm run configurar (estaban en .env.example y faltaban aquí)', ...agregadas);
  }

  return {
    texto: `${lineas.join('\n')}\n`,
    generadas,
    agregadas: agregadas.map((linea) => linea.split('=')[0]),
  };
};

const main = () => {
  const raiz = path.resolve(__dirname, '..');
  const rutaEjemplo = path.join(raiz, '.env.example');
  const rutaEnv = path.join(raiz, '.env');

  const textoEjemplo = fs.readFileSync(rutaEjemplo, 'utf8');
  const existia = fs.existsSync(rutaEnv);
  const textoActual = existia ? fs.readFileSync(rutaEnv, 'utf8') : null;

  const { texto, generadas, agregadas } = completarEnv(textoEjemplo, textoActual);

  if (existia && texto === textoActual) {
    console.log('Tu .env ya estaba completo: no cambié nada.');
    return;
  }

  fs.writeFileSync(rutaEnv, texto);
  console.log(existia ? 'Completé tu .env.' : 'Creé el .env a partir de .env.example.');
  if (generadas.length > 0) console.log(`  Claves nuevas generadas al azar: ${generadas.join(', ')}`);
  if (agregadas.length > 0) console.log(`  Variables que faltaban: ${agregadas.join(', ')}`);
  if (existia && generadas.includes('DB_PASSWORD')) {
    console.log('  Ojo: la base ya creada tiene otra contraseña. Recréala con: docker compose down -v');
  }
  console.log('Siguiente paso: docker compose up -d --build');
};

if (require.main === module) main();

module.exports = { completarEnv, CLAVES_GENERADAS };
