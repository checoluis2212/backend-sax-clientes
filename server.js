require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const Stripe  = require('stripe');
const { admin, db, bucket, FieldValue } = require('./firebase');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app    = express();
const PORT   = process.env.PORT || 3001;

// ─── CONFIGURACIÓN PROXY PARA IP REAL ───────────────────
app.set('trust proxy', true);

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

// ─── RUTA DE ESTUDIOS (modularizada) ────────────────────
const estudiosRouter = require('./routes/estudios')({ db, bucket, FieldValue });
app.use('/api/estudios', estudiosRouter);

// ─── RUTA DE CHECKOUT ───────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { docId, tipo, clientId, cac } = req.body;
  console.log('📥 Checkout body:', req.body);

  if (!docId || !tipo) {
    return res.status(400).json({ error: 'docId y tipo son requeridos' });
  }

  try {
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

// ─── WEBHOOK DE STRIPE ──────────────────────────────────
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

      const clientRef = db.collection('clientes').doc(clientId);

      // ── 1) Actualizar submission ─────────────────
      await clientRef.collection('submissions').doc(docId).update({
        statusPago: 'pagado'
      });

      // ── 2) Actualizar métricas cliente ───────────
      const clientSnap = await clientRef.get();
      const clientData = clientSnap.data();
      await clientRef.update({
        pago_completado: true,
        lastPurchase: admin.firestore.FieldValue.serverTimestamp(),
        stripeSessionId: txId,
        solicitudesPagadas: FieldValue.increment(1),
        solicitudesNoPagadas: FieldValue.increment(-1),
        totalRevenue: FieldValue.increment(amount),
        ...(clientData.firstPurchase ? {} : { firstPurchase: admin.firestore.FieldValue.serverTimestamp() })
      });

      // ── 3) Evento GA4 opcional ──────────────────
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

// ─── RUTA HOME ──────────────────────────────────────────
app.get('/', (_req, res) => res.send('🚀 Server up!'));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
