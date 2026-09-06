// ui/recorrencias.js
// Tela "Recorrências": CRUD de regras em /recorrencias (contas e receitas mensais —
// salário, aluguel, assinaturas). Método regra + projeção virtual — ver CLAUDE.md
// "Recorrência (contas e receitas mensais)". Esta tela só cuida da REGRA; a projeção
// virtual e a materialização acontecem na tela Mês (ui/mes.js), que consome
// lerRecorrencias() a cada carregamento.

import { lerRecorrencias, criarRecorrencia, atualizarRecorrencia } from "../db.js";
import { parseValorParaCentavos, formatCentavos, resolverResponsavelPorUid } from "../logic.js";

function formatarMesLabel(mesISO) {
  if (!mesISO) return "";
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

// Inicializa a tela de Recorrências. `categorias`, `membros` e `cartoes` vêm já
// carregados pelo app.js. `cartoes` é lido por valor no momento da inicialização — como
// a tela de Cartões já mantém sua própria lista atualizada e recorrências no crédito
// são um caso secundário, não há necessidade de um canal de atualização ao vivo aqui
// (reabrir a aba já chama `recarregar`, que não depende de cartões mudarem no meio).
export function initTelaRecorrencias({ categorias, membros, cartoes, uid }) {
  const form = document.getElementById("form-recorrencia");
  const valorInput = document.getElementById("rec-valor");
  const categoriaSelect = document.getElementById("rec-categoria");
  const descricaoInput = document.getElementById("rec-descricao");
  const meioSelect = document.getElementById("rec-meio");
  const grupoCartao = document.getElementById("grupo-rec-cartao");
  const cartaoSelect = document.getElementById("rec-cartao");
  const diaInput = document.getElementById("rec-dia");
  const inicioInput = document.getElementById("rec-inicio");
  const fimInput = document.getElementById("rec-fim");
  const erroEl = document.getElementById("recorrencia-form-erro");
  const sucessoEl = document.getElementById("recorrencia-form-sucesso");
  const btnSalvar = document.getElementById("btn-salvar-recorrencia");
  const btnCancelar = document.getElementById("btn-cancelar-edicao-recorrencia");

  const statusEl = document.getElementById("recorrencias-status");
  const listaEl = document.getElementById("lista-recorrencias");

  const categoriasCache = categorias;
  const membrosCache = membros;
  let cartoesCache = cartoes;
  let recorrenciasCache = [];
  let editandoId = null;

  function tipoSelecionado() {
    return form.querySelector('input[name="rec-tipo"]:checked').value;
  }

  function categoriasParaTipo(tipo) {
    return categoriasCache.filter(
      (c) => (c.tipo === tipo || c.tipo === "ambos") && !c.sistema && c.ativo !== false
    );
  }

  function popularSelectCategorias(tipo, categoriaSelecionada) {
    const cats = categoriasParaTipo(tipo);
    categoriaSelect.innerHTML = "";
    if (cats.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhuma categoria disponível";
      categoriaSelect.appendChild(opt);
      return;
    }
    for (const categoria of cats) {
      const opt = document.createElement("option");
      opt.value = categoria.chave;
      opt.textContent = `${categoria.icone ? categoria.icone + " " : ""}${categoria.nome}`;
      if (categoria.chave === categoriaSelecionada) opt.selected = true;
      categoriaSelect.appendChild(opt);
    }
  }

  // responsavel não é mais escolhido manualmente (ver CLAUDE.md "Atribuição por pessoa
  // (revisado)" — "casal" foi removido): é sempre a pessoa logada, deduzida do uid via
  // /membros — igual pra criar quanto pra editar uma regra (editar também é "salvar").
  // Fallback sensato se o uid não bater com nenhum /membros (não deveria acontecer dado
  // a allowlist, mas não trava o salvamento).
  function obterResponsavelAtual() {
    const responsavel = resolverResponsavelPorUid(membrosCache, uid);
    if (!membrosCache.some((m) => m.uid === uid)) {
      console.warn(`Não foi possível determinar o responsável pelo uid ${uid} (nenhum /membros correspondente) — usando o uid como responsavel de fallback.`);
    }
    return responsavel;
  }

  function cartoesAtivos() {
    return cartoesCache.filter((c) => c.ativo !== false);
  }

  function popularSelectCartao(cartaoSelecionado) {
    const ativos = cartoesAtivos();
    cartaoSelect.innerHTML = "";
    if (ativos.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum cartão cadastrado";
      cartaoSelect.appendChild(opt);
      cartaoSelect.disabled = true;
      return;
    }
    cartaoSelect.disabled = false;
    for (const cartao of ativos) {
      const opt = document.createElement("option");
      opt.value = cartao.id;
      opt.textContent = cartao.nome;
      if (cartao.id === cartaoSelecionado) opt.selected = true;
      cartaoSelect.appendChild(opt);
    }
  }

  function atualizarVisibilidadeCredito() {
    const isCredito = meioSelect.value === "credito";
    grupoCartao.hidden = !isCredito;
    if (isCredito) popularSelectCartao();
  }

  for (const radio of form.querySelectorAll('input[name="rec-tipo"]')) {
    radio.addEventListener("change", () => popularSelectCategorias(tipoSelecionado()));
  }
  meioSelect.addEventListener("change", atualizarVisibilidadeCredito);

  function entrarModoEdicao(regra) {
    editandoId = regra.id;
    form.querySelector(`input[name="rec-tipo"][value="${regra.tipo}"]`).checked = true;
    valorInput.value = (regra.valorCentavos / 100).toFixed(2).replace(".", ",");
    popularSelectCategorias(regra.tipo, regra.categoriaId);
    descricaoInput.value = regra.descricao || "";
    meioSelect.value = regra.meioPagamento;
    atualizarVisibilidadeCredito();
    if (regra.meioPagamento === "credito") popularSelectCartao(regra.cartaoId);
    diaInput.value = regra.diaDoMes;
    inicioInput.value = regra.inicio || "";
    fimInput.value = regra.fim || "";
    btnSalvar.textContent = "Salvar alterações";
    btnCancelar.hidden = false;
    erroEl.textContent = "";
    sucessoEl.textContent = "";
    descricaoInput.focus();
  }

  function sairModoEdicao() {
    editandoId = null;
    form.reset();
    popularSelectCategorias(tipoSelecionado());
    atualizarVisibilidadeCredito();
    btnSalvar.textContent = "Salvar recorrência";
    btnCancelar.hidden = true;
  }

  btnCancelar.addEventListener("click", sairModoEdicao);

  function descricaoMeio(meio) {
    return { dinheiro: "Dinheiro", debito: "Débito", pix: "Pix", transferencia: "Transferência", credito: "Crédito" }[meio] || meio;
  }

  function criarItemRegra(regra) {
    const item = document.createElement("li");
    item.className = "cartao-item";
    if (regra.ativo === false) item.classList.add("cartao-inativo");

    const info = document.createElement("div");
    info.className = "cartao-info";

    const nome = document.createElement("strong");
    const categoria = categoriasCache.find((c) => c.chave === regra.categoriaId);
    const icone = categoria?.icone ? `${categoria.icone} ` : "";
    nome.textContent = `${icone}${regra.descricao}`;
    if (regra.ativo === false) {
      const badge = document.createElement("span");
      badge.className = "badge-inativo";
      badge.textContent = "Encerrada";
      nome.appendChild(document.createTextNode(" "));
      nome.appendChild(badge);
    }

    const detalhes = document.createElement("span");
    detalhes.className = "cartao-detalhes";
    const sinal = regra.tipo === "receita" ? "+" : "−";
    const periodo = regra.fim
      ? `${formatarMesLabel(regra.inicio)} a ${formatarMesLabel(regra.fim)}`
      : `desde ${formatarMesLabel(regra.inicio)}, sem fim`;
    detalhes.textContent = `${sinal} ${formatCentavos(regra.valorCentavos)} · dia ${regra.diaDoMes} · ${descricaoMeio(regra.meioPagamento)} · ${periodo}`;

    info.appendChild(nome);
    info.appendChild(detalhes);

    const acoes = document.createElement("div");
    acoes.className = "cartao-acoes";

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.textContent = "Editar";
    btnEditar.className = "botao-secundario";
    btnEditar.addEventListener("click", () => entrarModoEdicao(regra));

    const btnEncerrar = document.createElement("button");
    btnEncerrar.type = "button";
    btnEncerrar.textContent = regra.ativo === false ? "Reativar" : "Encerrar";
    btnEncerrar.className = "botao-secundario";
    btnEncerrar.addEventListener("click", () => alternarAtivo(regra));

    acoes.appendChild(btnEditar);
    acoes.appendChild(btnEncerrar);

    item.appendChild(info);
    item.appendChild(acoes);
    return item;
  }

  function renderizarLista() {
    listaEl.innerHTML = "";
    if (recorrenciasCache.length === 0) {
      statusEl.textContent = "Nenhuma recorrência cadastrada ainda.";
      return;
    }
    statusEl.textContent = `${recorrenciasCache.length} recorrência(s) cadastrada(s):`;
    const ordenadas = [...recorrenciasCache].sort((a, b) => {
      if ((a.ativo === false) !== (b.ativo === false)) return a.ativo === false ? 1 : -1;
      return (a.descricao || "").localeCompare(b.descricao || "");
    });
    for (const regra of ordenadas) {
      listaEl.appendChild(criarItemRegra(regra));
    }
  }

  async function recarregar() {
    statusEl.textContent = "Carregando recorrências...";
    recorrenciasCache = await lerRecorrencias();
    renderizarLista();
  }

  async function alternarAtivo(regra) {
    erroEl.textContent = "";
    sucessoEl.textContent = "";
    try {
      // "Encerrar" só afeta o futuro (ver CLAUDE.md): ocorrências já materializadas em
      // /lancamentos não são tocadas, só a regra deixa de projetar/materializar novas.
      await atualizarRecorrencia(regra.id, { ativo: regra.ativo === false });
      await recarregar();
    } catch (erro) {
      statusEl.textContent = `Erro ao atualizar recorrência: ${erro.message || erro.code || "erro desconhecido"}`;
    }
  }

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    erroEl.textContent = "";
    sucessoEl.textContent = "";

    const tipo = tipoSelecionado();
    const valorCentavos = parseValorParaCentavos(valorInput.value);
    const categoriaId = categoriaSelect.value;
    const descricao = descricaoInput.value.trim();
    const meioPagamento = meioSelect.value;
    const responsavel = obterResponsavelAtual();
    const diaDoMes = parseInt(diaInput.value, 10);
    const inicio = inicioInput.value;
    const fim = fimInput.value || null;

    if (!descricao) {
      erroEl.textContent = "Informe a descrição.";
      return;
    }
    if (isNaN(valorCentavos) || valorCentavos <= 0) {
      erroEl.textContent = "Informe um valor válido maior que zero.";
      return;
    }
    if (!categoriaId) {
      erroEl.textContent = "Selecione uma categoria.";
      return;
    }
    if (!Number.isInteger(diaDoMes) || diaDoMes < 1 || diaDoMes > 31) {
      erroEl.textContent = "Informe um dia do mês entre 1 e 31.";
      return;
    }
    if (!inicio) {
      erroEl.textContent = "Informe o mês de início.";
      return;
    }
    if (fim && fim < inicio) {
      erroEl.textContent = "O mês de fim não pode ser antes do mês de início.";
      return;
    }
    let cartaoId = null;
    if (meioPagamento === "credito") {
      if (cartoesAtivos().length === 0) {
        erroEl.textContent = "Cadastre um cartão antes de criar uma recorrência no crédito.";
        return;
      }
      cartaoId = cartaoSelect.value;
      if (!cartaoId) {
        erroEl.textContent = "Selecione o cartão.";
        return;
      }
    }

    const dados = {
      descricao,
      tipo,
      valorCentavos,
      categoriaId,
      meioPagamento,
      cartaoId,
      responsavel,
      diaDoMes,
      inicio,
      fim
    };

    const textoOriginal = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = "Salvando...";
    try {
      if (editandoId) {
        // Não mexe em `ativo` aqui — editar (ex.: corrigir descrição) não deve reativar
        // sozinho uma regra encerrada; isso é ação separada (botão Encerrar/Reativar).
        await atualizarRecorrencia(editandoId, dados);
        sucessoEl.textContent = "Recorrência atualizada!";
      } else {
        await criarRecorrencia({
          ...dados,
          ativo: true,
          criadoPor: uid,
          criadoEm: Date.now(),
          atualizadoEm: Date.now()
        });
        sucessoEl.textContent = "Recorrência cadastrada!";
      }
      sairModoEdicao();
      await recarregar();
    } catch (erro) {
      erroEl.textContent = `Erro ao salvar recorrência: ${erro.message || erro.code || "erro desconhecido"}`;
      btnSalvar.textContent = textoOriginal;
    } finally {
      btnSalvar.disabled = false;
    }
  });

  popularSelectCategorias(tipoSelecionado());
  atualizarVisibilidadeCredito();
  recarregar();

  return {
    // Chamado pelo app.js quando a aba é reaberta, pra refletir regras criadas/editadas
    // fora (não há outra tela que edite recorrências, mas segue o mesmo padrão de
    // cartões/receber).
    recarregar,
    // Chamado pelo app.js sempre que a tela de Cartões cria/edita/desativa/exclui um
    // cartão, igual ao mesmo canal usado pela tela de Lançamento.
    recarregarCartoes(novaListaCartoes) {
      cartoesCache = novaListaCartoes;
      if (meioSelect.value === "credito") popularSelectCartao();
    }
  };
}
