// src/firebase.js
require('dotenv').config();
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const db         = admin.firestore();
const bucket     = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;

module.exports = { admin, db, bucket, FieldValue };
