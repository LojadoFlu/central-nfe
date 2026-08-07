"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { firebaseConfig, isFirebaseConfigured, REGIAO_FUNCTIONS } from "./config";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let functions: Functions | undefined;
let storage: FirebaseStorage | undefined;

/**
 * Inicializa o Firebase apenas no cliente e sob demanda.
 * Retorna `null` quando as env ainda não foram configuradas (modo "não configurado").
 */
export function getFirebase(): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
} | null {
  if (!isFirebaseConfigured || typeof window === "undefined") return null;

  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, REGIAO_FUNCTIONS);
    storage = getStorage(app);
  }
  return {
    app: app!,
    auth: auth!,
    db: db!,
    functions: functions!,
    storage: storage!,
  };
}
