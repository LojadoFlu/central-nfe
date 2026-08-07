import type { FirebaseOptions } from "firebase/app";

/**
 * Config do Firebase (projeto DEDICADO da Central NF-e), lida de env públicas.
 * Preencha em `.env.local` (veja `.env.local.example`).
 * Nenhum segredo aqui — só identificadores públicos.
 */
export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Região das Cloud Functions. */
export const REGIAO_FUNCTIONS =
  process.env.NEXT_PUBLIC_FUNCTIONS_REGION || "southamerica-east1";

/** Indica se o Firebase está configurado (evita quebrar build/preview). */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId,
);
