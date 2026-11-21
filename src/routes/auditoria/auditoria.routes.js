const express = require('express');
const router = express.Router();
const { requireRole } = require('@middlewares/role.middleware');
const { listarAuditoriaController } = require('@controllers/auditoria/auditoria.controller');

/**
 * @swagger
 * /api/auditoria:
 *   get:
 *     summary: Consultar la bitácora de cambios (S3-02)
 *     description: >
 *       Quién cambió qué, cuándo y desde qué IP: contratos, asignaciones (instalaciones), reemplazos
 *       (maquinas_cambio), aprobación y rechazo de lotes (lotes_carga), usuarios, lecturas manuales
 *       (reportes_oficiales) y reprocesos (reportes_consolidado_staging). Cada registro trae la fila
 *       antes (valor_anterior) y después (valor_nuevo) del cambio, nunca contraseñas.
 *       Del más nuevo al más viejo. Solo admin.
 *     tags: [Auditoría]
 *     parameters:
 *       - in: query
 *         name: tabla
 *         schema:
 *           type: string
 *           enum: [contratos, instalaciones, maquinas_cambio, lotes_carga, usuarios, reportes_oficiales, reportes_consolidado_staging]
 *       - in: query
 *         name: id_registro
 *         description: Clave primaria del registro en esa tabla (exige tabla)
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limite
 *         description: Máximo de registros (100 por defecto, hasta 500)
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *     responses:
 *       200:
 *         description: Registros de la bitácora
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer }
 *                       tabla: { type: string, example: lotes_carga }
 *                       id_registro: { type: integer, example: 3 }
 *                       accion: { type: string, enum: [CREAR, ACTUALIZAR, ACTIVAR, DESACTIVAR, RETIRAR, APROBAR, RECHAZAR, REPROCESAR] }
 *                       fecha: { type: string, format: date-time }
 *                       ip: { type: string, example: 172.18.0.1 }
 *                       usuario_id: { type: integer }
 *                       usuario_email: { type: string }
 *                       usuario_nombre: { type: string }
 *                       valor_anterior: { type: object, nullable: true }
 *                       valor_nuevo: { type: object, nullable: true }
 *       400:
 *         description: Filtro inválido (tabla fuera de la lista, id_registro sin tabla o no numérico)
 *       401:
 *         description: Sin token
 *       403:
 *         description: El rol no es admin (operador y auditor)
 */
router.get('/', requireRole('admin'), listarAuditoriaController);

module.exports = router;
