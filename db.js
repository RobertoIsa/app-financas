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

  // Lançamento imediato (dinheiro/débito/pix/transferência) que moveu o caixa na
  // criação (ver ui/lancamento.js) — excluir precisa estornar esse movimento, senão o
  // saldo fica "preso" com dinheiro de um lançamento que não existe mais (bug real
  // encontrado em uso). Critério pra saber se este lançamento passou pelo hook de
  // criação da Leva 1, sem precisar de um campo novo dedicado:
  //   - não-crédito (crédito nunca move caixa na criação);
  //   - não é a despesa de pagamento de fatura (já tratada e retornada acima);
  //   - idRecorrencia ausente — uma recorrência materializada ainda NÃO move caixa na
  //     criação (isso é Leva 2), então não pode gerar estorno aqui;
  //   - paraTerceiro definido (booleano) — só o formulário de lançamento (ui/lancamento.js)
  //     seta esse campo explicitamente pra TODO lançamento que cria; a receita gerada
  //     por marcarRecebivelRecebido nunca seta paraTerceiro, e a baixa de recebível
  //     ainda não move caixa (também Leva 2) — então fica corretamente excluída aqui.
  const eraImediatoComCaixa =
    lancamento.meioPagamento !== 'credito' &&
    lancamento.categoriaId !== 'pagamento_cartao' &&
    !lancamento.idRecorrencia &&
    lancamento.paraTerceiro !== undefined &&
    (lancamento.tipo === 'despesa' || lancamento.tipo === 'receita');

  // Comportamento padrão para exclusões normais
  await remove(ref(db, `lancamentos/${lancamento.id}`));

  if (eraImediatoComCaixa && lancamento.valorCentavos > 0) {
    // Best-effort, mesmo padrão do estorno de pagamento_cartao acima: a exclusão já
    // está commitada; se o estorno de caixa falhar, só loga — não desfaz a exclusão.
    try {
      await movimentarCaixa({
        tipo: lancamento.tipo === 'receita' ? 'saida' : 'entrada',
        valorCentavos: lancamento.valorCentavos,
        origem: lancamento.tipo === 'receita' ? 'receita' : 'despesa_imediata',
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