// db.js
// Camada de acesso ao Firebase: inicializa o app e expõe auth + leitura do RTDB.
// Usa o SDK modular do Firebase via CDN — sem build/bundler.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export function login(email, senha) {
  return signInWithEmailAndPassword(auth, email, senha);
}

export function logout() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Teste de fumaça: lê /categorias e devolve como lista [{ chave, nome, ... }]
export async function lerCategorias() {
  const snapshot = await get(ref(db, "categorias"));
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([chave, valor]) => ({ chave, ...valor }));
}
