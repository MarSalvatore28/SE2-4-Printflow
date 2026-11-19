const { validarDatosLecturaManual } = require('@utils/lecturaManual.reglas');
const { registrarLecturaManual } = require('@models/lectura/lectura.model');

// POST /api/lecturas/manual (S3-04)
const registrarLecturaManualController = async (req, res) => {
  const { error, data } = validarDatosLecturaManual(req.body);
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  try {
    const lectura = await registrarLecturaManual(req.pool, data, req.user.id);
    res.status(201).json({ success: true, message: 'Lectura manual registrada', data: lectura });
  } catch (err) {
    if (err.esNegocio) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        ...(err.codigo ? { codigo: err.codigo } : {}),
      });
    }
    console.error('Error al registrar la lectura manual:', err);
    res.status(500).json({ success: false, message: 'Error al registrar la lectura manual' });
  }
};

module.exports = { registrarLecturaManualController };
