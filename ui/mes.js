// ui/mes.js
// Tela "Mês": navegador de mês (‹ Agosto 2026 ›) — lista os lançamentos do mês
// selecionado (eixo GASTO/competência) e mostra os totais nos dois eixos de tempo
// (ver CLAUDE.md "Os dois eixos de tempo" e "Projeção mês a mês").

import { lerLancamentosDoMes, lerLancamentosPorMesDesembolso } from "../db.js";
import { formatCentavos, mesDeData, dataHojeISO, somarMeses } from "../logic.js";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatarMes(mesISO) {
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES[mes - 1]} ${ano}`;
}

// Inicializa a tela "Mês". `categorias` vem já carregada pelo app.js (ícone/nome pra
// exibir cada lançamento). A tela mantém seu próprio estado de mês selecionado,
// independente do mês atual mostrado na tela de Lançamento.
export function initTelaMes({ categorias }) {
  const rotulo = document.getElementById("mesnav-label");
  const btnAnterior = document.getElementById("mesnav-anterior");
  const btnProximo = document.getElementById("mesnav-proximo");
  const btnHoje = document.getElementById("mesnav-hoje");

  const elDesembolso = document.getElementById("mes-resumo-desembolso");
  const elGasto = document.getElementById("mes-resumo-gasto");
  const elEntradas = document.getElementById("mes-resumo-entradas");
  const elSaldo = document.getElementById("mes-resumo-saldo");

  const statusEl = document.getElementById("mes-lista-status");
  const listaEl = document.getElementById("mes-lista-lancamentos");

  let categoriasCache = categorias;
  let mesSelecionado = mesDeData(dataHojeISO());
  let pedidoAtual = 0; // evita que uma resposta antiga (mês trocado rápido) sobrescreva a atual

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

    linha.appendChild(desc);
    linha.appendChild(valor);
    item.appendChild(linha);

    if (lancamento.meioPagamento === "credito" && lancamento.faturaMes) {
      const faturaEl = document.createElement("span");
      faturaEl.className = "lanc-fatura";
      faturaEl.textContent = lancamento.vencimento
        ? `Fatura ${lancamento.faturaMes} · sai da conta em ${lancamento.vencimento}`
        : `Fatura ${lancamento.faturaMes}`;
      item.appendChild(faturaEl);
    }

    return item;
  }

  async function carregar() {
    const meuPedido = ++pedidoAtual;
    rotulo.textContent = formatarMes(mesSelecionado);
    statusEl.textContent = "Carregando lançamentos...";
    listaEl.innerHTML = "";
    elDesembolso.textContent = "—";
    elGasto.textContent = "—";
    elEntradas.textContent = "—";
    elSaldo.textContent = "—";

    try {
      const [lancamentosDoMes, lancamentosDesembolso] = await Promise.all([
        lerLancamentosDoMes(mesSelecionado),
        lerLancamentosPorMesDesembolso(mesSelecionado)
      ]);
      if (meuPedido !== pedidoAtual) return; // usuário já navegou pra outro mês

      const gastoCompetencia = lancamentosDoMes
        .filter((l) => l.tipo === "despesa")
        .reduce((soma, l) => soma + l.valorCentavos, 0);

      const saidasDesembolso = lancamentosDesembolso
        .filter((l) => l.tipo === "despesa")
        .reduce((soma, l) => soma + l.valorCentavos, 0);

      const entradasDesembolso = lancamentosDesembolso
        .filter((l) => l.tipo === "receita")
        .reduce((soma, l) => soma + l.valorCentavos, 0);

      const saldo = entradasDesembolso - saidasDesembolso;

      elDesembolso.textContent = formatCentavos(saidasDesembolso);
      elGasto.textContent = formatCentavos(gastoCompetencia);
      elEntradas.textContent = formatCentavos(entradasDesembolso);
      elSaldo.textContent = formatCentavos(saldo);
      elSaldo.classList.toggle("lanc-despesa", saldo < 0);
      elSaldo.classList.toggle("lanc-receita", saldo >= 0);

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
    // Chamado pelo app.js se o catálogo de categorias mudar, pra manter ícone/nome
    // exibidos na lista em dia (hoje não há tela que edite categorias, mas fica pronto).
    recarregarCategorias(novaListaCategorias) {
      categoriasCache = novaListaCategorias;
    }
  };
}
