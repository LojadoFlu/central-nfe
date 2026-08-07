import type { FirebaseOptions } from "firebase/app";

/**
 * Config do Firebase (projeto DEDICADO da Central NF-e).
 * São identificadores PÚBLICOS — vão ao navegador de qualquer forma. A segurança
 * vem das Security Rules + Auth, não de esconder a chave. Ficam fixos no código
 * para evitar erros de digitação em variáveis de ambiente do deploy (Netlify).
 */
export const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyBTxo0QiSzHjPAET2ydSVnOW4uxCK2ZwzY",
  authDomain: "central-nfe-1c8d8.firebaseapp.com",
  projectId: "central-nfe-1c8d8",
  storageBucket: "central-nfe-1c8d8.firebasestorage.app",
  messagingSenderId: "1098789086301",
  appId: "1:1098789086301:web:cdeec46d2a4569d2ba19b4",
};

/** Região das Cloud Functions. */
export const REGIAO_FUNCTIONS = "southamerica-east1";

/** Config sempre presente (valores fixos acima). */
export const isFirebaseConfigured = true;
