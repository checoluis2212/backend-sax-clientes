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

// 1) Trust proxy para IP real
app.set('trust proxy', true)

// 2) CORS — solo en /api y /webhook
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: true
}))

// 3) JSON parser excepto webhook
app.use((req, res, next) => {
  if (req.path === '/webhook') return next()
  express.json()(req, res, next)
})

// 4) Rutas de API
app.use(
  '/api/estudios',
  require('./routes/estudios')({ db, bucket, FieldValue })
)

app.post('/api/checkout', /* …igual que antes… */)
app.post('/webhook', /* …igual que antes… */)

// 5) Sirve tu build de Vite (que está en /dist EN LA RAÍZ)
const clientDist = path.join(__dirname, '..', 'dist')
app.use(express.static(clientDist))

// 6) Catch-all SPA (solo rutas que no empiecen con /api o /webhook)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/webhook') {
    return next()
  }
  res.sendFile(path.join(clientDist, 'index.html'))
})

// 7) Manejador de errores
app.use((err, req, res, next) => {
  console.error('🔥 Global error:', err)
  res.status(500).json({ error: 'Error interno' })
})

// 8) Arranca
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`)
})
