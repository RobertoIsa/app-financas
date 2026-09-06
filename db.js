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
  orderByKey,
  equalTo,
  limitToLast,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { calcularCascata, mesDeData, lancamentoMoveCaixa, origemCaixaDoLancamento } from "./logic.js";

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

// Ponto ÚNICO de entrada pra marcar/desmarcar um lançamento como pago — usado tanto pelo
// toggle individual quanto pelo "Pagar Tudo"/"Receber Tudo" em ui/mes.js. NUNCA deve
// existir um segundo caminho que chame atualizarLancamento(id, {pago}) diretamente pra
// esse fim: foi exatamente essa duplicação (o botão em lote ignorando a lógica de caixa
// que só existia no toggle individual) que causou um bug real — recorrência marcada paga
// via "Pagar Tudo" não movia o Caixa, silenciosamente, porque esse caminho nunca tinha
// sido ligado a movimentarCaixa.
//
// Decide sozinho, via logic.js `lancamentoMoveCaixa`, se essa mudança de `pago` precisa
// mexer no Caixa: hoje só recorrência materializada não-crédito depende do próprio `pago`
// pra "mover ou não" (a Leva 2 do Caixa — crédito só move na baixa da fatura inteira, ver
// pagarFaturaEmLote); despesa/receita manual imediata já moveu o caixa na criação e não
// depende deste toggle. Comparar `lancamentoMoveCaixa` ANTES e DEPOIS do novo `pago`
// cobre os dois casos com a mesma regra, sem precisar duplicar a decisão aqui.
export async function marcarLancamentoPago(lancamento, pago, uid) {
  await atualizarLancamento(lancamento.id, { pago });

  const moviaAntes = lancamentoMoveCaixa(lancamento);
  const moveDepois = lancamentoMoveCaixa({ ...lancamento, pago });
  if (moviaAntes === moveDepois) return { caixaAtualizado: true }; // nada muda no caixa

  const entrando = !moviaAntes && moveDepois; // false->true: evento novo (ex.: "Pagar")
  const direcaoBase = lancamento.tipo === "receita" ? "entrada" : "saida";
  const tipoCaixa = entrando ? direcaoBase : (direcaoBase === "entrada" ? "saida" : "entrada");

  try {
    await movimentarCaixa({
      tipo: tipoCaixa,
      valorCentavos: lancamento.valorCentavos,
      origem: origemCaixaDoLancamento(lancamento),
      lancamentoId: lancamento.id,
      estorno: !entrando,
      uid
    });
    return { caixaAtualizado: true };
  } catch (erroCaixa) {
    console.error("Falha ao ajustar o caixa ao marcar lançamento como pago/não pago:", erroCaixa);
    return { caixaAtualizado: false };
  }
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

// Resolve o `responsavel` (chave de /membros) a partir do uid de quem está logado — ver
// CLAUDE.md "Atribuição por pessoa (revisado)": responsavel é sempre automático, nunca
// "casal". Usado só pelas funções deste arquivo que geram um lançamento sem um formulário
// por trás (marcarRecebivelRecebido, pagarFaturaEmLote) — ui/lancamento.js e
// ui/recorrencias.js já têm /membros em cache e usam logic.js `resolverResponsavelPorUid`
// (síncrono) em vez desta versão, que lê do banco. Fallback sensato se o uid não bater com
// nenhum /membros (não deveria acontecer dado a allowlist, mas não trava o salvamento).
export async function obterResponsavelPorUid(uid) {
  const snapshot = await get(ref(db, `membros/${uid}`));
  if (snapshot.exists() && snapshot.val().chave) return snapshot.val().chave;
  console.warn(`obterResponsavelPorUid: nenhum /membros/${uid} encontrado — usando o uid como responsavel de fallback.`);
  return uid;
}

// Baixa de um recebível: marca status "recebido" + dataRecebido, e gera a receita real
// em /lancamentos (categoria recebimentos_terceiros — ver CLAUDE.md "Crédito a
// receber"), numa única operação atômica (update multi-caminho). Em seguida, best-effort
// (mesmo padrão da Leva 1 — ver excluirLancamento/pagarFaturaEmLote), registra a entrada
// no Caixa: a baixa é dinheiro caindo de verdade (ver CLAUDE.md "Caixa (saldo acumulado
// real)").
export async function marcarRecebivelRecebido(recebivel, dataRecebidoISO, uid) {
  const agora = Date.now();
  const responsavel = await obterResponsavelPorUid(uid);
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
    responsavel,
    idReembolso: recebivel.idReembolso,
    idRecebivel: recebivel.id, // referência de volta ao /receber/{id} de origem, pra
                               // ui/mes.js poder chamar desfazerRecebimento sem precisar
                               // de uma consulta extra por índice não existente
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

  try {
    await movimentarCaixa({
      tipo: "entrada",
      valorCentavos: recebivel.valorCentavos,
      origem: "recebivel",
      lancamentoId: novaReceitaRef.key,
      uid
    });
  } catch (erroCaixa) {
    console.error("Falha ao registrar movimento de caixa da baixa de recebível:", erroCaixa);
  }
}

// Desfaz a baixa de um recebível: apaga a receita gerada em /lancamentos e volta o
// item de /receber para "pendente", numa única operação atômica. Em seguida, estorna
// (best-effort, sem apagar histórico) o movimento de caixa da baixa original.
export async function desfazerRecebimento(recebivel, uid) {
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

  if (recebivel.lancamentoReceitaId) {
    try {
      await movimentarCaixa({
        tipo: "saida",
        valorCentavos: recebivel.valorCentavos,
        origem: "recebivel",
        lancamentoId: recebivel.lancamentoReceitaId,
        estorno: true,
        uid
      });
    } catch (erroCaixa) {
      console.error("Falha ao estornar movimento de caixa do recebimento desfeito:", erroCaixa);
    }
  }
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
// uma regra num mês, gravando o lançamento real em /lancamentos. Usa uma CHAVE
// DETERMINÍSTICA ("REC-{idRecorrencia}-{mes}") em vez de push id, escrita dentro de uma
// runTransaction: o servidor só grava se o nó ainda não existir, senão aborta sem
// escrever. Isso torna a materialização idempotente de verdade — reload da aba, navegação
// repetida ou duas abas materializando o mesmo mês ao mesmo tempo nunca duplicam o
// lançamento, mesmo que a leitura prévia do cliente esteja desatualizada (a checagem por
// idRecorrencia em ui/mes.js continua existindo como otimização, mas quem garante a
// ausência de duplicata é esta transação).
export async function materializarOcorrencia(ocorrencia, uid) {
  const agora = Date.now();
  const { virtual, id, ...dadosOcorrencia } = ocorrencia;
  const chave = `REC-${dadosOcorrencia.idRecorrencia}-${dadosOcorrencia.mes}`;
  const lancamento = {
    ...dadosOcorrencia,
    criadoPor: uid,
    criadoEm: agora,
    atualizadoEm: agora
  };
  const lancamentoRef = ref(db, `lancamentos/${chave}`);
  const resultado = await runTransaction(lancamentoRef, (atual) => {
    if (atual !== null) return; // já existe: aborta a transação sem sobrescrever
    return lancamento;
  });
  return resultado.committed ? chave : null;
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

// Lê todos os lançamentos cujo faturaMes é o mês informado, de qualquer cartão — usado
// como fallback na tela Mês pra achar lançamentos de crédito antigos que não têm o campo
// mesDesembolso preenchido (ver logic.js "obterMesDesembolso"): como mesDesembolso só pode
// ser o próprio faturaMes ou o mês seguinte (ver CLAUDE.md "Vencimento e mês de
// desembolso"), consultar faturaMes = M e faturaMes = M-1 cobre todo candidato possível.
export async function lerLancamentosPorFaturaMes(faturaMes) {
  const consulta = query(ref(db, "lancamentos"), orderByChild("faturaMes"), equalTo(faturaMes));
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados).map(([id, valor]) => ({ id, ...valor }));
}
// Registra o pagamento da fatura em lote com observabilidade
export async function pagarFaturaEmLote(lancamentosIds, totalCentavos, faturaMes, dataPagamento, meioPagamento, uid) {
  const atualizacoes = {};
  const agora = Date.now();
  const responsavel = await obterResponsavelPorUid(uid);

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
    responsavel,
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

  // Pagar a fatura é dinheiro saindo de verdade (ver CLAUDE.md "Caixa (saldo acumulado
  // real)") — best-effort: a baixa acima já está commitada, então uma falha aqui não
  // desfaz nada, só fica sem atualizar o saldo (o chamador decide se avisa o usuário).
  let caixaAtualizado = true;
  try {
    await movimentarCaixa({
      tipo: "saida",
      valorCentavos: totalCentavos,
      origem: "pagamento_fatura",
      lancamentoId: novaRef.key,
      uid
    });
  } catch (erroCaixa) {
    caixaAtualizado = false;
    console.error("Falha ao registrar movimento de caixa do pagamento de fatura:", erroCaixa);
  }

  return { pagamentoLancamentoId: novaRef.key, caixaAtualizado };
}
// Exclui um lançamento do banco. Se for um "pagamento_fatura", realiza o estorno atômico
// (apaga a despesa e reverte o status "pago" das compras daquela fatura) e o estorno
// correspondente no Caixa (ver CLAUDE.md "Caixa (saldo acumulado real)"): desfazer um
// pagamento de fatura devolve o dinheiro ao saldo, com um movimento de entrada que
// referencia o pagamento estornado — não apaga o histórico, só registra a reversão.
// `uid` é necessário só pro registro de auditoria do movimento de caixa gerado (se houver).
export async function excluirLancamento(lancamento, uid) {
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

    // 5. Estorna o movimento de caixa do pagamento original (entrada = devolve o
    // dinheiro). Best-effort: o desfazer do lançamento já está commitado no passo 4;
    // se o estorno de caixa falhar (ex.: rede caiu), não desfaz o passo 4 — só loga,
    // pra não deixar o usuário achando que o "desfazer" inteiro falhou quando na
    // verdade só o saldo de caixa não ficou 100% sincronizado.
    try {
      await movimentarCaixa({
        tipo: "entrada",
        valorCentavos: lancamento.valorCentavos,
        origem: "pagamento_fatura",
        lancamentoId: lancamento.id,
        estorno: true,
        uid
      });
    } catch (erroCaixa) {
      console.error("Falha ao estornar movimento de caixa do pagamento de fatura desfeito:", erroCaixa);
    }
    return;
  }

  // Qualquer outro lançamento que já moveu o caixa de verdade — despesa/receita manual
  // imediata (Leva 1), receita de baixa de recebível, ou recorrência materializada já
  // paga (Leva 2) — precisa do mesmo estorno, senão o saldo fica "preso" com dinheiro de
  // um lançamento que não existe mais (bug real encontrado em uso). `lancamentoMoveCaixa`/
  // `origemCaixaDoLancamento` (logic.js) concentram esse critério num só lugar, reusado
  // também na edição de valor (ver ui/lancamento.js).
  const precisaEstornarCaixa = lancamentoMoveCaixa(lancamento);
  const origemEstorno = precisaEstornarCaixa ? origemCaixaDoLancamento(lancamento) : null;

  // Comportamento padrão para exclusões normais
  await remove(ref(db, `lancamentos/${lancamento.id}`));

  if (precisaEstornarCaixa && lancamento.valorCentavos > 0) {
    // Best-effort, mesmo padrão do estorno de pagamento_cartao acima: a exclusão já
    // está commitada; se o estorno de caixa falhar, só loga — não desfaz a exclusão.
    try {
      await movimentarCaixa({
        tipo: lancamento.tipo === 'receita' ? 'saida' : 'entrada',
        valorCentavos: lancamento.valorCentavos,
        origem: origemEstorno,
        lancamentoId: lancamento.id,
        estorno: true,
        uid
      });
    } catch (erroCaixa) {
      console.error("Falha ao estornar movimento de caixa do lançamento excluído:", erroCaixa);
    }
  }
}

// ---- Caixa (saldo acumulado real) — ver CLAUDE.md "Caixa (saldo acumulado real)" ----
// Regra de ouro: o caixa só se move quando o dinheiro sai/entra DE FATO, nunca por algo
// pendente/previsto/projetado. Nasce em 0 (sem saldo inicial informado).

// Lê o saldo atual de /caixa/saldo. Antes do primeiro movimento, o nó pode nem existir
// ainda — devolve 0 nesse caso (nasce em R$0, ver CLAUDE.md).
export async function lerSaldoCaixa() {
  const snapshot = await get(ref(db, "caixa/saldo"));
  if (!snapshot.exists()) return { valorCentavos: 0, atualizadoEm: null };
  return snapshot.val();
}

// Lê os N movimentos mais recentes de /caixa/movimentos, mais recente primeiro.
// orderByKey() não precisa de índice extra (chave já é ordenável por natureza no RTDB,
// e push ids são cronologicamente crescentes) — limitToLast(N) pega só os N últimos.
export async function lerMovimentosCaixaRecentes(limite = 50) {
  const consulta = query(ref(db, "caixa/movimentos"), orderByKey(), limitToLast(limite));
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return [];
  const dados = snapshot.val();
  return Object.entries(dados)
    .map(([id, valor]) => ({ id, ...valor }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

// Função genérica que registra QUALQUER evento que mexe o caixa de verdade: grava um
// movimento de auditoria em /caixa/movimentos e soma/subtrai o saldo em
// /caixa/saldo/valorCentavos. `tipo`: "entrada" | "saida". `origem`: string livre (ver
// enum documentado em CLAUDE.md — "despesa_imediata"|"pagamento_fatura"|"receita"|
// "recebivel"|"recorrencia_paga"). `lancamentoId`: referência ao evento de origem
// (id de /lancamentos ou /receber, conforme a origem). `estorno` (opcional): marca que
// este movimento é a REVERSÃO de outro (ex.: desfazer pagamento de fatura) — não apaga
// nada, só soma um movimento inverso, preservando o histórico completo.
//
// Atomicidade: o RTDB não tem uma primitiva única que faça "soma segura sob concorrência"
// E "grava um novo registro" na MESMA operação sem ter que transacionar o nó pai inteiro
// (o que ficaria cada vez mais caro conforme /caixa/movimentos cresce). Por isso:
// 1) grava o movimento primeiro (registro de auditoria imutável e barato de escrever,
//    independente do tamanho da lista existente);
// 2) soma o saldo com runTransaction em /caixa/saldo/valorCentavos — o RTDB relê o valor
//    atual do servidor e tenta de novo automaticamente se outro cliente (ex.: a esposa
//    lançando ao mesmo tempo) escreveu no meio do caminho, eliminando a race condition
//    de um "ler valor atual, somar, escrever" ingênuo.
// Se o passo 2 falhar, o passo 1 é desfeito (rollback best-effort) pra não deixar um
// registro de auditoria "fantasma" que não teve efeito nenhum no saldo.
export async function movimentarCaixa({ tipo, valorCentavos, origem, lancamentoId, estorno, uid }) {
  if (tipo !== "entrada" && tipo !== "saida") {
    throw new Error(`movimentarCaixa: tipo inválido "${tipo}" (esperado "entrada" ou "saida")`);
  }
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    throw new Error(`movimentarCaixa: valorCentavos inválido (${valorCentavos})`);
  }

  const agora = Date.now();
  const delta = tipo === "entrada" ? valorCentavos : -valorCentavos;

  const movimentoRef = push(ref(db, "caixa/movimentos"));
  const movimento = {
    tipo,
    valorCentavos,
    origem,
    lancamentoId: lancamentoId || null,
    estorno: !!estorno,
    criadoPor: uid || null,
    criadoEm: agora
  };
  await set(movimentoRef, movimento);

  try {
    await runTransaction(ref(db, "caixa/saldo/valorCentavos"), (atual) => (atual || 0) + delta);
    await update(ref(db, "caixa/saldo"), { atualizadoEm: agora });
  } catch (erro) {
    await remove(movimentoRef).catch(() => {});
    throw erro;
  }

  return movimentoRef.key;
}

// Lê o texto de observações gerais salvo pelo usuário (nó /observacoes/{uid}).
// Substitui o antigo armazenamento em localStorage para que as notas fiquem
// sincronizadas entre dispositivos, como o resto do app.
export async function lerObservacoes(uid) {
  const snapshot = await get(ref(db, `observacoes/${uid}`));
  if (!snapshot.exists()) return "";
  return snapshot.val().texto || "";
}

// Grava o texto de observações gerais do usuário.
export async function salvarObservacoes(uid, texto) {
  await set(ref(db, `observacoes/${uid}`), { texto, atualizadoEm: Date.now() });
}

// ---- Caixinhas (orçamento mensal por pessoa) — ver CLAUDE.md "Caixinhas" ----
// Só o LIMITE é guardado (por pessoa, por mês). O saldo/gasto NUNCA é persistido: é
// sempre calculado na hora em ui/caixinhas.js a partir de /lancamentos, do mesmo jeito
// que a tela "Mês" faz — escolha deliberada pra não replicar o sincronismo frágil que o
// Caixa (contador) exigiu.

// Lê o limite de uma pessoa num mês (YYYY-MM). Devolve null se ainda não foi definido —
// a UI trata esse caso (aviso "Defina o limite deste mês"); NÃO copia de um mês anterior.
export async function lerCaixinhaLimite(pessoa, mes) {
  const snapshot = await get(ref(db, `caixinhas/${pessoa}/${mes}`));
  if (!snapshot.exists()) return null;
  return snapshot.val();
}

// Grava/atualiza o limite de uma pessoa num mês. Qualquer membro logado pode definir o
// limite de qualquer caixinha (é decisão do casal, não trava individual — ver CLAUDE.md).
export async function salvarCaixinhaLimite(pessoa, mes, limiteCentavos, uid) {
  await set(ref(db, `caixinhas/${pessoa}/${mes}`), {
    limiteCentavos,
    definidoPor: uid,
    atualizadoEm: Date.now()
  });
}