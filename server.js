// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

// 1️⃣ Importa tu helper de Firebase (ya inicializa y exporta { db, bucket })
const { db, bucket } = require('./firebase');

// 2️⃣ Inicializa Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// 3️⃣ Crea la app
const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARES ────────────────────────────────────────
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// JSON parser (salta webhook raw)
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  express.json()(req, res, next);
}));

// ─── RUTAS ───────────────────────────────────────────────
// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Servidor corriendo correctamente 🚀');
});

// Monta **una sola vez** tu router de estudios, pasándole { db, bucket }
const estudiosRouter = require('./routes/estudios')({ db, bucket });
app.use('/api/estudios', estudiosRouter);

// ─── CHECKOUT STRIPE ────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  // … tu lógica de checkout aquí …
});

// ─── WEBHOOK STRIPE ─────────────────────────────────────
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // … tu lógica de webhook aquí …
  }
);

// ─── INICIA SERVIDOR ────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`);
});
