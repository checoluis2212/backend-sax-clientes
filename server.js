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
app.use(cors())

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

// Monta el router personalizado
app.use('/api/estudios', estudiosRouter)

// ─── RUTA DE CHECKOUT ───────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { nombre, ciudad, puesto, tipo, email, visitorId } = req.body
  const precios = { estandar: 50000, urgente: 80000 }

  if (!nombre || !ciudad || !puesto || !tipo || !email) {
    return res.status(400).json({ error: 'Faltan datos requeridos' })
  }

  try {
    await db.collection('estudios').add({
      nombre,
      ciudad,
      puesto,
      tipo,
      email,
      visitorId,
      fecha: new Date(),
      status: 'pendiente_pago'
    })

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: {
            name: `Estudio ${tipo}`,
            description: `Candidato: ${nombre}, Ciudad: ${ciudad}, Puesto: ${puesto}`
          },
          unit_amount: precios[tipo]
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `https://saxmexico.com/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://saxmexico.com/`,
      metadata: { nombre, ciudad, puesto, tipo, visitorId }
    })

    res.json({ checkoutUrl: session.url })
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err)
    res.status(500).json({ error: 'Error al procesar el pago' })
  }
})
// ────────────────────────────────────────────────────────

// ─── WEBHOOK DE STRIPE ──────────────────────────────────
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
    const { nombre, ciudad, puesto, tipo, visitorId } = session.metadata

    try {
      const snap = await db.collection('estudios')
        .where('nombre', '==', nombre)
        .where('ciudad', '==', ciudad)
        .where('puesto', '==', puesto)
        .where('tipo', '==', tipo)
        .where('visitorId', '==', visitorId)
        .where('status', '==', 'pendiente_pago')
        .orderBy('fecha', 'desc')
        .limit(1)
        .get()

      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: 'pagado',
          stripeSessionId: session.id,
          pago_completado: new Date()
        })
        console.log('✅ Estudio marcado como pagado')
      } else {
        console.warn('⚠️ No se encontró estudio pendiente')
      }
    } catch (e) {
      console.error('❌ Error actualizando Firestore:', e)
    }
  }

  res.status(200).send('Evento recibido')
})
// ────────────────────────────────────────────────────────

// Inicia el servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend escuchando en http://0.0.0.0:${PORT}`)
})
