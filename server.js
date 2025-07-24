// ── src/server.js ──

app.post('/api/checkout', async (req, res) => {
-  const { docId, nombreSolicitante, email, tipo } = req.body;
-  if (!docId || !nombreSolicitante || !email || !tipo) {
-    return res.status(400).json({ error: 'Faltan datos requeridos (incluye docId, nombreSolicitante, email, tipo)' });
-  }
+  const { docId, tipo } = req.body;
+  if (!docId || !tipo) {
+    return res.status(400).json({ error: 'docId y tipo son requeridos' });
+  }

  try {
    // 1️⃣ Actualiza sólo los campos que de verdad cambian
    await db.collection('estudios').doc(docId).update({
-      nombreSolicitante,
-      email,
      tipo,
      fecha: new Date(),
      status: 'pendiente_pago'
    });

    // 2️⃣ Crea la sesión en Stripe
    const precios = { estandar: 50000, urgente: 80000 };
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: `Estudio ${tipo}` },
          unit_amount: precios[tipo]
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url:   'https://saxmexico.com/compra',
      cancel_url:    'https://saxmexico.com/',
      metadata:      { docId }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('❌ Error en /api/checkout:', err);
    return res.status(500).json({ error: 'Error al procesar el pago' });
  }
});
