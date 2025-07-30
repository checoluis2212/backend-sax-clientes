// src/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const Stripe  = require('stripe');
const { admin, db, bucket } = require('./firebase');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app    = express();
const PORT   = process.env.PORT || 3001;

// ─── MIDDLEWARES ────────────────────────────────────────
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
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
    // 1) Actualiza el estudio
    const estudioRef  = db.collection('estudios').doc(docId);
    const estudioSnap = await estudioRef.get();
    const estudioData = estudioSnap.data();
    const updates = {
      status: 'pendiente_pago',
      tipo,
      fecha:  admin.firestore.FieldValue.serverTimestamp()
    };
    if (clientId && !estudioData.clientId) {
      updates.clientId = clientId;
    }
    await estudioRef.update(updates);

    // 2) Crea la sesión de Stripe
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
      success_url: `https://saxmexico.com/compra`,
      cancel_url:  `https://saxmexico.com/404`,
      metadata: {
        docId,
        clientId: clientId || '',
        cac:      (cac || 0).toString()
      }
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
      const sess     = event.data.object;
      const docId    = sess.metadata.docId;
      const clientId = sess.metadata.clientId;
      const amount   = (sess.amount_total || 0) / 100;
      const txId     = sess.payment_intent;

      // ── 1) Actualiza el estudio ─────────────────────────
      const ref  = db.collection('estudios').doc(docId);
      const snap = await ref.get();
      const data = snap.data();
      const estudioUpdates = {
        lastPurchaseDate:  admin.firestore.FieldValue.serverTimestamp(),
        totalRevenue:      admin.firestore.FieldValue.increment(amount),
        status:            'pagado',
        stripeSessionId:   txId,
        pago_completado:   admin.firestore.FieldValue.serverTimestamp()
      };
      if (!data.firstPurchaseDate) {
        estudioUpdates.firstPurchaseDate = admin.firestore.FieldValue.serverTimestamp();
      }
      await ref.update(estudioUpdates);

      // ── 2) Gestiona la colección “customers” ────────────
      if (clientId) {
        const custRef  = db.collection('customers').doc(clientId);
        const custSnap = await custRef.get();
        if (!custSnap.exists) {
          await custRef.set({
            clientId,
            firstPurchaseDate: admin.firestore.FieldValue.serverTimestamp(),
            lastPurchaseDate:  admin.firestore.FieldValue.serverTimestamp(),
            totalRevenue:      amount,
            purchaseCount:     1
          });
        } else {
          await custRef.update({
            lastPurchaseDate: admin.firestore.FieldValue.serverTimestamp(),
            totalRevenue:     admin.firestore.FieldValue.increment(amount),
            purchaseCount:    admin.firestore.FieldValue.increment(1)
          });
        }
      }

      // ── 3) (Opcional) Envía evento a GA4 ───────────────
      const mpUrl = `https://www.google-analytics.com/mp/collect` +
        `?measurement_id=${process.env.GA4_MEASUREMENT_ID}` +
        `&api_secret=${process.env.GA4_API_SECRET}`;
      const payload = {
        client_id: clientId || txId,
        events: [{
          name: 'purchase',
          params: {
            transaction_id: txId,
            value:          amount,
            currency:       sess.currency.toUpperCase()
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
