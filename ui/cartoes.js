// ui/cartoes.js
// Tela de Cartões: CRUD (cadastro, edição, desativação e exclusão) dos cartões de crédito.

import {
  lerCartoes,
  criarCartao,
  atualizarCartao,
  excluirCartao,
  existeLancamentoComCartao
} from "../db.js";

// Inicializa a tela de Cartões. `membros` é a lista já carregada pelo app.js
// (usada para popular o seletor de titular). `aoMudar(novaListaCartoes)` é chamado
// depois de qualquer criação/edição/desativação/exclusão, para o app.js repassar a
// lista atualizada para a tela de Lançamento.
export function initTelaCartoes({ membros, aoMudar }) {
  const form = document.getElementById("form-cartao");
  const nomeInput = document.getElementById("cartao-nome");
  const fechamentoInput = document.getElementById("cartao-fechamento");
  const vencimentoInput = document.getElementById("cartao-vencimento");
  const titularSelect = document.getElementById("cartao-titular");
  const erroEl = document.getElementById("cartao-form-erro");
  const sucessoEl = document.getElementById("cartao-form-sucesso");
  const btnSalvar = document.getElementById("btn-salvar-cartao");
  const btnCancelar = document.getElementById("btn-cancelar-edicao-cartao");

  const statusEl = document.getElementById("cartoes-status");
  const listaEl = document.getElementById("lista-cartoes");

  let cartoesCache = [];
  let editandoId = null;

  function popularSelectTitular() {
    titularSelect.innerHTML = "";
    for (const membro of membros) {
      if (membro.ativo === false) continue;
      const opt = document.createElement("option");
      opt.value = membro.nome;
      opt.textContent = membro.nome;
      titularSelect.appendChild(opt);
    }
  }

  function entrarModoEdicao(cartao) {
    editandoId = cartao.id;
    nomeInput.value = cartao.nome || "";
    fechamentoInput.value = cartao.diaFechamento ?? "";
    vencimentoInput.value = cartao.diaVencimento ?? "";
    titularSelect.value = cartao.titular || "";
    btnSalvar.textContent = "Salvar alterações";
    btnCancelar.hidden = false;
    erroEl.textContent = "";
    sucessoEl.textContent = "";
    nomeInput.focus();
  }

  function sairModoEdicao() {
    editandoId = null;
    form.reset();
    btnSalvar.textContent = "Salvar cartão";
    btnCancelar.hidden = true;
  }

  btnCancelar.addEventListener("click", sairModoEdicao);

  function criarItemCartao(cartao) {
    const item = document.createElement("li");
    item.className = "cartao-item";
    if (cartao.ativo === false) item.classList.add("cartao-inativo");

    const info = document.createElement("div");
    info.className = "cartao-info";

    const nome = document.createElement("strong");
    nome.textContent = cartao.nome;
    if (cartao.ativo === false) {
      const badge = document.createElement("span");
      badge.className = "badge-inativo";
      badge.textContent = "Inativo";
      nome.appendChild(document.createTextNode(" "));
      nome.appendChild(badge);
    }

    const detalhes = document.createElement("span");
    detalhes.className = "cartao-detalhes";
    detalhes.textContent = `Fecha dia ${cartao.diaFechamento} · Vence dia ${cartao.diaVencimento} · Titular: ${cartao.titular}`;

    info.appendChild(nome);
    info.appendChild(detalhes);

    const acoes = document.createElement("div");
    acoes.className = "cartao-acoes";

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.textContent = "Editar";
    btnEditar.className = "botao-secundario";
    btnEditar.addEventListener("click", () => entrarModoEdicao(cartao));

    const btnToggleAtivo = document.createElement("button");
    btnToggleAtivo.type = "button";
    btnToggleAtivo.textContent = cartao.ativo === false ? "Reativar" : "Desativar";
    btnToggleAtivo.className = "botao-secundario";
    btnToggleAtivo.addEventListener("click", () => alternarAtivo(cartao));

    const btnExcluir = document.createElement("button");
    btnExcluir.type = "button";
    btnExcluir.textContent = "Excluir";
    btnExcluir.className = "botao-perigo";
    btnExcluir.addEventListener("click", () => excluir(cartao));

    acoes.appendChild(btnEditar);
    acoes.appendChild(btnToggleAtivo);
    acoes.appendChild(btnExcluir);

    item.appendChild(info);
    item.appendChild(acoes);
    return item;
  }

  function renderizarLista() {
    listaEl.innerHTML = "";
    if (cartoesCache.length === 0) {
      statusEl.textContent = "Nenhum cartão cadastrado ainda.";
      return;
    }
    statusEl.textContent = `${cartoesCache.length} cartão(ões) cadastrado(s):`;
    for (const cartao of cartoesCache) {
      listaEl.appendChild(criarItemCartao(cartao));
    }
  }

  async function recarregar() {
    cartoesCache = await lerCartoes();
    renderizarLista();
    aoMudar(cartoesCache);
  }

  async function alternarAtivo(cartao) {
    erroEl.textContent = "";
    sucessoEl.textContent = "";
    try {
      await atualizarCartao(cartao.id, { ativo: cartao.ativo === false });
      await recarregar();
    } catch (erro) {
      statusEl.textContent = `Erro ao atualizar cartão: ${erro.message || erro.code || "erro desconhecido"}`;
    }
  }

  async function excluir(cartao) {
    erroEl.textContent = "";
    sucessoEl.textContent = "";
    try {
      const emUso = await existeLancamentoComCartao(cartao.id);
      if (emUso) {
        statusEl.textContent = `"${cartao.nome}" tem lançamentos vinculados e não pode ser excluído — desative-o em vez disso.`;
        return;
      }
      const confirmou = window.confirm(`Excluir o cartão "${cartao.nome}" definitivamente? Esta ação não pode ser desfeita.`);
      if (!confirmou) return;
      await excluirCartao(cartao.id);
      if (editandoId === cartao.id) sairModoEdicao();
      await recarregar();
    } catch (erro) {
      statusEl.textContent = `Erro ao excluir cartão: ${erro.message || erro.code || "erro desconhecido"}`;
    }
  }

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    erroEl.textContent = "";
    sucessoEl.textContent = "";

    const nome = nomeInput.value.trim();
    const diaFechamento = parseInt(fechamentoInput.value, 10);
    const diaVencimento = parseInt(vencimentoInput.value, 10);
    const titular = titularSelect.value;

    if (!nome) {
      erroEl.textContent = "Informe o nome do cartão.";
      return;
    }
    if (!Number.isInteger(diaFechamento) || diaFechamento < 1 || diaFechamento > 31) {
      erroEl.textContent = "Informe um dia de fechamento entre 1 e 31.";
      return;
    }
    if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
      erroEl.textContent = "Informe um dia de vencimento entre 1 e 31.";
      return;
    }
    if (!titular) {
      erroEl.textContent = "Selecione o titular.";
      return;
    }

    const botao = btnSalvar;
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Salvando...";
    try {
      if (editandoId) {
        await atualizarCartao(editandoId, { nome, diaFechamento, diaVencimento, titular });
        sucessoEl.textContent = "Cartão atualizado!";
      } else {
        await criarCartao({ nome, diaFechamento, diaVencimento, titular, ativo: true });
        sucessoEl.textContent = "Cartão cadastrado!";
      }
      sairModoEdicao(); // já restaura o texto correto do botão ("Salvar cartão")
      await recarregar();
    } catch (erro) {
      erroEl.textContent = `Erro ao salvar cartão: ${erro.message || erro.code || "erro desconhecido"}`;
      botao.textContent = textoOriginal;
    } finally {
      botao.disabled = false;
    }
  });

  popularSelectTitular();
  statusEl.textContent = "Carregando cartões...";
  recarregar();
}
