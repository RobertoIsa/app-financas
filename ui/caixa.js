// ui/caixa.js
// Aba "Caixa": saldo acumulado real (nunca reseta por mês, nasce em R$0) + extrato dos
// movimentos que de fato mexeram o dinheiro — ver CLAUDE.md "Caixa (saldo acumulado
// real)". Não confundir com o "Saldo do Mês"/"Saldo Projetado" (por mês) das abas
// Mês/Dashboard; este é o total acumulado desde o início do uso.

import { lerSaldoCaixa, lerMovimentosCaixaRecentes } from "../db.js";
import { formatCentavos } from "../logic.js";

// Traduz o campo "origem" (ver schema /caixa/movimentos no CLAUDE.md) pra um rótulo
// legível. Origens ainda não ligadas nesta leva (recebivel, recorrencia_paga) já ficam
// traduzidas, prontas pra quando a Leva 2 passar a gerá-las.
const ORIGENS_LEGIVEIS = {
  despesa_imediata: "Despesa imediata",
  pagamento_fatura: "Pagamento de fatura",
  receita: "Receita",
  recebivel: "Recebimento de terceiro",
  recorrencia_paga: "Recorrência paga",
  ajuste_edicao: "Ajuste de edição"
};

function nomeOrigem(origem) {
  return ORIGENS_LEGIVEIS[origem] || origem || "Outro";
}

function formatarDataHora(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function initTelaCaixa() {
  const saldoEl = document.getElementById("caixa-saldo-valor");
  const statusEl = document.getElementById("caixa-status");
  const listaEl = document.getElementById("lista-caixa-movimentos");

  async function carregar() {
    if (statusEl) statusEl.textContent = "Carregando...";
    if (saldoEl) saldoEl.textContent = "—";
    if (listaEl) listaEl.innerHTML = "";

    try {
      const [saldo, movimentos] = await Promise.all([
        lerSaldoCaixa(),
        lerMovimentosCaixaRecentes(50)
      ]);

      if (saldoEl) {
        saldoEl.textContent = formatCentavos(saldo.valorCentavos);
        saldoEl.classList.remove("lanc-receita", "lanc-despesa");
        if (saldo.valorCentavos < 0) saldoEl.classList.add("lanc-despesa");
        else if (saldo.valorCentavos > 0) saldoEl.classList.add("lanc-receita");
      }

      if (statusEl) {
        statusEl.textContent = movimentos.length === 0
          ? "Nenhum movimento registrado ainda."
          : `Últimos ${movimentos.length} movimento(s):`;
      }

      if (listaEl) {
        listaEl.innerHTML = "";
        if (movimentos.length === 0) {
          listaEl.innerHTML = "<li class='lanc-item'>Nenhum movimento de caixa ainda.</li>";
        }
        movimentos.forEach((mov) => {
          const li = document.createElement("li");
          li.className = "lanc-item";

          const linha = document.createElement("div");
          linha.className = "lanc-item-linha";

          const desc = document.createElement("span");
          desc.className = "lanc-desc";
          const prefixo = mov.estorno ? "↩️ Estorno: " : "";
          desc.textContent = `${prefixo}${nomeOrigem(mov.origem)} — ${formatarDataHora(mov.criadoEm)}`;

          const valor = document.createElement("span");
          valor.className = `lanc-valor ${mov.tipo === "entrada" ? "lanc-receita" : "lanc-despesa"}`;
          const sinal = mov.tipo === "entrada" ? "+" : "−";
          valor.textContent = `${sinal} ${formatCentavos(mov.valorCentavos)}`;

          linha.appendChild(desc);
          linha.appendChild(valor);
          li.appendChild(linha);
          listaEl.appendChild(li);
        });
      }
    } catch (erro) {
      console.error(erro);
      if (statusEl) {
        statusEl.textContent = `Erro ao carregar o Caixa: ${erro.message || erro.code || "erro desconhecido"}`;
      }
    }
  }

  carregar();

  return {
    recarregar: carregar
  };
}
