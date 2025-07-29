// src/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const Stripe  = require('stripe');

// ——— DEBUG: imprimimos las env vars críticas —————————
console.log('→ STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY);
console.log('→ STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET);
console.log('→ GA4_MEASUREMENT_ID:', process.env.GA4_MEASUREMENT_ID);
console.log('→ GA4_API_SECRET:', process.env.GA4_API_SECRET);
console.log('→ FRONTEND_URL:', process.env.FRONTEND_URL);
// —————————————————————————————————————————————————————————

const { db, bucket } = require('./firebase');

// Inicializa Stripe con tu clave secreta
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Crea la app de Express
const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARES ────────────────────────────────────────

// 1) CORS: permite orígenes y métodos necesarios
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// 2) JSON parser (salta solo la ruta /webhook para raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  express.json()(req, res, next);
});

// ─── RUTAS ───────────────────────────────────────────────

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Servidor corriendo correctamente 🚀');
});

// Router de estudios (POST para crear/PUT para actualizar)
const estudiosRouter = require('./routes/estudios')({ db, bucket });
app.use('/api/estudios', estudiosRouter);

// ─── CHECKOUT STRIPE ───────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { docId, tipo } = req.body;
  if (!docId || !tipo) {
    return res.status(400).json({ error: 'docId y tipo son requeridos' });
  }

  try {
    await db.collection('estudios').doc(docId).update({
      tipo,
      fecha: new Date(),
      status: 'pendiente_pago'
    });

    const precios = { estandar: 50000, urgente: 80000 };
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: `Estudio ${tipo}` },
          unit_amount: precios[tipo]
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url:   'https://saxmexico.com/compra',
      cancel_url:    'https://saxmexico.com/',
      metadata:      { docId }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err);
    return res.status(500).json({ error: 'Error al procesar el pago' });
  }
});

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
      const session = event.data.object;
      const docId = session.metadata?.docId;
      if (!docId) {
        console.warn('⚠️ Falta docId en metadata');
        return res.status(400).send('Falta docId en metadata');
      }
      try {
        await db.collection('estudios').doc(docId).update({
          status: 'pagado',
          stripeSessionId: session.id,
          pago_completado: new Date()
        });
        console.log(`✅ Estudio ${docId} marcado como pagado`);
      } catch (e) {
        console.error('❌ Error actualizando Firestore:', e);
        return res.status(500).send('Error actualizando Firestore');
      }
    }

    return res.status(200).send('Evento recibido');
  }
);

// ─── INICIO DEL SERVIDOR ──────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`);
});
