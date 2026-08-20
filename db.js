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
import { calcularCascata, mesDeData } from "./logic.js";

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

// Lê os lançamentos cujo mesDesembolso (eixo PRINCIPAL — ver CLAUDE.md "Os dois eixos
// de tempo") é igual a `mesAlvo`, usando o índice ".indexOn" de mesDesembolso já
// publicado nas regras do RTDB.
export async function lerLancamentosPorMesDesembolso(mesAlvo) {
  const consulta = query(ref(db, "lancamentos"), orderByChild("mesDesembolso"), equalTo(mesAlvo));
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

// Grava um lançamento não-crédito (ou qualquer lançamento avulso) junto com os itens
// de /receber que ele gera, quando marcado "compra para terceiro" — ver CLAUDE.md
// "Crédito a receber". Uma única operação atômica (update multi-caminho).
export async function criarLancamentoComRecebiveis(lancamento, recebiveis = []) {
  const atualizacoes = {};
  const novaRef = push(ref(db, "lancamentos"));
  atualizacoes[`lancamentos/${novaRef.key}`] = lancamento;
  for (const recebivel of recebiveis) {
    const recebivelRef = push(ref(db, "receber"));
    atualizacoes[`receber/${recebivelRef.key}`] = recebivel;
  }
  await update(ref(db), atualizacoes);
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
// (mudar total de parcelas, valor etc.) sem duplicar — idempotência. `recebiveis`
// (opcional) grava junto os itens de /receber gerados por uma compra "para terceiro" —
// ver CLAUDE.md "Crédito a receber".
export async function salvarParcelasCompra(parcelas, idCompraExistente, recebiveis = []) {
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

  for (const recebivel of recebiveis) {
    const recebivelRef = push(ref(db, "receber"));
    atualizacoes[`receber/${recebivelRef.key}`] = recebivel;
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

// Lê /receber filtrados por status ("pendente" | "recebido"), usando o índice "status".
export async function lerRecebiveisPorStatus(status) {
  const consulta = query(ref(db, "receber"), orderByChild("status"), equalTo(status));
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}

// Lê /receber cujo mesEsperado é o mês alvo (índice "mesEsperado") — usado na projeção
// da tela Mês pra somar as entradas PREVISTAS (recebíveis pendentes) do eixo desembolso.
export async function lerRecebiveisPorMesEsperado(mes) {
  const consulta = query(ref(db, "receber"), orderByChild("mesEsperado"), equalTo(mes));
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}

// Reprograma um recebível pendente (ex.: mesEsperado editado manualmente).
export async function atualizarRecebivel(id, dados) {
  await update(ref(db, `receber/${id}`), { ...dados, atualizadoEm: Date.now() });
}

// Baixa de um recebível: marca status "recebido" + dataRecebido, e gera a receita real
// em /lancamentos (categoria recebimentos_terceiros — ver CLAUDE.md "Crédito a
// receber"), numa única operação atômica (update multi-caminho).
export async function marcarRecebivelRecebido(recebivel, dataRecebidoISO, uid) {
  const agora = Date.now();
  const novaReceitaRef = push(ref(db, "lancamentos"));
  const receita = {
    tipo: "receita",
    data: dataRecebidoISO,
    mes: mesDeData(dataRecebidoISO),
    mesDesembolso: mesDeData(dataRecebidoISO),
    valorCentavos: recebivel.valorCentavos,
    descricao: `Recebimento de ${recebivel.devedor}`,
    categoriaId: "recebimentos_terceiros",
    meioPagamento: "transferencia",
    responsavel: "casal",
    idReembolso: recebivel.idReembolso,
    criadoPor: uid,
    criadoEm: agora,
    atualizadoEm: agora,
    pago: true
  };
  const atualizacoes = {
    [`lancamentos/${novaReceitaRef.key}`]: receita,
    [`receber/${recebivel.id}/status`]: "recebido",
    [`receber/${recebivel.id}/dataRecebido`]: dataRecebidoISO,
    [`receber/${recebivel.id}/lancamentoReceitaId`]: novaReceitaRef.key,
    [`receber/${recebivel.id}/atualizadoEm`]: agora
  };
  await update(ref(db), atualizacoes);
}

// Desfaz a baixa de um recebível: apaga a receita gerada em /lancamentos e volta o
// item de /receber para "pendente", numa única operação atômica.
export async function desfazerRecebimento(recebivel) {
  const agora = Date.now();
  const atualizacoes = {
    [`receber/${recebivel.id}/status`]: "pendente",
    [`receber/${recebivel.id}/dataRecebido`]: null,
    [`receber/${recebivel.id}/lancamentoReceitaId`]: null,
    [`receber/${recebivel.id}/atualizadoEm`]: agora
  };
  if (recebivel.lancamentoReceitaId) {
    atualizacoes[`lancamentos/${recebivel.lancamentoReceitaId}`] = null;
  }
  await update(ref(db), atualizacoes);
}

// Lê /recorrencias e devolve como lista [{ id, descricao, ... }] — ver CLAUDE.md
// "Recorrência (contas e receitas mensais)".
export async function lerRecorrencias() {
  const snapshot = await get(ref(db, "recorrencias"));
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}

export async function criarRecorrencia(dados) {
  const novaRef = push(ref(db, "recorrencias"));
  await set(novaRef, dados);
  return novaRef.key;
}

// Atualiza uma regra de recorrência (edição de valor/categoria/dia, ou encerrar —
// ativo:false / fim). Afeta só as ocorrências FUTURAS (as já materializadas em
// /lancamentos ficam como estão — ver CLAUDE.md).
export async function atualizarRecorrencia(id, dados) {
  await update(ref(db, `recorrencias/${id}`), { ...dados, atualizadoEm: Date.now() });
}

// Materializa a ocorrência (virtual, vinda de logic.js `gerarOcorrenciaRecorrencia`) de
// uma regra num mês, gravando o lançamento real em /lancamentos com idRecorrencia
// apontando de volta pra regra. IDEMPOTÊNCIA é responsabilidade de quem chama: deve
// checar antes que não existe, no mês, nenhum lançamento com o mesmo idRecorrencia
// (ver ui/mes.js) — aqui só grava.
export async function materializarOcorrencia(ocorrencia, uid) {
  const agora = Date.now();
  const { virtual, id, ...dadosOcorrencia } = ocorrencia;
  const lancamento = {
    ...dadosOcorrencia,
    criadoPor: uid,
    criadoEm: agora,
    atualizadoEm: agora
  };
  return criarLancamento(lancamento);
}
// Lê todas as despesas atreladas a uma fatura específica (independentemente de estarem pagas ou não)
export async function lerLancamentosDaFatura(faturaMes, cartaoId) {
  const consulta = query(ref(db, "lancamentos"), orderByChild("faturaMes"), equalTo(faturaMes));
  const snapshot = await get(consulta);
  
  if (!snapshot.exists()) return [];
  
  const dados = snapshot.val();
  
  return Object.entries(dados)
    .map(([id, valor]) => ({ id, ...valor }))
    .filter(lanc => lanc.cartaoId === cartaoId && lanc.tipo === 'despesa');
}
// Registra o pagamento da fatura em lote com observabilidade
export async function pagarFaturaEmLote(lancamentosIds, totalCentavos, faturaMes, dataPagamento, meioPagamento, uid) {
  const atualizacoes = {};
  const agora = Date.now();

  console.log("🔥 [FIREBASE] Iniciando pagamento em lote. IDs das compras:", lancamentosIds);

  // 1. Marca cada compra da fatura como paga
  lancamentosIds.forEach(id => {
    atualizacoes[`lancamentos/${id}/pago`] = true;
    atualizacoes[`lancamentos/${id}/atualizadoEm`] = agora;
  });

  // 2. Cria o registro de desembolso no caixa
  const novaRef = push(ref(db, "lancamentos"));
  const mesDesembolso = dataPagamento.substring(0, 7);

  atualizacoes[`lancamentos/${novaRef.key}`] = {
    descricao: `Pagamento Fatura ${faturaMes}`,
    valorCentavos: totalCentavos,
    tipo: 'despesa',
    mes: mesDesembolso,
    mesDesembolso: mesDesembolso,
    data: dataPagamento,
    meioPagamento: meioPagamento,
    categoriaId: 'pagamento_cartao',
    responsavel: 'casal',
    pago: true,
    criadoPor: uid,
    criadoEm: agora,
    atualizadoEm: agora
  };

  console.log("📦 [FIREBASE] Pacote montado para envio:", atualizacoes);

  try {
    // Dispara tudo de uma vez
    await update(ref(db), atualizacoes);
    console.log("✅ [FIREBASE] Servidor confirmou a gravação atômica com sucesso.");
  } catch (erro) {
    console.error("❌ [FIREBASE] REJEIÇÃO CRÍTICA DO SERVIDOR:", erro);
    throw erro; // Joga o erro de volta para a tela do aplicativo
  }
}
// Exclui um lançamento do banco. Se for um "pagamento_fatura", realiza o estorno atômico
// (apaga a despesa e reverte o status "pago" das compras daquela fatura).
export async function excluirLancamento(lancamento) {
  // Lógica de estorno para pagamento de faturas
  if (lancamento.categoriaId === 'pagamento_cartao') {
    const atualizacoes = {};
    const faturaMes = lancamento.descricao.split(" ")[2]; // Extrai "2026-08" de "Pagamento Fatura 2026-08"

    // 1. Busca todas as compras vinculadas àquela fatura que estão pagas
    const consulta = query(ref(db, "lancamentos"), orderByChild("faturaMes"), equalTo(faturaMes));
    const snapshot = await get(consulta);
    
    if (snapshot.exists()) {
      const dados = snapshot.val();
      const agora = Date.now();
      
      // 2. Reverte o status das compras para pendente
      Object.entries(dados).forEach(([id, compra]) => {
         if(compra.pago === true && compra.tipo === 'despesa' && compra.categoriaId !== 'pagamento_cartao'){
             atualizacoes[`lancamentos/${id}/pago`] = false;
             atualizacoes[`lancamentos/${id}/atualizadoEm`] = agora;
         }
      });
    }

    // 3. Remove o lançamento do pagamento em si
    atualizacoes[`lancamentos/${lancamento.id}`] = null;

    // 4. Executa a reversão atômica
    await update(ref(db), atualizacoes);
    return;
  }

  // Comportamento padrão para exclusões normais
  await remove(ref(db, `lancamentos/${lancamento.id}`));
}