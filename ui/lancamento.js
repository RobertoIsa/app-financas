// ui/lancamento.js
// Tela de lançamento rápido: formulário de novo lançamento + lista do mês.

import {
  lerLancamentosDoMes,
  criarLancamento,
  atualizarLancamento,
  atualizarParcelaComCascata,
  salvarParcelasCompra
} from "../db.js";
import {
  parseValorParaCentavos,
  formatCentavos,
  dataHojeISO,
  mesDeData,
  gerarParcelas
} from "../logic.js";

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

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.textContent = "Editar";
    btnEditar.className = "botao-secundario botao-pequeno";
    btnEditar.addEventListener("click", () => alternarEdicaoInline(item, lancamento));

    linha.appendChild(desc);
    linha.appendChild(valor);
    linha.appendChild(btnEditar);
    item.appendChild(linha);

    if (lancamento.meioPagamento === "credito" && lancamento.faturaMes) {
      const faturaEl = document.createElement("span");
      faturaEl.className = "lanc-fatura";
      faturaEl.textContent = `Fatura ${lancamento.faturaMes}`;
      item.appendChild(faturaEl);
    }

    return item;
  }

  // Edição inline de valor/descrição/categoria (o que a cascata propaga — ver
  // CLAUDE.md "Cascata"). Para parcelas de uma compra parcelada, a mudança propaga
  // às parcelas futuras ainda não pagas; para os demais lançamentos, é uma edição simples.
  function alternarEdicaoInline(item, lancamento) {
    const existente = item.querySelector(".lanc-item-edicao");
    if (existente) {
      existente.remove();
      return;
    }

    const form = document.createElement("form");
    form.className = "lanc-item-edicao";

    const campoValor = document.createElement("input");
    campoValor.type = "text";
    campoValor.inputMode = "decimal";
    campoValor.value = (lancamento.valorCentavos / 100).toFixed(2).replace(".", ",");
    campoValor.setAttribute("aria-label", "Valor (R$)");

    const campoDescricao = document.createElement("input");
    campoDescricao.type = "text";
    campoDescricao.value = lancamento.descricao || "";
    campoDescricao.setAttribute("aria-label", "Descrição");

    const campoCategoria = document.createElement("select");
    campoCategoria.setAttribute("aria-label", "Categoria");
    for (const cat of categoriasParaTipo(lancamento.tipo)) {
      const opt = document.createElement("option");
      opt.value = cat.chave;
      opt.textContent = `${cat.icone ? cat.icone + " " : ""}${cat.nome}`;
      if (cat.chave === lancamento.categoriaId) opt.selected = true;
      campoCategoria.appendChild(opt);
    }

    const btnSalvar = document.createElement("button");
    btnSalvar.type = "submit";
    btnSalvar.textContent = "Salvar";
    btnSalvar.className = "botao-pequeno";

    const btnCancelar = document.createElement("button");
    btnCancelar.type = "button";
    btnCancelar.textContent = "Cancelar";
    btnCancelar.className = "botao-secundario botao-pequeno";
    btnCancelar.addEventListener("click", () => form.remove());

    const erroEdicao = document.createElement("p");
    erroEdicao.className = "erro";
    erroEdicao.setAttribute("role", "alert");

    form.appendChild(campoValor);
    form.appendChild(campoDescricao);
    form.appendChild(campoCategoria);
    form.appendChild(btnSalvar);
    form.appendChild(btnCancelar);
    form.appendChild(erroEdicao);
    item.appendChild(form);

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      erroEdicao.textContent = "";

      const valorCentavos = parseValorParaCentavos(campoValor.value);
      if (isNaN(valorCentavos) || valorCentavos <= 0) {
        erroEdicao.textContent = "Informe um valor válido maior que zero.";
        return;
      }
      const mudancas = {
        valorCentavos,
        descricao: campoDescricao.value.trim(),
        categoriaId: campoCategoria.value
      };

      btnSalvar.disabled = true;
      btnSalvar.textContent = "Salvando...";
      try {
        if (lancamento.idCompra && lancamento.totalParcelas > 1) {
          await atualizarParcelaComCascata(lancamento.idCompra, lancamento.parcelaAtual, mudancas);
        } else {
          await atualizarLancamento(lancamento.id, mudancas);
        }
        await carregarLancamentosDoMes();
      } catch (erro) {
        erroEdicao.textContent = `Erro ao salvar: ${erro.message || erro.code || "erro desconhecido"}`;
        btnSalvar.disabled = false;
        btnSalvar.textContent = "Salvar";
      }
    });
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
    let cartaoSelecionado = null;
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
      cartaoSelecionado = cartoesCache.find((c) => c.id === cartaoId);
      totalParcelas = parseInt(parcelasInput.value, 10) || 1;
      if (totalParcelas < 1) totalParcelas = 1;
    }

    const agora = Date.now();

    const botao = formLancamento.querySelector("button[type=submit]");
    botao.disabled = true;
    botao.textContent = "Salvando...";
    try {
      if (meioPagamento === "credito") {
        // Toda compra no crédito (mesmo à vista) ganha seu idCompra e passa pela
        // engine de ciclo de fatura — ver CLAUDE.md "Ciclo de fatura" e "Parcelamento".
        const parcelas = gerarParcelas({
          idCompra: `ID-${agora}`,
          dataCompra: data,
          valorCentavos,
          totalParcelas,
          diaFechamentoCartao: cartaoSelecionado.diaFechamento,
          categoriaId,
          descricao,
          meioPagamento,
          cartaoId,
          responsavel,
          tipo,
          criadoPor: uid,
          criadoEm: agora
        });
        await salvarParcelasCompra(parcelas);
      } else {
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
          pago: true
        };
        await criarLancamento(lancamento);
      }
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
