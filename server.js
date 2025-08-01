// server.js
import 'dotenv/config'
import path from 'path'
import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import Stripe from 'stripe'
import { admin, db, bucket, FieldValue } from './firebase.js'

const stripe = Stripe(process.env.STRIPE_SECRET_KEY)
const app = express()
const PORT = process.env.PORT || 3001

// 1) Confía en proxy para IP real
app.set('trust proxy', true)

// 2) CORS — solo rutas de API
app.use(cors({
  origin: [
    'https://frontend-sax-clientes.onrender.com',
    'https://clientes.saxmexico.com'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: true
}))

// 3) JSON parser (excepto webhook)
app.use((req, res, next) => {
  if (req.path === '/webhook') return next()
  express.json()(req, res, next)
})

// 4) Rutas de API
app.use(
  '/api/estudios',
  (await import('./routes/estudios.js')).default({ db, bucket, FieldValue })
)

app.post('/api/checkout', async (req, res) => {
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
        cac:      (cac || 0).toString()
      }
    })
    return res.json({ checkoutUrl: session.url })
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err)
    return res.status(500).json({ error: 'Error al procesar el pago' })
  }
})

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error('⚠️ Webhook invá
