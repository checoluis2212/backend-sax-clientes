const express = require('express');
const router = express.Router();
const db = require('../firebase');

router.post('/', async (req, res) => {
  const data = req.body;

  try {
    await db.collection('estudios').add({
      ...data,
      timestamp: new Date(),
    });

    res.status(200).json({ message: 'Estudio guardado en Firestore' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar en Firestore' });
  }
});

module.exports = router;
