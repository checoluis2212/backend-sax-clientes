const express = require('express');
const multer  = require('multer');

module.exports = ({ db, bucket, FieldValue }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      const {
        visitorId,
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

      // 🔹 Obtener IP real (Render + proxy)
      const ipCliente =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        null;

      const clientRef = db.collection('clientes').doc(visitorId);
      const clientSnap = await clientRef.get();
      const now = new Date().toISOString();

      // ─── 1) Crear cliente si no existe ─────────────
      if (!clientSnap.exists) {
        await clientRef.set({
          clientId: visitorId,
          fechaRegistro: now,
          firstPurchase: null,
          lastPurchase: null,
          pago_completado: false,
          stripeSessionId: null,
          ip: ipCliente,
          firstSource: source || 'direct',
          firstMedium: medium || 'none',
          firstCampaign: campaign || 'none',
          totalRevenue: 0,
          totalSolicitudes: 0,
          solicitudesPagadas: 0,
          solicitudesNoPagadas: 0
        });
      }

      // ─── 2) Verificar duplicado ────────────────────
      const duplicateSnap = await clientRef.collection('submissions')
        .where('nombreCandidato', '==', nombreCandidato)
        .where('puesto', '==', puesto)
        .where('statusPago', '==', 'no_pagado')
        .limit(1)
        .get();

      if (!duplicateSnap.empty) {
        const existingDoc = duplicateSnap.docs[0];
        return res.json({
          ok: true,
          docId: existingDoc.id,
          cvUrl: existingDoc.data().cvUrl
        });
      }

      // ─── 3) Subir CV ───────────────────────────────
      let cvUrl = '';
      if (req.file) {
        const fileName = `cvs/${visitorId}_${Date.now()}_${req.file.originalname}`;
        const file = bucket.file(fileName);
        await file.save(req.file.buffer, { contentType: req.file.mimetype });
        await file.makePublic(); // 🔹 Permitir descarga
        cvUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      }

      // ─── 4) Crear submission ───────────────────────
      const submissionRef = clientRef.collection('submissions').doc();
      await submissionRef.set({
        cvUrl,
        formData: { ciudad, nombreCandidato, puesto },
        nombreCandidato, // 🔹 Campos planos para queries
        puesto,          // 🔹 Campos planos para queries
        statusPago: 'no_pagado',
        source: source || 'direct',
        medium: medium || 'none',
        campaign: campaign || 'none',
        amount: amount || 0,
        timestamp: now
      });

      // ─── 5) Actualizar métricas cliente ────────────
      await clientRef.update({
        totalSolicitudes: FieldValue.increment(1),
        solicitudesNoPagadas: FieldValue.increment(1)
      });

      // ─── 6) Respuesta ──────────────────────────────
      res.json({ ok: true, docId: submissionRef.id, cvUrl });

    } catch (error) {
      console.error('❌ Error en /api/estudios:', error);
      res.status(500).json({ ok: false, error: 'Error guardando la solicitud' });
    }
  });

  return router;
};
