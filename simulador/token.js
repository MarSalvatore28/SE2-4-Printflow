#!/usr/bin/env node
// Inicia sesión con un usuario de prueba y muestra su token, listo para Postman, Swagger o la terminal.
//
//   npm run token                     (admin, contra http://localhost:8080)
//   npm run token -- operador
//   npm run token -- auditor --solo   (solo el token, para guardarlo en una variable)
//   (sin Node instalado) docker compose run --rm simulador token.js operador
//
// Opciones: --url <dirección de la API>, --email <correo>, --clave <contraseña>.
// El token dura 30 minutos sin uso. Si vence o ves «Token inválido», vuelve a pedir uno.

const ROLES = ['admin', 'operador', 'auditor'];

const leerOpciones = (argumentos) => {
  const opciones = { rol: 'admin', solo: false };
  for (let i = 0; i < argumentos.length; i += 1) {
    const arg = argumentos[i];
    if (arg === '--solo') opciones.solo = true;
    else if (arg === '--url') opciones.url = argumentos[++i];
    else if (arg === '--email') opciones.email = argumentos[++i];
    else if (arg === '--clave') opciones.clave = argumentos[++i];
    else if (ROLES.includes(arg)) opciones.rol = arg;
    else throw new Error(`No entiendo «${arg}». Usa: admin, operador o auditor (y opcionalmente --solo, --url, --email, --clave).`);
  }
  return {
    url: (opciones.url || process.env.API_URL || 'http://localhost:8080').replace(/\/$/, ''),
    email: opciones.email || `${opciones.rol}@printflow.local`,
    clave: opciones.clave || process.env.DEMO_PASSWORD || 'Printflow2026*',
    solo: opciones.solo,
  };
};

const pedirToken = async ({ url, email, clave }) => {
  let respuesta;
  try {
    respuesta = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: clave }),
    });
  } catch {
    throw new Error(`La API no responde en ${url}. ¿Levantaste el sistema con «docker compose up -d --build»?`);
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 401) {
    throw new Error(`Credenciales incorrectas para ${email}. Si cambiaron la contraseña, pásala con --clave. Si la base es vieja, recréala: docker compose down -v`);
  }
  if (!respuesta.ok || !datos.token) {
    throw new Error(`El login respondió HTTP ${respuesta.status}: ${datos.message || 'sin mensaje'}`);
  }
  return datos;
};

const main = async () => {
  const opciones = leerOpciones(process.argv.slice(2));
  const { token, usuario } = await pedirToken(opciones);

  if (opciones.solo) {
    console.log(token);
    return;
  }

  const rol = usuario.rol?.nombre || usuario.rol || '?';
  console.log(`Sesión iniciada como ${usuario.email} (rol: ${rol}). El token dura 30 min sin uso.\n`);
  console.log(token);
  console.log(`
Cómo usarlo:
  Postman  · importa docs/postman/PrintFlow.postman_collection.json y ejecuta «Iniciar sesión»:
             guarda el token solo. O pega este en Authorization → Bearer Token.
  Swagger  · ${opciones.url}/api-docs → botón «Authorize» → pega el token (sin la palabra Bearer).
  PowerShell:
    $h = @{ Authorization = "Bearer <token>" }
    Invoke-RestMethod ${opciones.url}/api/auth/perfil -Headers $h
  curl:
    curl -H "Authorization: Bearer <token>" ${opciones.url}/api/auth/perfil`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}

module.exports = { leerOpciones };
