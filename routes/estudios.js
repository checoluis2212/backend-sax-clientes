const express = require('express');
const multer  = require('multer');

module.exports = ({ db, bucket, FieldValue }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  // ────────────────────────────────
  // 🔹 Crear estudio
  // ────────────────────────────────
  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      const {
        visitorId,
        nombreCandidato, ciudad, puesto,
        source, medium, campaign,
        amount
      } = req.body;

      if (!visitorId) {
        return res.status(400).json({ ok: false, error: 'visitorId es obligatorio' });
      }

      // 🔹 IP real
      const ipCliente =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        null;

      const clientRef = db.collection('clientes').doc(visitorId);
      const clientSnap = await clientRef.get();
      const now = new Date().toISOString();

      // Crear cliente si no existe
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

      // 🔹 Evitar duplicado
      const duplicateSnap = await clientRef.collection('submissions')
        .where('formData.nombreCandidato', '==', nombreCandidato)
        .where('formData.puesto', '==', puesto)
        .where('statusPago', '==', 'no_pagado')
        .limit(1)
        .get();

      if (!duplicateSnap.empty) {
        const existingDoc = duplicateSnap.docs[0];
        return res.json({ ok: true, docId: existingDoc.id, cvUrl: existingDoc.data().cvUrl });
      }

      // 🔹 Subir CV
      let cvUrl = '';
      let cvPath = '';
      if (req.file) {
        cvPath = `cvs/${visitorId}_${Date.now()}_${req.file.originalname}`;
        const file = bucket.file(cvPath);
        await file.save(req.file.buffer, { contentType: req.file.mimetype });
        await file.makePublic();
        cvUrl = `https://storage.googleapis.com/${bucket.name}/${cvPath}`;
      }

      // Crear submission
      const submissionRef = clientRef.collection('submissions').doc();
      await submissionRef.set({
        cvUrl,
        cvPath,
        formData: { ciudad, nombreCandidato, puesto },
        statusPago: 'no_pagado',
        source: source || 'direct',
        medium: medium || 'none',
        campaign: campaign || 'none',
        amount: amount || 0,
        timestamp: now
      });

      // Actualizar métricas cliente
      await clientRef.update({
        totalSolicitudes: FieldValue.increment(1),
        solicitudesNoPagadas: FieldValue.increment(1)
      });

      res.json({ ok: true, docId: submissionRef.id, cvUrl });

    } catch (error) {
      console.error('❌ Error en /api/estudios:', error);
      res.status(500).json({ ok: false, error: 'Error guardando la solicitud' });
    }
  });

  // ────────────────────────────────
  // 🔹 Borrar solicitud
  // ────────────────────────────────
  router.delete('/:clientId/:docId', async (req, res) => {
    try {
      const { clientId, docId } = req.params;
      const clientRef = db.collection('clientes').doc(clientId);
      const submissionRef = clientRef.collection('submissions').doc(docId);

      // Obtener submission para eliminar CV también
      const snap = await submissionRef.get();
      const submissionData = snap.data();
      if (submissionData?.cvPath) {
        try {
          await bucket.file(submissionData.cvPath).delete();
          console.log(`✅ CV eliminado de storage: ${submissionData.cvPath}`);
        } catch (err) {
          console.warn(`⚠️ No se pudo eliminar el CV: ${err.message}`);
        }
      }

      // Eliminar submission
      await submissionRef.delete();

      // Si no quedan más submissions → borrar cliente
      const remaining = await clientRef.collection('submissions').get();
      if (remaining.empty) {
        await clientRef.delete();
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('❌ Error eliminando solicitud:', e);
      res.status(500).json({ ok: false, error: 'Error eliminando solicitud' });
    }
  });

  return router;
};
