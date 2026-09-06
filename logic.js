// logic.js
// Regras de negócio puras (sem dependência do Firebase): parsing de valores em reais,
// formatação de centavos e datas, e a engine de ciclo de fatura / parcelamento / cascata.

// Converte texto digitado em reais (padrão BR, ex.: "1.234,56" ou "49,90") para
// centavos inteiros. Retorna NaN se o texto não for um valor válido.
export function parseValorParaCentavos(texto) {
  if (typeof texto !== "string") return NaN;
  let limpo = texto.trim();
  if (!limpo) return NaN;

  // Só remove "." como separador de milhar quando há vírgula decimal;
  // sem vírgula, tratamos "." como separador decimal (ex.: teclado numérico em inglês).
  if (limpo.includes(",")) {
    limpo = limpo.replace(/\./g, "").replace(",", ".");
  }

  const valor = parseFloat(limpo);
  if (isNaN(valor) || valor < 0) return NaN;
  return Math.round(valor * 100);
}

export function formatCentavos(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

// Data local (não UTC) no formato YYYY-MM-DD, para não sofrer o "dia anterior"
// que new Date().toISOString() causa em fusos negativos.
export function dataHojeISO() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function mesDeData(dataISO) {
  return dataISO.slice(0, 7);
}

// Soma (ou subtrai) meses a um mês YYYY-MM, tratando virada de ano nos dois sentidos.
export function somarMeses(mesISO, delta) {
  const [anoStr, mesStr] = mesISO.split("-");
  const ano = parseInt(anoStr, 10);
  const mesIndice0 = parseInt(mesStr, 10) - 1 + delta; // 0-based pra facilitar o módulo
  const anoFinal = ano + Math.floor(mesIndice0 / 12);
  const mesFinal0 = ((mesIndice0 % 12) + 12) % 12; // módulo sempre positivo
  return `${anoFinal}-${String(mesFinal0 + 1).padStart(2, "0")}`;
}

// Regra do ciclo de fatura (ver CLAUDE.md "Ciclo de fatura"): dado o dia da compra e o
// diaFechamento do cartão, devolve o mês (YYYY-MM) da fatura em que a compra cai.
// dia <= diaFechamento → fatura do mês da compra; dia > diaFechamento → mês seguinte.
// Resultado deve ser gravado como faturaMes e NUNCA recalculado depois (é congelado).
export function calcularFaturaMes(dataCompraISO, diaFechamento) {
  const dia = parseInt(dataCompraISO.slice(8, 10), 10);
  const mesCompra = mesDeData(dataCompraISO);
  return dia > diaFechamento ? somarMeses(mesCompra, 1) : mesCompra;
}

// Quantidade de dias de um mês YYYY-MM (usado para não gerar datas inválidas como
// "2026-02-31" quando o diaVencimento do cartão não existe no mês de destino, ou
// quando o diaDoMes de uma recorrência não existe no mês — ver "Recorrência").
export function diasNoMes(mesISO) {
  const [ano, mes] = mesISO.split("-").map(Number);
  return new Date(ano, mes, 0).getDate();
}

// Regra de "Vencimento e mês de desembolso" (ver CLAUDE.md): dado o faturaMes de uma
// compra no crédito e o diaFechamento/diaVencimento do cartão, devolve a data completa
// de vencimento da fatura e o mês em que o dinheiro efetivamente sai da conta
// (mesDesembolso — eixo PRINCIPAL do app). Resultado deve ser gravado no lançamento e
// NUNCA recalculado depois (congelado), assim como faturaMes.
export function calcularVencimentoEDesembolso({ faturaMes, diaFechamento, diaVencimento }) {
  const mesVencimento = diaVencimento > diaFechamento ? faturaMes : somarMeses(faturaMes, 1);
  const dia = Math.min(diaVencimento, diasNoMes(mesVencimento));
  const vencimento = `${mesVencimento}-${String(dia).padStart(2, "0")}`;
  return { vencimento, mesDesembolso: mesVencimento };
}

// Devolve o mesDesembolso de um lançamento já gravado, com fallback para registros
// antigos que não tinham esse campo (ver CLAUDE.md "Lançamentos antigos"): crédito cai
// de volta no faturaMes, os demais no próprio mes (movimento imediato). Não recalcula
// nem reescreve nada — é só uma leitura tolerante.
export function obterMesDesembolso(lancamento) {
  if (lancamento.mesDesembolso) return lancamento.mesDesembolso;
  return lancamento.faturaMes || lancamento.mes;
}

// Gera os N lançamentos (parcelas) de uma compra no crédito, todos ligados pelo mesmo
// idCompra. A parcela k recebe faturaMes = faturaMes da parcela 1 + (k-1) meses.
//
// Política de valor (revisar depois se necessário): valorCentavos é o valor de CADA
// parcela, isto é, o valor informado no formulário NÃO é dividido pelo total de parcelas.
export function gerarParcelas({
  idCompra,
  dataCompra,
  valorCentavos,
  totalParcelas,
  diaFechamentoCartao,
  diaVencimentoCartao,
  categoriaId,
  descricao,
  meioPagamento,
  cartaoId,
  responsavel,
  tipo,
  criadoPor,
  criadoEm
}) {
  const faturaMesBase = calcularFaturaMes(dataCompra, diaFechamentoCartao);
  const parcelas = [];
  for (let k = 1; k <= totalParcelas; k++) {
    const faturaMes = somarMeses(faturaMesBase, k - 1);
    const { vencimento, mesDesembolso } = calcularVencimentoEDesembolso({
      faturaMes,
      diaFechamento: diaFechamentoCartao,
      diaVencimento: diaVencimentoCartao
    });
    parcelas.push({
      tipo,
      data: dataCompra,
      mes: mesDeData(dataCompra),
      mesDesembolso,
      valorCentavos,
      descricao,
      categoriaId,
      meioPagamento,
      cartaoId,
      responsavel,
      faturaMes,
      vencimento,
      idCompra,
      parcelaAtual: k,
      totalParcelas,
      pago: false,
      dataBaixa: null,
      paraTerceiro: false,
      devedor: null,
      idReembolso: null,
      criadoPor,
      criadoEm,
      atualizadoEm: criadoEm
    });
  }
  return parcelas;
}

// Divide um valor total em N partes inteiras (centavos), jogando a sobra de
// arredondamento na última parte — usado no crédito a receber quando o nº de
// recebimentos não bate com o nº de parcelas (ver CLAUDE.md "Crédito a receber").
export function distribuirValorRecebimentos(valorTotalCentavos, numRecebimentos) {
  const base = Math.floor(valorTotalCentavos / numRecebimentos);
  const valores = new Array(numRecebimentos).fill(base);
  valores[numRecebimentos - 1] += valorTotalCentavos - base * numRecebimentos;
  return valores;
}

// Gera os N itens de /receber que espelham uma compra marcada "para terceiro" (ver
// CLAUDE.md "Crédito a receber (compra para terceiro)"). O mesDesembolso avança
// exatamente 1 mês por parcela (mesma regra de vencimento do cartão vale pra todas as
// parcelas de uma compra), então o recebimento i tem mesEsperado = mesDesembolsoBase +
// (i-1) meses. Quando numRecebimentos == totalParcelas da compra, isso espelha
// exatamente o mesDesembolso de cada parcela (o default do CLAUDE.md); a extrapolação
// segue a mesma cadência quando o usuário edita numRecebimentos.
export function gerarRecebiveis({
  idReembolso,
  origemIdCompra,
  devedor,
  numRecebimentos,
  valorTotalCentavos,
  mesDesembolsoBase,
  criadoPor,
  criadoEm
}) {
  const valores = distribuirValorRecebimentos(valorTotalCentavos, numRecebimentos);
  const recebiveis = [];
  for (let i = 1; i <= numRecebimentos; i++) {
    recebiveis.push({
      idReembolso,
      origemIdCompra,
      devedor,
      valorCentavos: valores[i - 1],
      parcelaAtual: i,
      totalParcelas: numRecebimentos,
      mesEsperado: somarMeses(mesDesembolsoBase, i - 1),
      status: "pendente",
      dataRecebido: null,
      lancamentoReceitaId: null,
      criadoPor,
      criadoEm,
      atualizadoEm: criadoEm
    });
  }
  return recebiveis;
}

// Dada a lista de parcelas existentes de um idCompra e os campos alterados numa parcela
// específica (parcelaEditadaAtual), devolve os {id, mudancas} das parcelas FUTURAS
// (parcelaAtual maior que a editada) e ainda não pagas — as já pagas não mudam.
export function calcularCascata(parcelasExistentes, parcelaEditadaAtual, camposAlterados) {
  return parcelasExistentes
    .filter((parcela) => parcela.parcelaAtual > parcelaEditadaAtual && !parcela.pago)
    .map((parcela) => ({ id: parcela.id, mudancas: { ...camposAlterados } }));
}

// --- Recorrência (regra + projeção virtual — ver CLAUDE.md "Recorrência (contas e
// receitas mensais)"). A regra é gravada uma vez em /recorrencias; meses futuros são
// projetados virtualmente aqui (nada é gravado) e o mês corrente é materializado em
// /lancamentos (ver db.js materializarOcorrencia). ---

// Uma regra está ativa num mês M (YYYY-MM) se M >= inicio, (fim é null ou M <= fim) e
// ativo !== false. Comparação lexicográfica de strings YYYY-MM funciona como comparação
// cronológica (mesmo formato, mesmo nº de dígitos).
export function recorrenciaAtivaNoMes(regra, mes) {
  if (regra.ativo === false) return false;
  if (regra.inicio && mes < regra.inicio) return false;
  if (regra.fim && mes > regra.fim) return false;
  return true;
}

// Gera a ocorrência de uma regra de recorrência num mês de competência `mes` — os
// mesmos campos de um lançamento normal, prontos tanto para exibição virtual quanto
// para materialização (ver db.js). diaDoMes maior que os dias do mês (ex.: 31 em
// fevereiro) vira o último dia do mês. Quando a regra é no crédito, reusa a engine de
// ciclo de fatura (calcularFaturaMes/calcularVencimentoEDesembolso) com o `cartao`
// informado — mesma regra de uma compra normal (ver CLAUDE.md "Ciclo de fatura");
// sem crédito, o desembolso é imediato (mesDesembolso = mes).
export function gerarOcorrenciaRecorrencia(regra, mes, cartao) {
  const dia = Math.min(regra.diaDoMes, diasNoMes(mes));
  const data = `${mes}-${String(dia).padStart(2, "0")}`;

  const base = {
    tipo: regra.tipo,
    data,
    mes,
    descricao: regra.descricao,
    valorCentavos: regra.valorCentavos,
    categoriaId: regra.categoriaId,
    meioPagamento: regra.meioPagamento,
    cartaoId: regra.cartaoId || null,
    responsavel: regra.responsavel,
    paraTerceiro: false,
    devedor: null,
    idReembolso: null,
    idRecorrencia: regra.id
  };

  if (regra.meioPagamento === "credito" && cartao) {
    const faturaMes = calcularFaturaMes(data, cartao.diaFechamento);
    const { vencimento, mesDesembolso } = calcularVencimentoEDesembolso({
      faturaMes,
      diaFechamento: cartao.diaFechamento,
      diaVencimento: cartao.diaVencimento
    });
    return { ...base, faturaMes, vencimento, mesDesembolso, pago: false, dataBaixa: null };
  }

  return { ...base, mesDesembolso: mes, pago: false, dataBaixa: null };
}

// Projeção virtual (NÃO grava nada) das ocorrências de todas as regras ativas num mês
// de competência `mesAlvo` — ver CLAUDE.md "Recorrência": horizonte é escolha de quem
// exibe, calculado na hora. `cartoesPorId` é um objeto/Map id->cartão, usado só pelas
// regras no crédito. Cada ocorrência ganha a flag `virtual: true`.
export function projetarOcorrenciasDoMes(regras, mesAlvo, cartoesPorId = {}) {
  return regras
    .filter((regra) => recorrenciaAtivaNoMes(regra, mesAlvo))
    .map((regra) => ({
      ...gerarOcorrenciaRecorrencia(regra, mesAlvo, cartoesPorId[regra.cartaoId]),
      virtual: true
    }));
}

// Ocorrências virtuais cujo DESEMBOLSO (eixo PRINCIPAL) cai em `mesAlvo`: inclui as de
// competência mesAlvo (não-crédito, ou crédito que não empurra o mês) e as de
// competência do mês anterior quando o ciclo de fatura empurra o vencimento pra
// mesAlvo (ver CLAUDE.md "Vencimento e mês de desembolso" — o desembolso de uma compra
// em T só pode cair em T ou T+1, nunca além, então só é preciso olhar 1 mês pra trás).
export function projetarOcorrenciasPorDesembolso(regras, mesAlvo, cartoesPorId = {}) {
  const mesAnterior = somarMeses(mesAlvo, -1);
  const candidatos = [
    ...projetarOcorrenciasDoMes(regras, mesAlvo, cartoesPorId),
    ...projetarOcorrenciasDoMes(regras, mesAnterior, cartoesPorId)
  ];
  return candidatos.filter((ocorrencia) => ocorrencia.mesDesembolso === mesAlvo);
}

// --- Caixa (saldo acumulado real) — ver CLAUDE.md "Caixa (saldo acumulado real)" ---
// Predicados puros (sem Firebase) que decidem se um lançamento JÁ GRAVADO corresponde a
// um evento que move o caixa de verdade, e por qual origem — reaproveitados tanto por
// db.js (excluirLancamento, pra saber se precisa estornar) quanto por ui/lancamento.js
// (edição de valor, pra saber se precisa ajustar a diferença). Nenhum dos dois recalcula
// essa decisão do zero — só chamam esta função.
//
// Um lançamento pode ter chegado a mover o caixa por 3 caminhos diferentes:
//   1) lançamento MANUAL imediato (ui/lancamento.js sempre seta `paraTerceiro`
//      explicitamente pra tudo que cria — nenhuma outra origem faz isso);
//   2) a receita gerada por db.js `marcarRecebivelRecebido` (sempre categoriaId
//      "recebimentos_terceiros" + idReembolso, e NUNCA seta `paraTerceiro`);
//   3) uma recorrência materializada (`idRecorrencia` presente) que já foi marcada como
//      paga (`pago === true`) — antes disso ela existe mas não moveu nada ainda.
// Crédito nunca move o caixa na criação (só na baixa da fatura, via pagarFaturaEmLote,
// que já cobre pagamento_cartao à parte).
// Identifica especificamente a receita gerada por db.js `marcarRecebivelRecebido` (na
// baixa de um recebível) — reusado tanto pelos predicados de caixa abaixo quanto por
// ui/mes.js, que precisa desviar o "Desfazer" desse item pra `desfazerRecebimento` em vez
// do toggle genérico de `pago` (ver CLAUDE.md "Crédito a receber"). `marcarRecebivelRecebido`
// sempre grava categoriaId "recebimentos_terceiros" + idReembolso, e NUNCA seta
// `paraTerceiro` (só o formulário de lançamento manual seta esse campo).
export function ehReceitaDeRecebivel(lancamento) {
  return !!(
    lancamento &&
    lancamento.categoriaId === "recebimentos_terceiros" &&
    lancamento.idReembolso &&
    lancamento.paraTerceiro === undefined
  );
}

export function lancamentoMoveCaixa(lancamento) {
  if (!lancamento) return false;
  if (lancamento.meioPagamento === "credito") return false;
  if (lancamento.categoriaId === "pagamento_cartao") return false; // tratado à parte

  if (lancamento.paraTerceiro !== undefined && !lancamento.idRecorrencia) return true;
  if (ehReceitaDeRecebivel(lancamento)) return true;
  if (lancamento.idRecorrencia && lancamento.pago === true) return true;

  return false;
}

// Dado um lançamento que `lancamentoMoveCaixa` considera relevante, devolve a origem
// (ver enum documentado no CLAUDE.md) que foi usada quando o movimento original de caixa
// foi gravado — pra um estorno referenciar a origem certa, não sempre "despesa_imediata"/
// "receita".
export function origemCaixaDoLancamento(lancamento) {
  if (lancamento.idRecorrencia) return "recorrencia_paga";
  if (ehReceitaDeRecebivel(lancamento)) return "recebivel";
  return lancamento.tipo === "receita" ? "receita" : "despesa_imediata";
}

// Resolve o `responsavel` (chave de /membros) a partir do uid de quem está logado — ver
// CLAUDE.md "Atribuição por pessoa (revisado)": responsavel agora é SEMPRE automático
// (nunca escolhido manualmente) e "casal" não existe mais como valor possível. Usada por
// ui/lancamento.js e ui/recorrencias.js, que já têm a lista de /membros carregada em
// cache — evita repetir esta consulta em cada arquivo. Fallback sensato se o uid não
// bater com nenhum /membros (não deveria acontecer dado a allowlist, mas não trava o
// salvamento): devolve o próprio uid; quem chama decide se registra um aviso.
export function resolverResponsavelPorUid(membros, uid) {
  const membro = (membros || []).find((m) => m.uid === uid);
  return membro && membro.chave ? membro.chave : uid;
}
