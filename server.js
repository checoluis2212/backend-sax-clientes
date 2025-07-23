require('dotenv').config()
const express = require('express')
const cors = require('cors')
const Stripe = require('stripe')
const admin = require('firebase-admin')

const stripe = Stripe(process.env.STRIPE_SECRET_KEY)
const db = require('./firebase')
const estudiosRouter = require('./routes/estudios')

const app = express()
const PORT = process.env.PORT || 3001

// ─── MIDDLEWARES ────────────────────────────────────────
app.use(cors({
  origin: 'https://frontend-sax-clientes.onrender.com', // permite solo este frontend
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
// Usa express.json(), excepto para /webhook que necesita express.raw()
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next()
  express.json()(req, res, next)
})
// ────────────────────────────────────────────────────────

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Servidor corriendo correctamente 🚀')
})

// Ruta para guardar desde React (opcional)
app.use('/api/estudios', estudiosRouter)

// ─── CHECKOUT STRIPE ────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const form = req.body
  console.log('🧾 Formulario recibido en /checkout:', form)
  const precios = { estandar: 50000, urgente: 80000 }

  // Validar mínimo necesario
  if (!form.nombreSolicitante || !form.email || !form.nombreCandidato || !form.tipo) {
    return res.status(400).json({ error: 'Faltan datos requeridos' })
  }

  try {
    // 1. Guardar todo el formulario
    const docRef = await db.collection('estudios').add({
      ...form,
      fecha: new Date(),
      status: 'pendiente_pago'
    })

    // 2. Crear sesión de pago con referencia al documento
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
      success_url: `https://saxmexico.com/compra`,
      cancel_url: `https://saxmexico.com/`,
      metadata: {
        docId: docRef.id // Enlace directo al documento
      }
    })

    res.json({ checkoutUrl: session.url })
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err)
    res.status(500).json({ error: 'Error al procesar el pago' })
  }
})
// ────────────────────────────────────────────────────────

// ─── WEBHOOK STRIPE ─────────────────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('⚠️ Webhook inválido:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const docId = session.metadata?.docId

    if (!docId) {
      console.warn('⚠️ No se encontró docId en metadata')
      return res.status(400).send('Falta docId en metadata')
    }

    try {
      const ref = db.collection('estudios').doc(docId)

      await ref.update({
        status: 'pagado',
        stripeSessionId: session.id,
        pago_completado: new Date()
      })

      console.log(`✅ Estudio ${docId} marcado como pagado`)
    } catch (e) {
      console.error('❌ Error actualizando Firestore:', e)
      return res.status(500).send('Error actualizando Firestore')
    }
  }

  res.status(200).send('Evento recibido')
})
// ────────────────────────────────────────────────────────

// ─── INICIAR SERVIDOR ───────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`)
})
