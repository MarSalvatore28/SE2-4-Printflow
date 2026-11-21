// Revisa que el .env tenga las variables obligatorias antes de arrancar la API.
//
// En producción (NODE_ENV=production) además se niega a arrancar con una SECRET_KEY corta (con
// ella se firman los JWT: si es adivinable, cualquiera fabrica un token de admin) o sin
// INGESTA_TOKEN. `npm run configurar` genera las dos con la longitud necesaria.
const OBLIGATORIAS = ['DB_PASSWORD', 'SECRET_KEY'];
const OBLIGATORIAS_EN_PRODUCCION = ['INGESTA_TOKEN'];
const MIN_SECRET_KEY = 32;

const GENERAR = 'Genera una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))" (o npm run configurar)';

// Devuelve la lista de problemas del entorno (vacía si todo está bien)
function revisarEnv(env = process.env) {
  const produccion = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const obligatorias = produccion ? [...OBLIGATORIAS, ...OBLIGATORIAS_EN_PRODUCCION] : OBLIGATORIAS;
  const faltan = obligatorias.filter((nombre) => !String(env[nombre] || '').trim());
  const problemas = [];
  if (faltan.length > 0) problemas.push(`Falta ${faltan.join(' y ')} en el .env. Revisa el .env.example.`);

  const largo = String(env.SECRET_KEY || '').trim().length;
  if (produccion && largo > 0 && largo < MIN_SECRET_KEY) {
    problemas.push(`SECRET_KEY es demasiado corta para producción (${largo} caracteres; mínimo ${MIN_SECRET_KEY}). ${GENERAR}`);
  }
  return problemas;
}

function validarEnv(env = process.env) {
  const problemas = revisarEnv(env);
  if (problemas.length > 0) {
    problemas.forEach((p) => console.error(p));
    console.error('La API no arranca hasta corregirlo.');
    process.exit(1);
  }
}

module.exports = { validarEnv, revisarEnv, MIN_SECRET_KEY };
