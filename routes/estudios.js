// src/routes/estudios.js

require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const Stripe  = require('stripe');
const { admin, db, bucket } = require('../firebase');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = () => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  /**
   * POST /api/estudios
   * 1) Sube el CV (si existe) a Cloud Storage
   * 2) Crea el documento en Firestore con status 'pendiente_pago'
   * 3) Inicia una sesión de Stripe Checkout (incluye client_id y cac en metadata)
   * 4) Devuelve { docId, cvUrl, checkoutUrl }
   */
  router.post('/', upload.single('cv'), async (req, res) => {
    try {
      // 1) Extraer datos del formulario
      const {
        nombreCandidato,
        ciudad,
        puesto,
        clientId,   // opcional: tu GA4 client_id
        cac         // opcional: coste de adquisición
      } = req.body;

      // 2) Subir CV a Storage (si viene)
      let cvUrl = '';
      if (req.file) {
        const fileName = `cv/${Date.now()}_${req.file.originalname}`;
        const fileRef  = bucket.file(fileName);
        await fileRef.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype }
        });
        const [url] = await fileRef.getSignedUrl({
          action:  'read',
          expires: '03-01-2030'
        });
        cvUrl = url;
      }

      // 3) Crear doc en Firestore
      const docRef = await db.collection('estudios').add({
        nombreCandidato,
        ciudad,
        puesto,
        cvUrl,
        timestamp:           admin.firestore.FieldValue.serverTimestamp(),
        status:              'pendiente_pago',
        firstPurchaseDate:   null,
        lastPurchaseDate:    null,
        totalRevenue:        0,
        cacAccumulated:      0
      });

      // 4) Iniciar Stripe Checkout
      const precios = { estandar: 50000, urgente: 80000 };
      const tipo     = req.body.tipo || 'estandar';
      const session  = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'mxn',
            product_data: { name: `Estudio socioeconómico: ${puesto}` },
            unit_amount: precios[tipo] || precios.estandar
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${process.env.FRONTEND_URL}/cancel`,
        metadata: {
          docId:       docRef.id,
          client_id:   clientId || '',
          cac:         cac ? cac.toString() : '0'
        }
      });

      // 5) Responder al frontend
      return res.status(200).json({
        ok:          true,
        docId:       docRef.id,
        cvUrl,
        checkoutUrl: session.url
      });
    } catch (err) {
      console.error('❌ Error en POST /api/estudios:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
