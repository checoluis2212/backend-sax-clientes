// src/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const Stripe  = require('stripe');

// Firebase Admin SDK helper (debe exportar { db, bucket })
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
  // Sólo necesitamos docId y tipo para esta ruta
  const { docId, tipo } = req.body;

  // Validación mínima
  if (!docId || !tipo) {
    return res.status(400).json({ error: 'docId y tipo son requeridos' });
  }

  try {
    // 1) Marca el estudio como pendiente de pago
    await db.collection('estudios').doc(docId).update({
      tipo,
      fecha: new Date(),
      status: 'pendiente_pago'
    });

    // 2) Crea la sesión de Stripe Checkout
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

    // 3) Devuelve la URL de redirección
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
      // Verifica firma y parsea evento
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook inválido:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Si se completó el pago…
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const docId = session.metadata?.docId;
      if (!docId) {
        console.warn('⚠️ Falta docId en metadata');
        return res.status(400).send('Falta docId en metadata');
      }
      try {
        // Marca el estudio como pagado
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

    // Agradece a Stripe
    return res.status(200).send('Evento recibido');
  }
);

// ─── INCIO DEL SERVIDOR ─────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`);
});
