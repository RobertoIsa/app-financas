// ui/mes.js
// Tela "Mês": navegador de mês (‹ Agosto 2026 ›) — lista os lançamentos do mês
// selecionado (eixo GASTO/competência) e mostra os totais nos dois eixos de tempo
// (ver CLAUDE.md "Os dois eixos de tempo" e "Projeção mês a mês").

import {
  lerLancamentosDoMes,
  lerLancamentosPorMesDesembolso,
  lerRecebiveisPorMesEsperado,
  lerRecorrencias,
  lerCartoes,
  materializarOcorrencia,
  excluirLancamento // NOVA IMPORTAÇÃO
} from "../db.js";
import {
  formatCentavos,
  mesDeData,
  dataHojeISO,
  somarMeses,
  projetarOcorrenciasDoMes,
  projetarOcorrenciasPorDesembolso
} from "../logic.js";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatarMes(mesISO) {
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES[mes - 1]} ${ano}`;
}

export function initTelaMes({ categorias, uid }) {
  const rotulo = document.getElementById("mesnav-label");
  const btnAnterior = document.getElementById("mesnav-anterior");
  const btnProximo = document.getElementById("mesnav-proximo");
  const btnHoje = document.getElementById("mesnav-hoje");

  const elDesembolso = document.getElementById("mes-resumo-desembolso");
  const elGasto = document.getElementById("mes-resumo-gasto");
  const elEntradas = document.getElementById("mes-resumo-entradas");
  const elSaldo = document.getElementById("mes-resumo-saldo");
  const elPrevisto = document.getElementById("mes-resumo-previsto");
  const resumoRecorrenteItem = document.getElementById("mes-resumo-recorrente-item");
  const elRecorrente = document.getElementById("mes-resumo-recorrente");
  const recorrenciaStatusEl = document.getElementById("mes-recorrencia-status");

  const statusEl = document.getElementById("mes-lista-status");
  const listaEl = document.getElementById("mes-lista-lancamentos");

  const previstosSecao = document.getElementById("mes-previstos-secao");
  const listaPrevistosEl = document.getElementById("mes-lista-previstos");

  const recorrentesSecao = document.getElementById("mes-recorrentes-secao");
  const listaRecorrentesEl = document.getElementById("mes-lista-recorrentes");

  let categoriasCache = categorias;
  let mesSelecionado = mesDeData(dataHojeISO());
  let pedidoAtual = 0; 

  function criarItem(lancamento) {
    const item = document.createElement("li");
    item.className = "lanc-item";

    const linha = document.createElement("div");
    linha.className = "lanc-item-linha";

    const categoria = categoriasCache.find((c) => c.chave === lancamento.categoriaId);
    const icone = categoria?.icone ? `${categoria.icone} ` : "";
    const nomeCategoria = categoria?.nome || lancamento.categoriaId;

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    let textoDesc = `${icone}${lancamento.descricao || nomeCategoria}`;
    if (lancamento.totalParcelas > 1) {
      textoDesc += ` (${lancamento.parcelaAtual}/${lancamento.totalParcelas})`;
    }
    desc.textContent = textoDesc;

    const valor = document.createElement("span");
    valor.className = `lanc-valor lanc-${lancamento.tipo}`;
    const sinal = lancamento.tipo === "receita" ? "+" : "−";
    valor.textContent = `${sinal} ${formatCentavos(lancamento.valorCentavos)}`;

    // BOTÃO DE EXCLUSÃO
    const btnExcluir = document.createElement("button");
    btnExcluir.innerHTML = "🗑️"; 
    btnExcluir.style.marginLeft = "12px";
    btnExcluir.style.background = "transparent";
    btnExcluir.style.border = "none";
    btnExcluir.style.cursor = "pointer";
    btnExcluir.title = "Excluir lançamento";

    btnExcluir.addEventListener("click", async () => {
      const confirmacao = confirm(`Tem certeza que deseja excluir o lançamento "${lancamento.descricao}" no valor de R$ ${formatCentavos(lancamento.valorCentavos)}?\n\nEsta ação não pode ser desfeita.`);
      if (confirmacao) {
        try {
          btnExcluir.disabled = true;
          btnExcluir.style.opacity = "0.5";
          await excluirLancamento(lancamento);
          carregar(); // Recarrega a lista e ajusta os saldos imediatamente
        } catch (erro) {
          console.error("Erro ao excluir:", erro);
          alert("Erro ao excluir o lançamento.");
          btnExcluir.disabled = false;
          btnExcluir.style.opacity = "1";
        }
      }
    });

    // Agrupa o valor e o botão na direita
    const acoesDiv = document.createElement("div");
    acoesDiv.style.display = "flex";
    acoesDiv.style.alignItems = "center";
    acoesDiv.appendChild(valor);
    acoesDiv.appendChild(btnExcluir);

    linha.appendChild(desc);
    linha.appendChild(acoesDiv); // Adiciona o grupo com o valor e o botão
    item.appendChild(linha);

    if (lancamento.meioPagamento === "credito" && lancamento.faturaMes) {
      const faturaEl = document.createElement("span");
      faturaEl.className = "lanc-fatura";
      faturaEl.textContent = lancamento.vencimento
        ? `Fatura ${lancamento.faturaMes} · sai da conta em ${lancamento.vencimento}`
        : `Fatura ${lancamento.faturaMes}`;
      item.appendChild(faturaEl);
    }

    if (lancamento.idRecorrencia) {
      const badge = document.createElement("span");
      badge.className = "badge-recorrente";
      badge.textContent = "Recorrente";
      item.appendChild(badge);
    }

    return item;
  }

  function criarItemPrevisto(recebivel) {
    const item = document.createElement("li");
    item.className = "lanc-item";

    const linha = document.createElement("div");
    linha.className = "lanc-item-linha";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    let texto = recebivel.devedor;
    if (recebivel.totalParcelas > 1) {
      texto += ` (${recebivel.parcelaAtual}/${recebivel.totalParcelas})`;
    }
    desc.textContent = texto;

    const valor = document.createElement("span");
    valor.className = "lanc-valor lanc-receita";
    valor.textContent = `+ ${formatCentavos(recebivel.valorCentavos)}`;

    linha.appendChild(desc);
    linha.appendChild(valor);
    item.appendChild(linha);

    const badge = document.createElement("span");
    badge.className = "badge-previsto";
    badge.textContent = "Previsto · a receber";
    item.appendChild(badge);

    return item;
  }

  function criarItemRecorrenteVirtual(ocorrencia) {
    const item = document.createElement("li");
    item.className = "lanc-item";

    const linha = document.createElement("div");
    linha.className = "lanc-item-linha";

    const categoria = categoriasCache.find((c) => c.chave === ocorrencia.categoriaId);
    const icone = categoria?.icone ? `${categoria.icone} ` : "";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.textContent = `${icone}${ocorrencia.descricao}`;

    const valor = document.createElement("span");
    valor.className = `lanc-valor lanc-${ocorrencia.tipo}`;
    const sinal = ocorrencia.tipo === "receita" ? "+" : "−";
    valor.textContent = `${sinal} ${formatCentavos(ocorrencia.valorCentavos)}`;

    linha.appendChild(desc);
    linha.appendChild(valor);
    item.appendChild(linha);

    const badge = document.createElement("span");
    badge.className = "badge-previsto";
    badge.textContent = "Previsto · recorrente";
    item.appendChild(badge);

    return item;
  }

  async function carregar() {
    const meuPedido = ++pedidoAtual;
    rotulo.textContent = formatarMes(mesSelecionado);
    statusEl.textContent = "Carregando lançamentos...";
    listaEl.innerHTML = "";
    listaPrevistosEl.innerHTML = "";
    listaRecorrentesEl.innerHTML = "";
    previstosSecao.hidden = true;
    recorrentesSecao.hidden = true;
    resumoRecorrenteItem.hidden = true;
    recorrenciaStatusEl.textContent = "";
    elDesembolso.textContent = "—";
    elGasto.textContent = "—";
    elEntradas.textContent = "—";
    elSaldo.textContent = "—";
    elPrevisto.textContent = "—";

    try {
      let [lancamentosDoMes, lancamentosDesembolso, recebiveisDoMes, cartoes, recorrencias] = await Promise.all([
        lerLancamentosDoMes(mesSelecionado),
        lerLancamentosPorMesDesembolso(mesSelecionado),
        lerRecebiveisPorMesEsperado(mesSelecionado),
        lerCartoes(),
        lerRecorrencias()
      ]);
      if (meuPedido !== pedidoAtual) return; 

      const cartoesPorId = Object.fromEntries(cartoes.map((c) => [c.id, c]));
      const mesAtual = mesDeData(dataHojeISO());

      let recorrentesVirtuaisCompetencia = [];
      let recorrentesVirtuaisDesembolso = [];

      if (mesSelecionado <= mesAtual) {
        const ocorrenciasEsperadas = projetarOcorrenciasDoMes(recorrencias, mesSelecionado, cartoesPorId);
        const faltantes = ocorrenciasEsperadas.filter(
          (oc) => !lancamentosDoMes.some((l) => l.idRecorrencia === oc.idRecorrencia)
        );
        if (faltantes.length > 0) {
          await Promise.all(faltantes.map((oc) => materializarOcorrencia(oc, uid)));
          if (meuPedido !== pedidoAtual) return;
          [lancamentosDoMes, lancamentosDesembolso] = await Promise.all([
            lerLancamentosDoMes(mesSelecionado),
            lerLancamentosPorMesDesembolso(mesSelecionado)
          ]);
          if (meuPedido !== pedidoAtual) return;
          recorrenciaStatusEl.textContent = `${faltantes.length} recorrência(s) lançada(s) automaticamente este mês.`;
        }
      } else {
        recorrentesVirtuaisCompetencia = projetarOcorrenciasDoMes(recorrencias, mesSelecionado, cartoesPorId);
        recorrentesVirtuaisDesembolso = projetarOcorrenciasPorDesembolso(recorrencias, mesSelecionado, cartoesPorId)
          .filter((oc) => oc.mes > mesAtual);
      }

      const recebiveisPendentes = recebiveisDoMes.filter((r) => r.status === "pendente");

      const gastoCompetencia = lancamentosDoMes
        .filter((l) => l.tipo === "despesa")
        .reduce((soma, l) => soma + l.valorCentavos, 0)
        + recorrentesVirtuaisCompetencia
          .filter((oc) => oc.tipo === "despesa")
          .reduce((soma, oc) => soma + oc.valorCentavos, 0);

      const saidasRecorrentesVirtuais = recorrentesVirtuaisDesembolso
        .filter((oc) => oc.tipo === "despesa")
        .reduce((soma, oc) => soma + oc.valorCentavos, 0);
      const entradasRecorrentesVirtuais = recorrentesVirtuaisDesembolso
        .filter((oc) => oc.tipo === "receita")
        .reduce((soma, oc) => soma + oc.valorCentavos, 0);

      const saidasDesembolso = lancamentosDesembolso
        .filter((l) => l.tipo === "despesa")
        .reduce((soma, l) => soma + l.valorCentavos, 0)
        + saidasRecorrentesVirtuais;

      const entradasConfirmadas = lancamentosDesembolso
        .filter((l) => l.tipo === "receita")
        .reduce((soma, l) => soma + l.valorCentavos, 0);

      const entradasPrevistas = recebiveisPendentes.reduce((soma, r) => soma + r.valorCentavos, 0);
      const entradasTotais = entradasConfirmadas + entradasPrevistas + entradasRecorrentesVirtuais;

      const saldo = entradasTotais - saidasDesembolso;

      elDesembolso.textContent = formatCentavos(saidasDesembolso);
      elGasto.textContent = formatCentavos(gastoCompetencia);
      elEntradas.textContent = formatCentavos(entradasTotais);
      elPrevisto.textContent = formatCentavos(entradasPrevistas);
      elSaldo.textContent = formatCentavos(saldo);
      elSaldo.classList.toggle("lanc-despesa", saldo < 0);
      elSaldo.classList.toggle("lanc-receita", saldo >= 0);

      if (recorrentesVirtuaisDesembolso.length > 0) {
        const recorrenteLiquido = entradasRecorrentesVirtuais - saidasRecorrentesVirtuais;
        resumoRecorrenteItem.hidden = false;
        elRecorrente.textContent = formatCentavos(recorrenteLiquido);
        elRecorrente.classList.toggle("lanc-despesa", recorrenteLiquido < 0);
        elRecorrente.classList.toggle("lanc-receita", recorrenteLiquido >= 0);
      }

      if (recebiveisPendentes.length > 0) {
        previstosSecao.hidden = false;
        for (const recebivel of recebiveisPendentes) {
          listaPrevistosEl.appendChild(criarItemPrevisto(recebivel));
        }
      }

      if (recorrentesVirtuaisCompetencia.length > 0) {
        recorrentesSecao.hidden = false;
        for (const ocorrencia of recorrentesVirtuaisCompetencia) {
          listaRecorrentesEl.appendChild(criarItemRecorrenteVirtual(ocorrencia));
        }
      }

      if (lancamentosDoMes.length === 0) {
        statusEl.textContent = "Nenhum lançamento neste mês.";
        return;
      }
      lancamentosDoMes.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
      statusEl.textContent = `${lancamentosDoMes.length} lançamento(s) em ${formatarMes(mesSelecionado)}:`;
      for (const lancamento of lancamentosDoMes) {
        listaEl.appendChild(criarItem(lancamento));
      }
    } catch (erro) {
      if (meuPedido !== pedidoAtual) return;
      statusEl.textContent = `Erro ao carregar lançamentos: ${erro.message || erro.code || "erro desconhecido"}`;
    }
  }

  btnAnterior.addEventListener("click", () => {
    mesSelecionado = somarMeses(mesSelecionado, -1);
    carregar();
  });
  btnProximo.addEventListener("click", () => {
    mesSelecionado = somarMeses(mesSelecionado, 1);
    carregar();
  });
  btnHoje.addEventListener("click", () => {
    mesSelecionado = mesDeData(dataHojeISO());
    carregar();
  });

  carregar();

  return {
    recarregarCategorias(novaListaCategorias) {
      categoriasCache = novaListaCategorias;
    },
    recarregar: carregar
  };
}