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
// "2026-02-31" quando o diaVencimento do cartão não existe no mês de destino).
function diasNoMes(mesISO) {
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
