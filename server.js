// src/server.js
require('dotenv').config()
const path    = require('path')
const express = require('express')
const cors    = require('cors')
const fetch   = require('node-fetch')
const Stripe  = require('stripe')
const { admin, db, bucket, FieldValue } = require('./firebase')

const stripe = Stripe(process.env.STRIPE_SECRET_KEY)
const app    = express()
const PORT   = process.env.PORT || 3001

// ─── 1) Trust proxy para obtener IP real detrás de proxy ─────────────
app.set('trust proxy', true)

// ─── 2) CORS — solo para API y webhook ───────────────────────────────
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','x-api-key'],
  credentials: true
}))

// ─── 3) JSON parser (excepto webhook) ────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/webhook') return next()
  express.json()(req, res, next)
})

// ─── 3.5) Middleware de autenticación con API Key ─────────────────────
const apiKeyAuth = (req, res, next) => {
  const key = req.headers['x-api-key']
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Acceso no autorizado' })
  }
  next()
}

// ─── 4a) Rutas de estudios socioeconómicos (protegidas) ──────────────
app.use(
  '/api/estudios',
  apiKeyAuth,
  require('./routes/estudios')({ db, bucket, FieldValue })
)

// ─── 4b) Crear sesión de pago (protegida) ────────────────────────────
app.post('/api/checkout', apiKeyAuth, async (req, res) => {
  const { docId, tipo, clientId, cac } = req.body
  if (!docId || !tipo) {
    return res.status(400).json({ error: 'docId y tipo son requeridos' })
  }
  try {
    const precios = { estandar: 50000, urgente: 80000 }
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
      success_url: `https://clientes.saxmexico.com/?pagado=true`,
      cancel_url:  `https://clientes.saxmexico.com/?cancelado=true`,
      metadata: {
        docId,
        clientId: clientId || '',
        cac:      String(cac || 0)
      }
    })
    res.json({ checkoutUrl: session.url })
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err)
    res.status(500).json({ error: 'Error al pr
