// src/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const Stripe  = require('stripe');
const admin   = require('firebase-admin');
const { db, bucket } = require('./firebase');

// Inicializar Firebase Admin si no lo has hecho ya en otro sitio:
// admin.initializeApp({ credential: admin.credential.applicationDefault() });

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3001;

// …middlewares igual que antes…

// ─── WEBHOOK STRIPE ───────────────────────────────────────
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook inválido:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session       = event.data.object;
      const docId         = session.metadata?.docId;
      const transactionId = session.payment_intent;
      const amount        = session.amount_total / 100;
      const currency      = session.currency.toUpperCase();

      if (!docId) {
        console.warn('⚠️ Falta docId en metadata');
        return res.status(400).send('Falta docId en metadata');
      }

      const estudioRef = db.collection('estudios').doc(docId);

      // 1) Obtenemos el documento para leer firstPurchaseDate
      const snap = await estudioRef.get();
      if (!snap.exists) {
        console.error('❌ Documento no existe:', docId);
        return res.status(404).send('Documento no encontrado');
      }
      const data = snap.data();

      // 2) Preparamos los campos a actualizar
      const updates = {};
      // Solo la primera vez
      if (!data.firstPurchaseDate) {
        updates.firstPurchaseDate = admin.firestore.FieldValue.serverTimestamp();
      }
      // Siempre actualizamos último movimiento
      updates.lastPurchaseDate  = admin.firestore.FieldValue.serverTimestamp();
      // Acumulamos el revenue
      updates.totalRevenue      = admin.firestore.FieldValue.increment(amount);
      // Cambiamos estado y guardamos meta
      updates.status            = 'pagado';
      updates.stripeSessionId   = transactionId;
      updates.pago_completado   = admin.firestore.FieldValue.serverTimestamp();

      // 3) Aplicamos la actualización
      try {
        await estudioRef.update(updates);
        console.log(`✅ Firestore actualizado LTV para estudio ${docId}`);
      } catch (e) {
        console.error('❌ Error actualizando Firestore:', e);
        return res.status(500).send('Error actualizando Firestore');
      }

      // 4) Enviar evento “purchase” a GA4
      const mpUrl = `https://www.google-analytics.com/mp/collect`
        + `?measurement_id=${process.env.GA4_MEASUREMENT_ID}`
        + `&api_secret=${process.env.GA4_API_SECRET}`;
      const mpPayload = {
        client_id: transactionId,
        events: [{
          name: 'purchase',
          params: {
            transaction_id: transactionId,
            value: amount,
            currency
          }
        }]
      };
      try {
        const resp = await fetch(mpUrl, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(mpPayload)
        });
        console.log(resp.status === 204
          ? '✅ Evento “purchase” enviado a GA4'
          : '❌ Error GA4:', await resp.text());
      } catch (e) {
        console.error('❌ Falló envío a GA4:', e);
      }
    }

    // 5) Respondemos rápido a Stripe
    res.status(200).send('Evento recibido');
  }
);

// … arranque del servidor igual que antes …
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`);
});
