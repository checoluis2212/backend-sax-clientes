const express = require('express');
const multer  = require('multer');

module.exports = ({ db, bucket, FieldValue }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      const {
        visitorId, // clientId
        nombre, apellido, empresa,
        telefono, email,
        nombreSolicitante,
        nombreCandidato, ciudad, puesto,
        tipo,
        source, medium, campaign,
        amount
      } = req.body;

      if (!visitorId) {
        return res.status(400).json({ ok: false, error: 'visitorId es obligatorio' });
      }

      // 🔹 Obtener IP real del cliente
      const ipCliente =
        req.headers['x-forwarded-for']?.split(',').shift()?.trim() ||
        req.socket?.remoteAddress ||
        null;

      // ─── 1) Subir CV si existe ─────────────────────
      let cvUrl = '';
      if (req.file) {
        const fileName = `cvs/${visitorId}_${Date.now()}_${req.file.originalname}`;
        const file = bucket.file(fileName);
        await file.save(req.file.buffer, { contentType: req.file.mimetype });
        cvUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      }

      const clientRef = db
