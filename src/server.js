require('module-alias/register');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
require('./config/validarEnv').validarEnv();
const app = require('./app');

const http = require('node:http');
const { init } = require('./socket');

const PORT = process.env.PORT;

const server = http.createServer(app);
init(server);

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});