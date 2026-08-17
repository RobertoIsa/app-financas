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
  update,
  remove,
  query,
  orderByChild,
  equalTo
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { calcularCascata } from "./logic.js";

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

export async function atualizarLancamento(id, dados) {
  await update(ref(db, `lancamentos/${id}`), dados);
}

// Lê todas as parcelas de uma compra (mesmo idCompra), usando o índice "idCompra".
export async function lerLancamentosPorIdCompra(idCompra) {
  const consulta = query(ref(db, "lancamentos"), orderByChild("idCompra"), equalTo(idCompra));
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}

// Grava todas as parcelas de uma compra no crédito numa única operação atômica
// (update multi-caminho — ver CLAUDE.md "Controle de concorrência"). Se idCompraExistente
// for informado, apaga antes as parcelas antigas desse idCompra, para reeditar uma compra
// (mudar total de parcelas, valor etc.) sem duplicar — idempotência.
export async function salvarParcelasCompra(parcelas, idCompraExistente) {
  const atualizacoes = {};

  if (idCompraExistente) {
    const antigas = await lerLancamentosPorIdCompra(idCompraExistente);
    for (const antiga of antigas) {
      atualizacoes[`lancamentos/${antiga.id}`] = null;
    }
  }

  for (const parcela of parcelas) {
    const novaRef = push(ref(db, "lancamentos"));
    atualizacoes[`lancamentos/${novaRef.key}`] = parcela;
  }

  await update(ref(db), atualizacoes);
}

// Atualiza valor/descrição/categoria (ou outros campos) de uma parcela e propaga a
// mesma mudança para as parcelas FUTURAS ainda não pagas do mesmo idCompra (cascata —
// ver CLAUDE.md "Cascata"), tudo numa única operação atômica.
export async function atualizarParcelaComCascata(idCompra, parcelaAtual, mudancas) {
  const parcelas = await lerLancamentosPorIdCompra(idCompra);
  const agora = Date.now();
  const atualizacoes = {};

  // Paths totalmente qualificados (lancamentos/{id}/{campo}) em vez de gravar o nó
  // inteiro: update multi-caminho só reescreve os campos citados, sem apagar o resto
  // do lançamento (gravar um objeto parcial direto em "lancamentos/{id}" substituiria
  // o nó inteiro).
  function agendarCampos(id, campos) {
    for (const [campo, valor] of Object.entries({ ...campos, atualizadoEm: agora })) {
      atualizacoes[`lancamentos/${id}/${campo}`] = valor;
    }
  }

  const parcelaEditada = parcelas.find((p) => p.parcelaAtual === parcelaAtual);
  if (parcelaEditada) {
    agendarCampos(parcelaEditada.id, mudancas);
  }

  for (const { id, mudancas: camposCascata } of calcularCascata(parcelas, parcelaAtual, mudancas)) {
    agendarCampos(id, camposCascata);
  }

  await update(ref(db), atualizacoes);
}

export async function criarCartao(dados) {
  const novaRef = push(ref(db, "cartoes"));
  await set(novaRef, dados);
  return novaRef.key;
}

export async function atualizarCartao(id, dados) {
  await update(ref(db, `cartoes/${id}`), dados);
}

export async function excluirCartao(id) {
  await remove(ref(db, `cartoes/${id}`));
}

// Verifica se existe algum lançamento vinculado a um cartão (usa o índice "cartaoId"),
// para decidir se a exclusão definitiva é permitida ou se só a desativação é possível.
export async function existeLancamentoComCartao(cartaoId) {
  const consulta = query(ref(db, "lancamentos"), orderByChild("cartaoId"), equalTo(cartaoId));
  const snapshot = await get(consulta);
  return snapshot.exists();
}
