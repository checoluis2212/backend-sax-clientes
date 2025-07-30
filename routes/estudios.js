// src/routes/estudios.js
const express = require('express');
const multer  = require('multer');

module.exports = ({ db, bucket }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      const { nombreCandidato, ciudad, puesto } = req.body;
      const file = req.file;

      let cvUrl = '';
      if (file) {
        const fileName = `cv/${Date.now()}_${file.originalname}`;
        const fileRef = bucket.file(fileName);
        await fileRef.save(file.buffer, { metadata: { contentType: file.mimetype } });
        const [url] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-01-2030'
        });
        cvUrl = url;
      }

      // Crea el documento en Firestore
      const docRef = await db.collection('estudios').add({
        nombreCandidato,
        ciudad,
        puesto,
        cvUrl,
        timestamp: new Date(),
        status: 'pendiente_pago'
      });

      // Aquí devolvemos un 200 correcto
      return res.status(200).json({
        docId: docRef.id,
        cvUrl
      });
    } catch (err) {
      console.error('❌ Error guardando estudio:', err);
      // Ahora devolvemos un 500 cuando falle
      return res.status(500).json({
        error: err.message
      });
    }
  });

  return router;
};
