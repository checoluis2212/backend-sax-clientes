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

// ─── CONFÍA EN PROXY PARA IP REAL ────────────────────────
app.set('trust proxy', true);

// ─── CORS ────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: true
}));

// ─── PARSEO JSON (excepto /webhook) ───────────────────────
app.use((req, res, next) => {
  if (req.path === '/webhook') return next();
  express.json()(req, res, next);
});

// ─── RUTA DE ESTUDIOS ────────────────────────────────────
const estudiosRouter = require('./routes/estudios')({ db, bucket, FieldValue });
app.use('/api/estudios', estudiosRouter);

// ─── RUTA DE CHECKOUT ────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  // … TU LÓGICA DE CHECKOUT (igual que antes) …
});

// ─── WEBHOOK DE STRIPE ───────────────────────────────────
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // … TU LÓGICA DE WEBHOOK (igual que antes) …
  }
);

// ─── SERVIR ESTÁTICOS DE VITE ────────────────────────────
const clientDist = path.join(__dirname, 'dist');
app.use(express.static(clientDist));

// ─── CATCH-ALL PARA SPA ─────────────────────────────────
app.get('/*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── RUTA HOME (puedes eliminarla si no la usas) ─────────
app.get('/', (_req, res) => res.send('🚀 Server up!'));

// ─── HANDLER DE ERRORES GLOBAL ──────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Error global:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── LEVANTAR SERVIDOR ───────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
