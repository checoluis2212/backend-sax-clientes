// src/routes/estudios.js
const express = require('express');
const multer = require('multer');

module.exports = ({ db, bucket }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      const form = req.body;
      const file = req.file;
      let cvUrl = '';

      // Si llega un CV, lo subes al bucket
      if (file) {
        const fileName = `cv/${Date.now()}_${file.originalname}`;
        const fileRef = bucket.file(fileName);

        await fileRef.save(file.buffer, {
          metadata: { contentType: file.mimetype }
        });

        const [url] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-01-2030'
        });

        cvUrl = url;
      }

      // Guardas el documento en Firestore
      await db.collection('estudios').add({
        ...form,
        cvUrl,
        timestamp: new Date(),
        status: 'pendiente_pago'
      });

      res.status(200).json({
        message: 'Estudio guardado con CV',
        cvUrl
      });
    } catch (err) {
      console.error('❌ Error guardando estudio:', err);
      res.status(500).json({ error: 'Error al guardar en Firestore' });
    }
  });

  return router;
};
