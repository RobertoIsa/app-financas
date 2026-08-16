// ui/lancamento.js
// Tela de lançamento rápido: formulário de novo lançamento + lista do mês.

import { lerLancamentosDoMes, criarLancamento } from "../db.js";
import { parseValorParaCentavos, formatCentavos, dataHojeISO, mesDeData } from "../logic.js";

// Inicializa a tela de lançamento. `deps` traz os dados já carregados pelo app.js
// (categorias, membros, cartões) e o uid do usuário logado.
// Retorna um handle com `recarregarCartoes` para o app.js atualizar o seletor de
// cartão quando a tela de Cartões cria/edita/desativa algo.
export function initTelaLancamento({ categorias, membros, cartoes, uid, irParaCartoes }) {
  const formLancamento = document.getElementById("form-lancamento");
  const valorInput = document.getElementById("lanc-valor");
  const categoriaSelect = document.getElementById("lanc-categoria");
  const descricaoInput = document.getElementById("lanc-descricao");
  const meioSelect = document.getElementById("lanc-meio");
  const grupoCartao = document.getElementById("grupo-cartao");
  const cartaoSelect = document.getElementById("lanc-cartao");
  const cartaoAviso = document.getElementById("cartao-aviso");
  const btnIrCartoes = document.getElementById("btn-ir-cartoes");
  const grupoParcelas = document.getElementById("grupo-parcelas");
  const parcelasInput = document.getElementById("lanc-parcelas");
  const responsavelSelect = document.getElementById("lanc-responsavel");
  const dataInput = document.getElementById("lanc-data");
  const lancamentoErro = document.getElementById("lancamento-erro");
  const lancamentoSucesso = document.getElementById("lancamento-sucesso");

  const mesStatus = document.getElementById("mes-status");
  const listaLancamentos = document.getElementById("lista-lancamentos");

  let categoriasCache = categorias;
  let membrosCache = membros;
  let cartoesCache = cartoes;

  function tipoSelecionado() {
    return formLancamento.querySelector('input[name="tipo"]:checked').value;
  }

  function categoriasParaTipo(tipo) {
    return categoriasCache.filter(
      (c) => (c.tipo === tipo || c.tipo === "ambos") && !c.sistema && c.ativo !== false
    );
  }

  function popularSelectCategorias(tipo) {
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
      categoriaSelect.appendChild(opt);
    }
  }

  function popularSelectResponsavel() {
    responsavelSelect.innerHTML = "";
    for (const membro of membrosCache) {
      if (membro.ativo === false) continue;
      const opt = document.createElement("option");
      opt.value = membro.chave;
      opt.textContent = membro.nome;
      responsavelSelect.appendChild(opt);
    }
    const optCasal = document.createElement("option");
    optCasal.value = "casal";
    optCasal.textContent = "Casal";
    responsavelSelect.appendChild(optCasal);
  }

  function cartoesAtivos() {
    return cartoesCache.filter((c) => c.ativo !== false);
  }

  function popularSelectCartao() {
    const ativos = cartoesAtivos();
    cartaoSelect.innerHTML = "";
    if (ativos.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum cartão cadastrado";
      cartaoSelect.appendChild(opt);
      cartaoSelect.disabled = true;
      cartaoAviso.hidden = false;
      return;
    }
    cartaoSelect.disabled = false;
    cartaoAviso.hidden = true;
    for (const cartao of ativos) {
      const opt = document.createElement("option");
      opt.value = cartao.id;
      opt.textContent = cartao.nome;
      cartaoSelect.appendChild(opt);
    }
  }

  function atualizarVisibilidadeCredito() {
    const isCredito = meioSelect.value === "credito";
    grupoCartao.hidden = !isCredito;
    grupoParcelas.hidden = !isCredito;
    if (isCredito) popularSelectCartao();
  }

  for (const radio of formLancamento.querySelectorAll('input[name="tipo"]')) {
    radio.addEventListener("change", () => popularSelectCategorias(tipoSelecionado()));
  }

  meioSelect.addEventListener("change", atualizarVisibilidadeCredito);

  btnIrCartoes.addEventListener("click", () => irParaCartoes());

  function criarItemLancamento(lancamento) {
    const item = document.createElement("li");
    item.className = "lanc-item";

    const categoria = categoriasCache.find((c) => c.chave === lancamento.categoriaId);
    const icone = categoria?.icone ? `${categoria.icone} ` : "";
    const nomeCategoria = categoria?.nome || lancamento.categoriaId;

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.textContent = `${icone}${lancamento.descricao || nomeCategoria}`;

    const valor = document.createElement("span");
    valor.className = `lanc-valor lanc-${lancamento.tipo}`;
    const sinal = lancamento.tipo === "receita" ? "+" : "−";
    valor.textContent = `${sinal} ${formatCentavos(lancamento.valorCentavos)}`;

    item.appendChild(desc);
    item.appendChild(valor);
    return item;
  }

  async function carregarLancamentosDoMes() {
    mesStatus.textContent = "Carregando lançamentos do mês...";
    listaLancamentos.innerHTML = "";
    try {
      const mes = mesDeData(dataHojeISO());
      const lancamentos = await lerLancamentosDoMes(mes);
      if (lancamentos.length === 0) {
        mesStatus.textContent = "Nenhum lançamento neste mês ainda.";
        return;
      }
      lancamentos.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
      mesStatus.textContent = `${lancamentos.length} lançamento(s) em ${mes}:`;
      for (const lancamento of lancamentos) {
        listaLancamentos.appendChild(criarItemLancamento(lancamento));
      }
    } catch (erro) {
      mesStatus.textContent = `Erro ao carregar lançamentos: ${erro.message || erro.code || "erro desconhecido"}`;
    }
  }

  formLancamento.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    lancamentoErro.textContent = "";
    lancamentoSucesso.textContent = "";

    const tipo = tipoSelecionado();
    const valorCentavos = parseValorParaCentavos(valorInput.value);
    const categoriaId = categoriaSelect.value;
    const descricao = descricaoInput.value.trim();
    const meioPagamento = meioSelect.value;
    const responsavel = responsavelSelect.value;
    const data = dataInput.value;

    if (isNaN(valorCentavos) || valorCentavos <= 0) {
      lancamentoErro.textContent = "Informe um valor válido maior que zero.";
      return;
    }
    if (!categoriaId) {
      lancamentoErro.textContent = "Selecione uma categoria.";
      return;
    }
    if (!responsavel) {
      lancamentoErro.textContent = "Selecione o responsável.";
      return;
    }
    if (!data) {
      lancamentoErro.textContent = "Informe a data.";
      return;
    }

    let cartaoId = null;
    let totalParcelas = 1;
    if (meioPagamento === "credito") {
      if (cartoesAtivos().length === 0) {
        lancamentoErro.textContent = "Cadastre um cartão antes de lançar no crédito.";
        return;
      }
      cartaoId = cartaoSelect.value;
      if (!cartaoId) {
        lancamentoErro.textContent = "Selecione o cartão.";
        return;
      }
      totalParcelas = parseInt(parcelasInput.value, 10) || 1;
      if (totalParcelas < 1) totalParcelas = 1;
    }

    const agora = Date.now();
    const lancamento = {
      tipo,
      data,
      mes: mesDeData(data),
      valorCentavos,
      descricao,
      categoriaId,
      meioPagamento,
      responsavel,
      criadoPor: uid,
      criadoEm: agora,
      atualizadoEm: agora,
      pago: meioPagamento !== "credito"
    };

    if (meioPagamento === "credito") {
      lancamento.cartaoId = cartaoId;
      lancamento.parcelaAtual = 1;
      lancamento.totalParcelas = totalParcelas;
      lancamento.dataBaixa = null;
      if (totalParcelas > 1) {
        lancamento.idCompra = `ID-${agora}`;
      }
    }

    const botao = formLancamento.querySelector("button[type=submit]");
    botao.disabled = true;
    botao.textContent = "Salvando...";
    try {
      await criarLancamento(lancamento);
      lancamentoSucesso.textContent = "Lançamento salvo!";
      formLancamento.reset();
      dataInput.value = dataHojeISO();
      popularSelectCategorias(tipoSelecionado());
      atualizarVisibilidadeCredito();
      await carregarLancamentosDoMes();
    } catch (erro) {
      lancamentoErro.textContent = `Erro ao salvar: ${erro.message || erro.code || "erro desconhecido"}`;
    } finally {
      botao.disabled = false;
      botao.textContent = "Salvar lançamento";
    }
  });

  dataInput.value = dataHojeISO();
  popularSelectCategorias(tipoSelecionado());
  popularSelectResponsavel();
  atualizarVisibilidadeCredito();
  carregarLancamentosDoMes();

  return {
    // Chamado pelo app.js sempre que a tela de Cartões cria/edita/desativa/exclui
    // um cartão, para o seletor de crédito refletir a lista atual sem precisar recarregar.
    recarregarCartoes(novaListaCartoes) {
      cartoesCache = novaListaCartoes;
      if (meioSelect.value === "credito") popularSelectCartao();
    }
  };
}
