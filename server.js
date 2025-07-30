// src/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const Stripe  = require('stripe');
const { admin, db, bucket } = require('./firebase');

// Inicializa Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARES ────────────────────────────────────────
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// JSON parser, excepto en /webhook
app.use((req, res, next) => {
  if (req.path === '/webhook') return next();
  express.json()(req, res, next);
});

// ─── RUTAS DE ESTUDIOS ───────────────────────────────────
const estudiosRouter = require('./routes/estudios')({ db, bucket });
app.use('/api/estudios', estudiosRouter);

// ─── RUTA DE CHECKOUT ────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { docId, tipo, clientId, cac } = req.body;
  if (!docId || !tipo) {
    return res.status(400).json({ error: 'docId y tipo son requeridos' });
  }

  try {
    // Marca pendiente de pago
    await db.collection('estudios').doc(docId).update({
      status: 'pendiente_pago',
      tipo,
      fecha: admin.firestore.FieldValue.serverTimestamp()
    });

    // Crea sesión de Stripe
    const precios = { estandar: 50000, urgente: 80000 };
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: `Estudio: ${tipo}` },
          unit_amount: precios[tipo] || precios.estandar
        },
        quantity: 1
      }],
      mode: 'payment',
      // ← Aquí cambiasremos la ruta de éxito a /compra
      success_url: `${process.env.FRONTEND_URL}/compra?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.FRONTEND_URL}/`,
      metadata: { docId, client_id: clientId||'', cac: (cac||0).toString() }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err);
    return res.status(500).json({ error: 'Error al procesar el pago' });
  }
});

// ─── WEBHOOK DE STRIPE ───────────────────────────────────
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook inválido:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const sess  = event.data.object;
      const docId = sess.metadata.docId;
      const amount = (sess.amount_total||0) / 100;
      const txId   = sess.payment_intent;

      if (!docId) {
        console.warn('⚠️ Falta docId en metadata');
        return res.status(400).send('Missing docId');
      }

      const ref  = db.collection('estudios').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) {
        console.error('❌ Documento no existe:', docId);
        return res.status(404).send('Not found');
      }
      const data = snap.data();

      // Prepara actualizaciones de LTV
      const updates = {
        lastPurchaseDate:  admin.firestore.FieldValue.serverTimestamp(),
        totalRevenue:      admin.firestore.FieldValue.increment(amount),
        status:            'pagado',
        stripeSessionId:   txId,
        pago_completado:   admin.firestore.FieldValue.serverTimestamp()
      };
      if (!data.firstPurchaseDate) {
        updates.firstPurchaseDate = admin.firestore.FieldValue.serverTimestamp();
      }

      try {
        await ref.update(updates);
        console.log('✅ Firestore LTV updated for', docId);
      } catch (e) {
        console.error('❌ Error updating Firestore:', e);
        return res.status(500).send('Firestore error');
      }

      // Enviar evento “purchase” a GA4 (opcional)
      const mpUrl = `https://www.google-analytics.com/mp/collect` +
        `?measurement_id=${process.env.GA4_MEASUREMENT_ID}` +
        `&api_secret=${process.env.GA4_API_SECRET}`;
      const payload = {
        client_id: sess.metadata.client_id || txId,
        events: [{
          name: 'purchase',
          params: {
            transaction_id: txId,
            value: amount,
            currency: sess.currency.toUpperCase()
          }
        }]
      };
      try {
        const r = await fetch(mpUrl, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        console.log(r.status===204 ? '✅ GA4 event sent' : '❌ GA4 error', await r.text());
      } catch (e) {
        console.error('❌ GA4 send failed:', e);
      }
    }

    res.status(200).send('OK');
  }
);

// ─── RUTA HOME ───────────────────────────────────────────
app.get('/', (_req, res) => res.send('🚀 Server up!'));

// ─── START SERVER ────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
