// ui/dashboard.js
// Aba "Dashboard": projeção de vários meses à frente (faixa de meses) + detalhe do mês
// selecionado (por categoria e por pessoa). Ver CLAUDE.md "Projeção / Dashboard" e
// "Os dois eixos de tempo".
//
// IMPORTANTE: esta tela é só LEITURA — nunca materializa recorrências (isso continua
// sendo responsabilidade exclusiva da aba Mês, ver ui/mes.js). Os totais aqui reusam as
// mesmas funções já testadas de db.js/logic.js (mesDesembolso, ciclo de fatura,
// recebíveis pendentes, projeção virtual de recorrência) — nenhuma regra de negócio é
// recalculada do zero. Para um mês ainda não materializado, a ocorrência de recorrência
// entra como projeção virtual no total (sem gravar nada), então o número bate com o que
// vai aparecer na aba Mês quando ela materializar de verdade.

import {
  lerLancamentosDoMes,
  lerLancamentosPorMesDesembolso,
  lerLancamentosPorFaturaMes,
  lerRecebiveisPorMesEsperado,
  lerRecorrencias,
  lerCartoes
} from "../db.js";
import {
  formatCentavos,
  mesDeData,
  dataHojeISO,
  somarMeses,
  projetarOcorrenciasDoMes,
  projetarOcorrenciasPorDesembolso,
  obterMesDesembolso
} from "../logic.js";

const NOMES_MES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez"
];
const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatarMesAbrev(mesISO) {
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES_ABREV[mes - 1]}/${String(ano).slice(2)}`;
}

function formatarMesCompleto(mesISO) {
  if (!mesISO) return "";
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES[mes - 1]} ${ano}`;
}

const HORIZONTE_MIN = 1;
const HORIZONTE_MAX = 12;
const HORIZONTE_PADRAO = 6;

