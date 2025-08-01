// server.js
require('dotenv').config();
const path    = require('path');
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

// ─── CORS ────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,    // p.ej. https://clientes.saxmexico.com
    'http://localhost:5173',     // tu dev de Vite
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: true
}));

// ─── MIDDLEWARE PARA JSON (excepto /webhook) ────────────
app.use((req, res, next) => {
  if (req.path === '/webhook') return next();
  express.json()(req, res, next);
});

// ─── RUTAS DE API ────────────────────────────────────────
const estudiosRouter = require('./routes/estudios')({ db, bucket, FieldValue });
app.use('/api/estudios', estudiosRouter);

app.post('/api/checkout', async (req, res) => {
  // … tu lógica de checkout …
});

// Stripe webhook
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // … tu lógica de webhook …
  }
);

// ─── SERVIR BUILD DE VITE ───────────────────────────────
// Ajusta 'dist' si tu salida de Vite es diferente (por defecto es 'dist')
const clientDist = path.join(__dirname, 'dist');
app.use(express.static(clientDist));

// ─── CATCH-ALL PARA SPA ────────────────────────────────
// Cualquier ruta no /api ni /webhook devuelve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── ERROR HANDLER GLOBAL ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Error global:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── LEVANTAR SERVIDOR ───────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
