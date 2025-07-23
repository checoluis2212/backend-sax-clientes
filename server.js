// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

// Importa tu helper de Firebase (exporta { db, bucket })
const { db, bucket } = require('./firebase');

// Inicializa Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Crea la app de Express
const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARES ────────────────────────────────────────
// CORS
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// JSON parser (salta solo la ruta /webhook)
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  express.json()(req, res, next);
});

// ─── RUTAS ───────────────────────────────────────────────
// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Servidor corriendo correctamente 🚀');
});

// Monta tu router de estudios pasando { db, bucket }
const estudiosRouter = require('./routes/estudios')({ db, bucket });
app.use('/api/estudios', estudiosRouter);

// ─── CHECKOUT STRIPE (actualiza, no crea) ────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { docId, nombreSolicitante, email, tipo } = req.body;
  const precios = { estandar: 50000, urgente: 80000 };

  // Validación básica
  if (!docId || !nombreSolicitante || !email || !tipo) {
    return res.status(400).json({ error: 'Faltan datos requeridos (incluye docId)' });
  }

  try {
    // 1️⃣ Actualiza el documento existente
    await db.collection('estudios').doc(docId).update({
      nombreSolicitante,
      email,
      tipo,
      fecha: new Date(),
      status: 'pendiente_pago'
    });

    // 2️⃣ Crea la sesión de Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: {
            name: `Estudio ${tipo}`,
            description: `Solicitante: ${nombreSolicitante}`
          },
          unit_amount: precios[tipo]
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: email,
      success_url: 'https://saxmexico.com/compra',
      cancel_url: 'https://saxmexico.com/',
      metadata: { docId }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err);
    return res.status(500).json({ error: 'Error al procesar el pago' });
  }
});

// ─── WEBHOOK STRIPE ─────────────────────────────────────
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

// ─── INICIA SERVIDOR ────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`);
});
