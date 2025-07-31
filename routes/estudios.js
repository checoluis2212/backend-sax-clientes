const express = require('express');
const multer  = require('multer');

module.exports = ({ db, bucket, FieldValue }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      console.log('📥 Body recibido:', req.body);
      console.log('📄 Archivo recibido:', req.file?.originalname);

      const {
        visitorId,
        nombreCandidato,
        ciudad,
        puesto,
        source,
        medium,
        campaign,
        amount
      } = req.body;

      if (!visitorId) {
        console.warn('⚠️ Falta visitorId');
        return res.status(400).json({ ok: false, error: 'visitorId es obligatorio' });
      }

      // 🔹 IP del cliente
      const ipCliente =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        null;
      console.log('🌐 IP Cliente:', ipCliente);

      const clientRef = db.collection('clientes').doc(visitorId);
      const clientSnap = await clientRef.get();
      const now = new Date();

      // ─── Crear cliente si no existe ─────────────
      if (!clientSnap.exists) {
        console.log('🆕 Creando cliente nuevo');
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

      // ─── Prevenir duplicados recientes ─────────
      const unaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
      const duplicateSnap = await clientRef.collection('submissions')
        .where('nombreCandidato', '==', nombreCandidato)
        .where('puesto', '==', puesto)
        .where('statusPago', '==', 'no_pagado')
        .where('timestamp', '>=', unaHoraAtras)
        .limit(1)
        .get();

      if (!duplicateSnap.empty) {
        console.warn('⚠️ Duplicado detectado');
        const existingDoc = duplicateSnap.docs[0];
        return res.json({
          ok: true,
          docId: existingDoc.id,
          cvUrl: existingDoc.data().cvUrl
        });
      }

      // ─── Subir CV ───────────────────────────────
      let cvUrl = '';
      if (req.file) {
        try {
          const fileName = `cvs/${visitorId}_${Date.now()}_${req.file.originalname}`;
          const file = bucket.file(fileName);
          await file.save(req.file.buffer, { contentType: req.file.mimetype });
          await file.makePublic();
          cvUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        } catch (err) {
          console.error('❌ Error subiendo CV:', err);
          return res.status(500).json({ ok: false, error: 'Error subiendo CV' });
        }
      }

      // ─── Crear submission ───────────────────────
      const submissionRef = clientRef.collection('submissions').doc();
      await submissionRef.set({
        cvUrl,
        formData: { ciudad, nombreCandidato, puesto },
        nombreCandidato,
        puesto,
        statusPago: 'no_pagado',
        source: source || 'direct',
        medium: medium || 'none',
        campaign: campaign || 'none',
        amount: Number(amount) || 0,
        timestamp: now
      });

      // ─── Actualizar métricas cliente ────────────
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

  return router;
};
