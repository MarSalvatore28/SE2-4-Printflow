// Revisa que el .env tenga las variables obligatorias antes de arrancar la API.
const OBLIGATORIAS = ['DB_PASSWORD', 'SECRET_KEY'];

function validarEnv() {
  const faltan = OBLIGATORIAS.filter((nombre) => !process.env[nombre]);
  if (faltan.length > 0) {
    console.error(`Falta ${faltan.join(' y ')} en el .env. Revisa el .env.example.`);
    process.exit(1);
  }
}

module.exports = { validarEnv };
