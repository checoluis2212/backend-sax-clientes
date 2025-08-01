// src/routes/estudios.js
const express         = require('express');
const multer          = require('multer');
const authMiddleware  = require('../middleware/auth');

module.exports = ({ db, bucket, FieldValue }) => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  // ────────────────────────────────
  // 🔹 Crear estudio (protegido)
  // ────────────────────────────────
  router.post(
    '/',
    authMiddleware,           // ← Solo usuarios autenticados
    upload.single('cv'),
    async (req, res) => {
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
          await file.save(req.file.buffer, { contentType
