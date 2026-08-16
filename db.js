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
  get,
  push,
  set,
  query,
  orderByChild,
  equalTo
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

// Lê /categorias e devolve como lista [{ chave, nome, ... }]
export async function lerCategorias() {
  const snapshot = await get(ref(db, "categorias"));
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([chave, valor]) => ({ chave, ...valor }));
}

// Lê /membros e devolve como lista [{ uid, nome, chave, ativo }]
export async function lerMembros() {
  const snapshot = await get(ref(db, "membros"));
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([uid, valor]) => ({ uid, ...valor }));
}

// Lê /cartoes e devolve como lista [{ id, nome, diaFechamento, ... }]
export async function lerCartoes() {
  const snapshot = await get(ref(db, "cartoes"));
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}

// Lê /lancamentos filtrados por mês (YYYY-MM) usando o índice "mes".
export async function lerLancamentosDoMes(mes) {
  const consulta = query(ref(db, "lancamentos"), orderByChild("mes"), equalTo(mes));
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}

export async function criarLancamento(dados) {
  const novaRef = push(ref(db, "lancamentos"));
  await set(novaRef, dados);
  return novaRef.key;
}
