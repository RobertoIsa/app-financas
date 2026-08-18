// ui/receber.js
// Painel "A Receber": lista os créditos a receber (compras para terceiros) pendentes,
// agrupados por devedor, com baixa (marcar recebido) e desfazer — ver CLAUDE.md
// "Crédito a receber (compra para terceiro)".

import {
  lerRecebiveisPorStatus,
  atualizarRecebivel,
  marcarRecebivelRecebido,
  desfazerRecebimento
} from "../db.js";
import { formatCentavos, dataHojeISO } from "../logic.js";

function formatarMesLabel(mesISO) {
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

// Inicializa a tela "A Receber". `uid` é usado como criadoPor na receita gerada na baixa.
export function initTelaReceber({ uid }) {
  const statusEl = document.getElementById("receber-status");
  const totaisEl = document.getElementById("receber-totais");
  const listaEl = document.getElementById("receber-lista");
  const recebidosStatusEl = document.getElementById("receber-recebidos-status");
  const recebidosListaEl = document.getElementById("receber-recebidos-lista");

  function alternarFormInline(item, classeExtra, montarForm) {
    const existente = item.querySelector(".recebivel-edicao");
    if (existente) {
      existente.remove();
      return;
    }
    const form = document.createElement("form");
    form.className = `recebivel-edicao lanc-item-edicao ${classeExtra}`;
    montarForm(form);
    item.appendChild(form);
  }

  function alternarFormMesEsperado(item, recebivel) {
    alternarFormInline(item, "recebivel-edicao-mes", (form) => {
      const campoMes = document.createElement("input");
      campoMes.type = "month";
      campoMes.value = recebivel.mesEsperado;
      campoMes.setAttribute("aria-label", "Novo mês esperado");

      const btnSalvar = document.createElement("button");
      btnSalvar.type = "submit";
      btnSalvar.textContent = "Salvar";
      btnSalvar.className = "botao-pequeno";

      const btnCancelar = document.createElement("button");
      btnCancelar.type = "button";
      btnCancelar.textContent = "Cancelar";
      btnCancelar.className = "botao-secundario botao-pequeno";
      btnCancelar.addEventListener("click", () => form.remove());

      const erro = document.createElement("p");
      erro.className = "erro";
      erro.setAttribute("role", "alert");

      form.appendChild(campoMes);
      form.appendChild(btnSalvar);
      form.appendChild(btnCancelar);
      form.appendChild(erro);

      form.addEventListener("submit", async (evento) => {
        evento.preventDefault();
        if (!campoMes.value) {
          erro.textContent = "Informe um mês válido.";
          return;
        }
        btnSalvar.disabled = true;
        btnSalvar.textContent = "Salvando...";
        try {
          await atualizarRecebivel(recebivel.id, { mesEsperado: campoMes.value });
          await carregar();
        } catch (err) {
          erro.textContent = `Erro ao salvar: ${err.message || err.code || "erro desconhecido"}`;
          btnSalvar.disabled = false;
          btnSalvar.textContent = "Salvar";
        }
      });
    });
  }

  function alternarFormRecebimento(item, recebivel) {
    alternarFormInline(item, "recebivel-edicao-baixa", (form) => {
      const campoData = document.createElement("input");
      campoData.type = "date";
      campoData.value = dataHojeISO();
      campoData.setAttribute("aria-label", "Data do recebimento");

      const btnConfirmar = document.createElement("button");
      btnConfirmar.type = "submit";
      btnConfirmar.textContent = "Confirmar recebimento";
      btnConfirmar.className = "botao-pequeno";

      const btnCancelar = document.createElement("button");
      btnCancelar.type = "button";
      btnCancelar.textContent = "Cancelar";
      btnCancelar.className = "botao-secundario botao-pequeno";
      btnCancelar.addEventListener("click", () => form.remove());

      const erro = document.createElement("p");
      erro.className = "erro";
      erro.setAttribute("role", "alert");

      form.appendChild(campoData);
      form.appendChild(btnConfirmar);
      form.appendChild(btnCancelar);
      form.appendChild(erro);

      form.addEventListener("submit", async (evento) => {
        evento.preventDefault();
        if (!campoData.value) {
          erro.textContent = "Informe a data do recebimento.";
          return;
        }
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = "Confirmando...";
        try {
          await marcarRecebivelRecebido(recebivel, campoData.value, uid);
          await carregar();
        } catch (err) {
          erro.textContent = `Erro ao confirmar: ${err.message || err.code || "erro desconhecido"}`;
          btnConfirmar.disabled = false;
          btnConfirmar.textContent = "Confirmar recebimento";
        }
      });
    });
  }

  function criarItemPendente(recebivel) {
    const item = document.createElement("li");
    item.className = "recebivel-item";

    const linha = document.createElement("div");
    linha.className = "lanc-item-linha";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    let texto = `Esperado ${formatarMesLabel(recebivel.mesEsperado)}`;
    if (recebivel.totalParcelas > 1) {
      texto += ` (${recebivel.parcelaAtual}/${recebivel.totalParcelas})`;
    }
    desc.textContent = texto;

    const valor = document.createElement("span");
    valor.className = "lanc-valor";
    valor.textContent = formatCentavos(recebivel.valorCentavos);

    linha.appendChild(desc);
    linha.appendChild(valor);
    item.appendChild(linha);

    const acoes = document.createElement("div");
    acoes.className = "cartao-acoes";

    const btnReceber = document.createElement("button");
    btnReceber.type = "button";
    btnReceber.textContent = "Marcar recebido";
    btnReceber.className = "botao-secundario botao-pequeno";
    btnReceber.addEventListener("click", () => alternarFormRecebimento(item, recebivel));

    const btnEditarMes = document.createElement("button");
    btnEditarMes.type = "button";
    btnEditarMes.textContent = "Reprogramar mês";
    btnEditarMes.className = "botao-secundario botao-pequeno";
    btnEditarMes.addEventListener("click", () => alternarFormMesEsperado(item, recebivel));

    acoes.appendChild(btnReceber);
    acoes.appendChild(btnEditarMes);
    item.appendChild(acoes);

    return item;
  }

  function criarItemRecebido(recebivel) {
    const item = document.createElement("li");
    item.className = "lanc-item";

    const linha = document.createElement("div");
    linha.className = "lanc-item-linha";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.textContent = `${recebivel.devedor} · recebido em ${recebivel.dataRecebido}`;

    const valor = document.createElement("span");
    valor.className = "lanc-valor lanc-receita";
    valor.textContent = formatCentavos(recebivel.valorCentavos);

    linha.appendChild(desc);
    linha.appendChild(valor);
    item.appendChild(linha);

    const btnDesfazer = document.createElement("button");
    btnDesfazer.type = "button";
    btnDesfazer.textContent = "Desfazer";
    btnDesfazer.className = "botao-secundario botao-pequeno";
    btnDesfazer.addEventListener("click", async () => {
      btnDesfazer.disabled = true;
      btnDesfazer.textContent = "Desfazendo...";
      try {
        await desfazerRecebimento(recebivel);
        await carregar();
      } catch (err) {
        recebidosStatusEl.textContent = `Erro ao desfazer: ${err.message || err.code || "erro desconhecido"}`;
        btnDesfazer.disabled = false;
        btnDesfazer.textContent = "Desfazer";
      }
    });
    item.appendChild(btnDesfazer);

    return item;
  }

  function renderizarPendentes(pendentes) {
    listaEl.innerHTML = "";
    totaisEl.innerHTML = "";

    if (pendentes.length === 0) {
      statusEl.textContent = "Nenhum recebível pendente.";
      return;
    }
    statusEl.textContent = `${pendentes.length} recebível(is) pendente(s):`;

    const porDevedor = new Map();
    for (const recebivel of pendentes) {
      if (!porDevedor.has(recebivel.devedor)) porDevedor.set(recebivel.devedor, []);
      porDevedor.get(recebivel.devedor).push(recebivel);
    }

    for (const [devedor, itens] of porDevedor) {
      const totalDevedor = itens.reduce((soma, r) => soma + r.valorCentavos, 0);

      const totalEl = document.createElement("p");
      totalEl.className = "receber-devedor-total";
      totalEl.textContent = `${devedor}: ${formatCentavos(totalDevedor)} em aberto`;
      totaisEl.appendChild(totalEl);

      const header = document.createElement("h3");
      header.className = "receber-devedor-header";
      header.textContent = devedor;
      listaEl.appendChild(header);

      const ul = document.createElement("ul");
      ul.className = "recebivel-lista";
      itens
        .sort((a, b) => a.mesEsperado.localeCompare(b.mesEsperado))
        .forEach((recebivel) => ul.appendChild(criarItemPendente(recebivel)));
      listaEl.appendChild(ul);
    }
  }

  function renderizarRecebidos(recebidos) {
    recebidosListaEl.innerHTML = "";
    if (recebidos.length === 0) {
      recebidosStatusEl.textContent = "Nenhum recebimento confirmado ainda.";
      return;
    }
    recebidosStatusEl.textContent = `${recebidos.length} recebimento(s) confirmado(s):`;
    recebidos
      .sort((a, b) => (b.dataRecebido || "").localeCompare(a.dataRecebido || ""))
      .forEach((recebivel) => recebidosListaEl.appendChild(criarItemRecebido(recebivel)));
  }

  async function carregar() {
    statusEl.textContent = "Carregando recebíveis...";
    recebidosStatusEl.textContent = "Carregando...";
    try {
      const [pendentes, recebidos] = await Promise.all([
        lerRecebiveisPorStatus("pendente"),
        lerRecebiveisPorStatus("recebido")
      ]);
      renderizarPendentes(pendentes);
      renderizarRecebidos(recebidos);
    } catch (erro) {
      statusEl.textContent = `Erro ao carregar recebíveis: ${erro.message || erro.code || "erro desconhecido"}`;
    }
  }

  carregar();

  return {
    // Chamado pelo app.js quando a tela "A Receber" é reaberta pela navegação, ou
    // depois de um lançamento novo gerar recebíveis, para refletir o estado atual.
    recarregar: carregar
  };
}
