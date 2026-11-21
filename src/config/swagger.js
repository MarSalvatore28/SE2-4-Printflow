const swaggerJsDoc = require('swagger-jsdoc');

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'PrintFlow API',
            version: '1.0.0',
            description: 'API de PrintFlow. Para probar: POST /api/auth/login con un usuario de prueba, copia el token de la respuesta y pégalo en «Authorize» (sin la palabra Bearer). Guía completa: docs/probar.md del backend.',
        },
        // Relativo: «Try it out» llama a la misma dirección de esta página (http://localhost:8080 en Docker).
        servers: [
            {
                url: '/',
                description: 'Esta misma dirección',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ['./src/routes/**/*.js', './src/app.js', './src/documentation/API/**/*.js'],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

module.exports = swaggerDocs;
