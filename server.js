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
  methods: ['GET','POST','OPTIONS','DELETE'],
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
    res.status(500).json({ error: 'Error al procesar el pago' })
  }
})

// ─── 4c) Webhook de Stripe (NO requiere API Key) ─────────────────────
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
      console.error('⚠️ Webhook inválido:', err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    if (event.type === 'checkout.session.completed') {
      const sess     = event.data.object
      const { docId, clientId } = sess.metadata
      const amount   = (sess.amount_total || 0) / 100
      const txId     = sess.payment_intent

      // — Actualizar Firestore —
      try {
        const clientRef = db.collection('clientes').doc(clientId)
        await clientRef.collection('submissions').doc(docId)
          .update({ statusPago: 'pagado' })

        const snap = await clientRef.get()
        const data = snap.data() || {}

        await clientRef.update({
          pago_completado: true,
          lastPurchase: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionId: txId,
          solicitudesPagadas: FieldValue.increment(1),
          solicitudesNoPagadas: FieldValue.increment(-1),
          totalRevenue: FieldValue.increment(amount),
          ...(data.firstPurchase
            ? {}
            : { firstPurchase: admin.firestore.FieldValue.serverTimestamp() })
        })
      } catch (e) {
        console.error('❌ Error actualizando Firestore:', e)
      }

      // — Enviar evento a GA4 —
      try {
        const mpUrl = `https://www.google-analytics.com/mp/collect` +
          `?measurement_id=${process.env.GA4_MEASUREMENT_ID}` +
          `&api_secret=${process.env.GA4_API_SECRET}`

        const payload = {
          client_id: clientId || txId,
          events: [{
            name: 'purchase',
            params: {
              transaction_id: txId,
              value:          amount,
              currency:       sess.currency.toUpperCase()
            }
          }]
        }

        const r = await fetch(mpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        console.log(
          r.status === 204 ? '✅ GA4 event sent' : '❌ GA4 error',
          await r.text()
        )
      } catch (e) {
        console.error('❌ GA4 send failed:', e)
      }
    }

    res.status(200).send('OK')
  }
)

// ─── 5) Servir build de Vite (dist/ en la raíz) ─────────────────────
const clientDist = path.join(__dirname, '..', 'dist')
console.log('⭐️ Servir estáticos desde:', clientDist)

app.use(express.static(clientDist))

// ─── 6) Catch-all para SPA (excluye /api/* y /webhook) ─────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/webhook') {
    return next()
  }
  res.sendFile(path.join(clientDist, 'index.html'))
})

// ─── 7) Manejador de errores global ────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Error global:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

// ─── 8) Arrancar servidor ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`)
})
