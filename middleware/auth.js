// src/middleware/auth.js
const { admin } = require('../firebase');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ ok: false, error: 'No token provided' });
  }

  const idToken = match[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid   = decoded.uid;
    req.email = decoded.email;
    next();
  } catch (err) {
    console.error('❌ Auth error:', err);
    res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
};