export function initTelaDashboard({ categorias, membros, uid }) {
  const botoesAtalhoHorizonte = document.querySelectorAll(".dash-horizonte-botao");
  const inputHorizonteLivre = document.getElementById("dash-horizonte-input");
  const btnAplicarHorizonte = document.getElementById("dash-horizonte-aplicar");
  const erroHorizonteEl = document.getElementById("dash-horizonte-erro");
  const statusEl = document.getElementById("dash-status");
  const faixaEl = document.getElementById("dash-faixa");
  const detalheMesLabel = document.getElementById("dash-detalhe-mes-label");
  const listaCategorias = document.getElementById("dash-lista-categorias");
  const listaPessoas = document.getElementById("dash-lista-pessoas");

  let categoriasCache = categorias || [];
  let membrosCache = membros || [];
  let horizonte = HORIZONTE_PADRAO;
  let mesFocado = mesDeData(dataHojeISO());
  let pedidoAtual = 0;

  // Cache por mês dos resumos já calculados nesta sessão da tela — reaproveitado tanto
  // ao trocar o horizonte (meses já vistos não são reconsultados) quanto ao focar um mês
  // da faixa pro detalhe (não duplica consulta ao banco, como pedido).
  const cacheResumoPorMes = new Map();

  function nomeIconeCategoria(categoriaId) {
    const cat = categoriasCache.find((c) => c.chave === categoriaId);
    if (!cat) return categoriaId || "Sem categoria";
    return `${cat.nome}${cat.icone ? " " + cat.icone : ""}`;
  }

  function nomePessoa(chave) {
    if (chave === "casal") return "Casal";
    const membro = membrosCache.find((m) => m.chave === chave);
    return membro ? membro.nome : (chave || "Casal");
  }

  function ordemPessoas() {
    const chaves = membrosCache.filter((m) => m.ativo !== false).map((m) => m.chave);
    if (!chaves.includes("casal")) chaves.push("casal");
    return chaves;
  }

  // Calcula o resumo de UM mês (saídas previstas, entradas previstas, saldo), reusando
  // exatamente as mesmas funções e regras validadas na aba Mês — ver comentário no topo
  // do arquivo. Não escreve nada no banco.
  async function calcularResumoDoMes(mes, cartoesPorId, recorrencias) {
    if (cacheResumoPorMes.has(mes)) return cacheResumoPorMes.get(mes);

    const promessa = (async () => {
      const [
        lancamentosCompetencia,
        lancamentosDesembolso,
        lancamentosFaturaAtual,
        lancamentosFaturaAnterior,
        recebiveisDoMes
      ] = await Promise.all([
        lerLancamentosDoMes(mes),
        lerLancamentosPorMesDesembolso(mes),
        lerLancamentosPorFaturaMes(mes),
        lerLancamentosPorFaturaMes(somarMeses(mes, -1)),
        lerRecebiveisPorMesEsperado(mes)
      ]);

      // Eixo desembolso: mescla a busca oficial por mesDesembolso com o fallback por
      // faturaMes (mesma lógica da aba Mês, ver ui/mes.js e logic.js obterMesDesembolso).
      const porIdDesembolso = new Map();
      lancamentosDesembolso.forEach((l) => porIdDesembolso.set(l.id, l));
      [...lancamentosFaturaAtual, ...lancamentosFaturaAnterior].forEach((l) => {
        if (!porIdDesembolso.has(l.id)) porIdDesembolso.set(l.id, l);
      });
      const despesasCreditoDoMes = [...porIdDesembolso.values()].filter(
        (l) => l.tipo === "despesa" && l.meioPagamento === "credito" && obterMesDesembolso(l) === mes
      );

      // Recorrências ainda não materializadas (sem gravar nada — só projeção virtual).
      const ocorrenciasCompetencia = projetarOcorrenciasDoMes(recorrencias, mes, cartoesPorId);
      const faltantesCompetencia = ocorrenciasCompetencia.filter(
        (oc) => !lancamentosCompetencia.some((l) => l.idRecorrencia === oc.idRecorrencia)
      );
      const ocorrenciasPorDesembolso = projetarOcorrenciasPorDesembolso(recorrencias, mes, cartoesPorId);
      const faltantesCreditoDesembolso = ocorrenciasPorDesembolso.filter(
        (oc) => oc.meioPagamento === "credito" &&
          !despesasCreditoDoMes.some((l) => l.idRecorrencia === oc.idRecorrencia)
      );

      // ---- saídas previstas (eixo desembolso — CLAUDE.md "Projeção mês a mês") ----
      let totalFaturas = 0;
      despesasCreditoDoMes.forEach((l) => { totalFaturas += l.valorCentavos; });
      faltantesCreditoDesembolso.forEach((oc) => { totalFaturas += oc.valorCentavos; });

      let totalVista = 0;
      lancamentosCompetencia
        .filter((l) => l.tipo === "despesa" && l.meioPagamento !== "credito" && l.categoriaId !== "pagamento_cartao")
        .forEach((l) => { totalVista += l.valorCentavos; });
      faltantesCompetencia
        .filter((oc) => oc.tipo === "despesa" && oc.meioPagamento !== "credito")
        .forEach((oc) => { totalVista += oc.valorCentavos; });

      const totalSaidas = totalFaturas + totalVista;

      // ---- entradas previstas: receitas confirmadas + recebíveis pendentes +
      // recorrências de receita ----
      let totalReceitasConfirmadas = 0;
      lancamentosDesembolso
        .filter((l) => l.tipo === "receita")
        .forEach((l) => { totalReceitasConfirmadas += l.valorCentavos; });

      let totalReceitasRecorrentes = 0;
      faltantesCompetencia
        .filter((oc) => oc.tipo === "receita")
        .forEach((oc) => { totalReceitasRecorrentes += oc.valorCentavos; });

      let totalRecebiveisPendentes = 0;
      recebiveisDoMes
        .filter((r) => r.status === "pendente")
        .forEach((r) => { totalRecebiveisPendentes += r.valorCentavos; });

      const totalEntradas = totalReceitasConfirmadas + totalReceitasRecorrentes + totalRecebiveisPendentes;

      return {
        mes,
        totalSaidas,
        totalEntradas,
        saldo: totalEntradas - totalSaidas,
        // guardado pra alimentar o detalhe (categoria/pessoa) sem reconsultar o banco
        lancamentosCompetencia,
        faltantesCompetencia
      };
    })();

    cacheResumoPorMes.set(mes, promessa);
    return promessa;
  }

  function agruparPorCategoria(resumo) {
    const despesasReais = resumo.lancamentosCompetencia.filter(
      (l) => l.tipo === "despesa" && l.categoriaId !== "pagamento_cartao"
    );
    const despesasVirtuais = resumo.faltantesCompetencia.filter((oc) => oc.tipo === "despesa");

    const totais = new Map();
    [...despesasReais, ...despesasVirtuais].forEach((item) => {
      const catId = item.categoriaId || "outros";
      totais.set(catId, (totais.get(catId) || 0) + item.valorCentavos);
    });

    return [...totais.entries()]
      .map(([categoriaId, total]) => ({ categoriaId, total }))
      .sort((a, b) => b.total - a.total);
  }

  function agruparPorPessoa(resumo) {
    const itensReais = resumo.lancamentosCompetencia.filter((l) => l.categoriaId !== "pagamento_cartao");
    const itensVirtuais = resumo.faltantesCompetencia;

    const totais = new Map();
    [...itensReais, ...itensVirtuais].forEach((item) => {
      const resp = item.responsavel || "casal";
      if (!totais.has(resp)) totais.set(resp, { despesas: 0, receitas: 0 });
      const grupo = totais.get(resp);
      if (item.tipo === "despesa") grupo.despesas += item.valorCentavos;
      else if (item.tipo === "receita") grupo.receitas += item.valorCentavos;
    });

    return ordemPessoas().map((chave) => {
      const grupo = totais.get(chave) || { despesas: 0, receitas: 0 };
      return { chave, ...grupo, saldo: grupo.receitas - grupo.despesas };
    });
  }

  function renderizarFaixa(resumos) {
    if (!faixaEl) return;
    faixaEl.innerHTML = "";

    if (resumos.length === 0) {
      faixaEl.innerHTML = "<li class='lanc-item'>Nenhum mês pra mostrar.</li>";
      return;
    }

    const maiorValor = Math.max(1, ...resumos.map((r) => Math.max(r.totalSaidas, r.totalEntradas)));

    resumos.forEach((resumo) => {
      const item = document.createElement("li");

      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "dash-faixa-botao";
      if (resumo.mes === mesFocado) botao.classList.add("dash-selecionado");
      if (resumo.saldo < 0) botao.classList.add("dash-negativo");

      const linhaTopo = document.createElement("div");
      linhaTopo.className = "dash-faixa-linha-topo";

      const rotuloMes = document.createElement("span");
      rotuloMes.className = "dash-faixa-mes";
      rotuloMes.textContent = formatarMesAbrev(resumo.mes);

      const rotuloSaldo = document.createElement("span");
      rotuloSaldo.className = `dash-faixa-saldo ${resumo.saldo < 0 ? "lanc-despesa" : "lanc-receita"}`;
      rotuloSaldo.textContent = formatCentavos(resumo.saldo);

      linhaTopo.appendChild(rotuloMes);
      linhaTopo.appendChild(rotuloSaldo);
      botao.appendChild(linhaTopo);

      const valores = document.createElement("div");
      valores.className = "dash-faixa-valores";
      valores.innerHTML = `<span>⬆️ Entra: ${formatCentavos(resumo.totalEntradas)}</span><span>⬇️ Sai: ${formatCentavos(resumo.totalSaidas)}</span>`;
      botao.appendChild(valores);

      const barraSaida = document.createElement("div");
      barraSaida.className = "dash-barra-grupo";
      barraSaida.innerHTML = `<span class="dash-barra-rotulo">Sai</span><span class="dash-barra"><span class="dash-barra-saida" style="width:${(resumo.totalSaidas / maiorValor) * 100}%"></span></span>`;
      botao.appendChild(barraSaida);

      const barraEntrada = document.createElement("div");
      barraEntrada.className = "dash-barra-grupo";
      barraEntrada.innerHTML = `<span class="dash-barra-rotulo">Entra</span><span class="dash-barra"><span class="dash-barra-entrada" style="width:${(resumo.totalEntradas / maiorValor) * 100}%"></span></span>`;
      botao.appendChild(barraEntrada);

      botao.addEventListener("click", () => {
        mesFocado = resumo.mes;
        renderizarFaixa(resumos);
        renderizarDetalhe(resumo);
      });

      item.appendChild(botao);
      faixaEl.appendChild(item);
    });
  }

  function renderizarDetalhe(resumo) {
    if (detalheMesLabel) detalheMesLabel.textContent = formatarMesCompleto(resumo.mes);

    if (listaCategorias) {
      listaCategorias.innerHTML = "";
      const porCategoria = agruparPorCategoria(resumo);
      if (porCategoria.length === 0) {
        listaCategorias.innerHTML = "<li class='dash-item-simples'>Nenhuma despesa neste mês.</li>";
      } else {
        porCategoria.forEach(({ categoriaId, total }) => {
          const li = document.createElement("li");
          li.className = "dash-item-simples";
          const nome = document.createElement("span");
          nome.textContent = nomeIconeCategoria(categoriaId);
          const valor = document.createElement("span");
          valor.className = "lanc-valor lanc-despesa";
          valor.textContent = formatCentavos(total);
          li.appendChild(nome);
          li.appendChild(valor);
          listaCategorias.appendChild(li);
        });
      }
    }

    if (listaPessoas) {
      listaPessoas.innerHTML = "";
      const porPessoa = agruparPorPessoa(resumo);
      porPessoa.forEach(({ chave, despesas, receitas, saldo }) => {
        const li = document.createElement("li");
        li.className = "dash-item-simples dash-pessoa-item";

        const nome = document.createElement("span");
        nome.className = "dash-pessoa-nome";
        nome.textContent = nomePessoa(chave);

        const detalhe = document.createElement("span");
        detalhe.className = "dash-pessoa-detalhe";
        detalhe.innerHTML =
          `Despesas: <strong class="lanc-despesa">${formatCentavos(despesas)}</strong> · ` +
          `Receitas: <strong class="lanc-receita">${formatCentavos(receitas)}</strong> · ` +
          `Saldo: <strong class="${saldo < 0 ? "lanc-despesa" : "lanc-receita"}">${formatCentavos(saldo)}</strong>`;

        li.appendChild(nome);
        li.appendChild(detalhe);
        listaPessoas.appendChild(li);
      });
    }
  }

  async function carregar() {
    const meuPedido = ++pedidoAtual;

    try {
      if (statusEl) statusEl.textContent = "Carregando...";
      if (faixaEl) faixaEl.innerHTML = "<li>Carregando...</li>";

      const [cartoes, recorrencias] = await Promise.all([lerCartoes(), lerRecorrencias()]);
      if (meuPedido !== pedidoAtual) return;
      const cartoesPorId = Object.fromEntries(cartoes.map((c) => [c.id, c]));

      const mesInicial = mesDeData(dataHojeISO());
      const meses = [];
      for (let i = 0; i < horizonte; i++) {
        meses.push(somarMeses(mesInicial, i));
      }

      // Se o mês focado ficou fora da faixa atual (ex.: horizonte reduzido), volta pro
      // mês corrente.
      if (!meses.includes(mesFocado)) mesFocado = mesInicial;

      const resumos = await Promise.all(
        meses.map((mes) => calcularResumoDoMes(mes, cartoesPorId, recorrencias))
      );
      if (meuPedido !== pedidoAtual) return;

      if (statusEl) statusEl.textContent = "";
      renderizarFaixa(resumos);

      const resumoFocado = resumos.find((r) => r.mes === mesFocado) || resumos[0];
      if (resumoFocado) renderizarDetalhe(resumoFocado);
    } catch (erro) {
      console.error(erro);
      if (statusEl) statusEl.textContent = `Erro ao carregar o dashboard: ${erro.message || erro.code || "erro desconhecido"}`;
      if (faixaEl) faixaEl.innerHTML = "";
    }
  }

  // Reflete visualmente qual horizonte está ativo: destaca o atalho (3/6/12) que bate
  // com o valor atual, ou o campo livre quando o valor ativo é um número "avulso".
  function atualizarEstadoHorizonte() {
    let algumAtalhoAtivo = false;
    botoesAtalhoHorizonte.forEach((botao) => {
      const ativo = Number(botao.dataset.meses) === horizonte;
      botao.classList.toggle("dash-horizonte-ativo", ativo);
      if (ativo) algumAtalhoAtivo = true;
    });
    if (inputHorizonteLivre) {
      inputHorizonteLivre.value = horizonte;
      inputHorizonteLivre.classList.toggle("dash-horizonte-ativo", !algumAtalhoAtivo);
    }
  }

  function definirHorizonte(novoValor) {
    if (erroHorizonteEl) erroHorizonteEl.textContent = "";
    horizonte = novoValor;
    atualizarEstadoHorizonte();
    carregar();
  }

  function aplicarHorizonteLivre() {
    if (!inputHorizonteLivre) return;
    const valor = parseInt(inputHorizonteLivre.value, 10);
    if (!Number.isInteger(valor) || valor < HORIZONTE_MIN || valor > HORIZONTE_MAX) {
      if (erroHorizonteEl) {
        erroHorizonteEl.textContent = `Digite um número entre ${HORIZONTE_MIN} e ${HORIZONTE_MAX}.`;
      }
      return;
    }
    definirHorizonte(valor);
  }

  botoesAtalhoHorizonte.forEach((botao) => {
    botao.addEventListener("click", () => {
      const valor = Number(botao.dataset.meses);
      definirHorizonte(valor);
    });
  });

  if (btnAplicarHorizonte) {
    btnAplicarHorizonte.addEventListener("click", aplicarHorizonteLivre);
  }
  if (inputHorizonteLivre) {
    inputHorizonteLivre.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") {
        evento.preventDefault();
        aplicarHorizonteLivre();
      }
    });
  }

  atualizarEstadoHorizonte();
  carregar();

  return {
    recarregarCategorias(novaListaCategorias) {
      categoriasCache = novaListaCategorias || [];
      cacheResumoPorMes.clear();
      carregar();
    },
    recarregar() {
      cacheResumoPorMes.clear();
      carregar();
    }
  };
}
