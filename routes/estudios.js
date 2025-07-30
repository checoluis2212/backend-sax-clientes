// src/routes/estudios.js
const express = require('express');
const multer  = require('multer');

module.exports = ({ db, bucket, FieldValue }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      // 1) Destructure del body
      const {
        visitorId,
        nombre, apellido, empresa,
        telefono, email,
        nombreSolicitante,
        nombreCandidato, ciudad, puesto,
        tipo
      } = req.body;

      if (!visitorId) {
        return res.status(400).json({ ok: false, error: 'visitorId es obligatorio' });
      }

      // 2) Si llega un archivo CV, súbelo y obtén su URL
      let cvUrl = '';
      if (req.file) {
        const fileName = `cv/${visitorId}/${Date.now()}_${req.file.originalname}`;
        const fileRef = bucket.file(fileName);
        await fileRef.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype }
        });
        const [url] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-01-2030'
        });
        cvUrl = url;
      }

      // 3) Construye formData solo con campos definidos
      const raw = {
        nombre, apellido, empresa,
        telefono, email,
        nombreSolicitante,
        nombreCandidato, ciudad, puesto,
        tipo
      };
      const formData = Object.fromEntries(
        Object.entries(raw).filter(([_, v]) => v !== undefined && v !== '')
      );

      // 4) Prepara el objeto que vamos a guardar
      const submission = {
        timestamp: new Date(),
        formData,
        cvUrl
      };

      // 5) Upsert en Firestore usando visitorId como ID de doc
      const userRef = db.collection('estudios').doc(visitorId);
      await userRef.set({
        visitorId,
        submissions: FieldValue.arrayUnion(submission)
      }, { merge: true });

      // 6) Responde OK
      return res.status(200).json({ ok: true, cvUrl });
    } catch (err) {
      console.error('Error en POST /api/estudios:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
