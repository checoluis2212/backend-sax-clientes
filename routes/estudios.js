// src/routes/estudios.js
const express = require('express');
const multer = require('multer');

module.exports = ({ db, bucket }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      const { /* otros campos del form */ nombreCandidato, ciudad, puesto } = req.body;
      const file = req.file;

      let cvUrl = '';
      if (file) {
        const fileName = `cv/${Date.now()}_${file.originalname}`;
        const fileRef = bucket.file(fileName);
        await fileRef.save(file.buffer, { metadata: { contentType: file.mimetype } });
        const [url] = await fileRef.getSignedUrl({ action: 'read', expires: '03-01-2030' });
        cvUrl = url;
      }

      // 1️⃣ Aquí creas el documento **sólo una vez**
      const docRef = await db.collection('estudios').add({
        nombreCandidato,
        ciudad,
        puesto,
        cvUrl,
        timestamp: new Date(),
        status: 'pendiente_pago'
      });

      // 2️⃣ Devuelves el ID al frontend
      return res.status(200).json({
        ok: true,
        docId: docRef.id,
        cvUrl
      });
    } catch (err) {
      console.error('Error guardando estudio:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
