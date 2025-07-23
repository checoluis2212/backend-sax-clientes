// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

// 1️⃣ Importa tu helper de Firebase (exporta { db, bucket })
const { db, bucket } = require('./firebase');

// 2️⃣ Inicializa Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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

// JSON body parser (salta el webhook que usa raw)
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  express.json()(req, res, next);
});

// ─── RUTAS ───────────────────────────────────────────────
// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Servidor corriendo correctamente 🚀');
});

// 3️⃣ Monta tu router de estudios pasando la instancia de db y bucket
const estudiosRouter = require('./routes/estudios')({ db, bucket });
app.use('/api/estudios', estudiosRouter);

// ─── CHECKOUT STRIPE ────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const form = req.body;
  const precios = { estandar: 50000, urgente: 80000 };

  if (!form.nombreSolicitante || !form.email || !form.nombreCandidato || !form.tipo) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    // Guarda el formulario en Firestore
    const docRef = await db.collection('estudios').add({
      ...form,
      fecha: new Date(),
      status: 'pendiente_pago'
    });

    // Crea la sesión de Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: {
            name: `Estudio ${form.tipo}`,
            description: `Solicitante: ${form.nombreSolicitante}, Candidato: ${form.nombreCandidato}`
          },
          unit_amount: precios[form.tipo]
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: form.email,
      success_url: 'https://saxmexico.com/compra',
      cancel_url: 'https://saxmexico.com/',
      metadata: { docId: docRef.id }
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err);
    res.status(500).json({ error: 'Error al procesar el pago' });
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
      con
