// ui/lancamento.js
// Tela de lançamento rápido: formulário de novo lançamento + lista do mês.

import {
  lerLancamentosDoMes,
  criarLancamento,
  criarLancamentoComRecebiveis,
  atualizarLancamento,
  atualizarParcelaComCascata,
  salvarParcelasCompra,
  excluirLancamento
} from "../db.js";
import {
  parseValorParaCentavos,
  formatCentavos,
  dataHojeISO,
  mesDeData,
  gerarParcelas,
  gerarRecebiveis
} from "../logic.js";

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
  const campoParaTerceiro = document.getElementById("campo-para-terceiro");
  const checkboxParaTerceiro = document.getElementById("lanc-para-terceiro");
  const grupoTerceiro = document.getElementById("grupo-terceiro");
  const devedorInput = document.getElementById("lanc-devedor");
  const numRecebimentosInput = document.getElementById("lanc-num-recebimentos");
  const responsavelSelect = document.getElementById("lanc-responsavel");
  const dataInput = document.getElementById("lanc-data");
  const lancamentoErro = document.getElementById("lancamento-erro");
  const lancamentoSucesso = document.getElementById("lancamento-sucesso");

  const mesStatus = document.getElementById("mes-status");
  const listaLancamentos = document.getElementById("lista-lancamentos");

  let categoriasCache = categorias || [];
  let membrosCache = membros || [];
  let cartoesCache = cartoes || [];

  // Injetar categoria de sistema para Adiantamento se não existir
  if (!categoriasCache.some(c => c.chave === "adiantamento_fatura")) {
    categoriasCache.push({ 
      chave: "adiantamento_fatura", 
      nome: "Adiantamento de Fatura", 
      icone: "💳", 
      tipo: "despesa", 
      sistema: true 
    });
  }

  // INJEÇÃO DO TIPO ADIANTAMENTO NO HTML
  const radiosTipo = formLancamento.querySelectorAll('input[name="tipo"]');
  if (radiosTipo.length > 0) {
    const ultimoRadioLabel = radiosTipo[radiosTipo.length - 1].parentElement;
    const adiantamentoLabel = document.createElement("label");
    adiantamentoLabel.style.marginLeft = "15px";
    adiantamentoLabel.innerHTML = `<input type="radio" name="tipo" value="adiantamento"> Adiantamento`;
    ultimoRadioLabel.insertAdjacentElement('afterend', adiantamentoLabel);
  }

  function tipoSelecionado() {
    const selecionado = formLancamento.querySelector('input[name="tipo"]:checked');
    return selecionado ? selecionado.value : "despesa";
  }

  function categoriasParaTipo(tipo) {
    return categoriasCache.filter(
      (c) => (c.tipo === tipo || c.tipo === "ambos" || c.chave === "adiantamento_fatura") && c.ativo !== false
    );
  }

  function popularSelectCategorias(tipo) {
    const valorAnterior = categoriaSelect.value;
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
      if (categoria.sistema && categoria.chave !== "adiantamento_fatura") continue; 
      const opt = document.createElement("option");
      opt.value = categoria.chave;
      opt.textContent = `${categoria.nome}${categoria.icone ? " " + categoria.icone : ""}`;
      categoriaSelect.appendChild(opt);
    }
    if (valorAnterior && cats.some(c => c.chave === valorAnterior)) {
      categoriaSelect.value = valorAnterior;
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
    const valorAnterior = cartaoSelect.value;
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
    if (valorAnterior && ativos.some(c => c.id === valorAnterior)) {
      cartaoSelect.value = valorAnterior;
    }
  }

  function atualizarInterface() {
    const tipo = tipoSelecionado();
    const isCredito = meioSelect.value === "credito";
    const isAdiantamento = tipo === "adiantamento";

    if (isAdiantamento) {
      categoriaSelect.parentElement.hidden = true;
      grupoCartao.hidden = false;
      grupoParcelas.hidden = true;
      grupoTerceiro.hidden = true;
      campoParaTerceiro.hidden = true;
      popularSelectCartao();
    } else {
      categoriaSelect.parentElement.hidden = false;
      grupoCartao.hidden = !isCredito;
      grupoParcelas.hidden = !isCredito;
      campoParaTerceiro.hidden = tipo !== "despesa";
      grupoTerceiro.hidden = !(tipo === "despesa" && checkboxParaTerceiro.checked);
      popularSelectCategorias(tipo);
      if (isCredito) popularSelectCartao();
    }
  }

  for (const radio of formLancamento.querySelectorAll('input[name="tipo"]')) {
    radio.addEventListener("change", atualizarInterface);
  }

  meioSelect.addEventListener("change", atualizarInterface);

  checkboxParaTerceiro.addEventListener("change", () => {
    if (checkboxParaTerceiro.checked) {
      const totalParcelasAtual = meioSelect.value === "credito"
        ? Math.max(1, parseInt(parcelasInput.value, 10) || 1)
        : 1;
      numRecebimentosInput.value = totalParcelasAtual;
    }
    atualizarInterface();
  });

  btnIrCartoes.addEventListener("click", () => irParaCartoes());

  function criarItemLancamento(lancamento) {
    const item = document.createElement("li");
    item.className = "lanc-item";

    const linha = document.createElement("div");
    linha.className = "lanc-item-linha";

    const categoria = categoriasCache.find((c) => c.chave === lancamento.categoriaId);
    const icone = categoria?.icone ? ` ${categoria.icone}` : "";
    const nomeCategoria = categoria?.nome || lancamento.categoriaId;

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    let textoDesc = `${lancamento.descricao || nomeCategoria}${icone}`;
    if (lancamento.totalParcelas > 1) {
      textoDesc += ` (${lancamento.parcelaAtual}/${lancamento.totalParcelas})`;
    }
    desc.textContent = textoDesc;

    const valor = document.createElement("span");
    valor.className = `lanc-valor lanc-${lancamento.tipo}`;
    const sinal = lancamento.tipo === "receita" ? "+" : "−";
    valor.textContent = `${sinal} ${formatCentavos(lancamento.valorCentavos)}`;

    const acoesDiv = document.createElement("div");
    acoesDiv.style.display = "flex";
    acoesDiv.style.alignItems = "center";

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.textContent = "Editar";
    btnEditar.className = "botao-secundario botao-pequeno";
    btnEditar.addEventListener("click", () => alternarEdicaoInline(item, lancamento));

    const btnExcluir = document.createElement("button");
    btnExcluir.type = "button";
    btnExcluir.innerHTML = "🗑️";
    btnExcluir.className = "botao-secundario botao-pequeno";
    btnExcluir.style.marginLeft = "8px";
    btnExcluir.title = "Excluir lançamento";
    
    btnExcluir.addEventListener("click", async () => {
      const confirmacao = confirm(`Tem certeza que deseja excluir o lançamento "${lancamento.descricao}" no valor de R$ ${formatCentavos(lancamento.valorCentavos)}?\n\nEsta ação não pode ser desfeita.`);
      if (confirmacao) {
        try {
          btnExcluir.disabled = true;
          await excluirLancamento(lancamento);
          await carregarLancamentosDoMes();
        } catch (erro) {
          console.error("Erro ao excluir:", erro);
          alert("Erro ao excluir o lançamento.");
          btnExcluir.disabled = false;
        }
      }
    });

    acoesDiv.appendChild(btnEditar);
    acoesDiv.appendChild(btnExcluir);

    linha.appendChild(desc);
    linha.appendChild(valor);
    linha.appendChild(acoesDiv);
    item.appendChild(linha);

    if (lancamento.meioPagamento === "credito" && lancamento.faturaMes) {
      const faturaEl = document.createElement("span");
      faturaEl.className = "lanc-fatura";
      faturaEl.textContent = `Fatura ${lancamento.faturaMes}`;
      item.appendChild(faturaEl);
    }

    return item;
  }

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
      if (cat.sistema && cat.chave !== "adiantamento_fatura") continue;
      const opt = document.createElement("option");
      opt.value = cat.chave;
      opt.textContent = `${cat.nome}${cat.icone ? " " + cat.icone : ""}`;
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
      if (isNaN(valorCentavos) || valorCentavos === 0) {
        erroEdicao.textContent = "Informe um valor válido diferente de zero.";
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

    if (tipo === "adiantamento") {
      if (meioPagamento === "credito") {
        lancamentoErro.textContent = "O adiantamento não pode ser pago usando crédito. Mude o Meio de Pagamento (ex: Débito ou Pix).";
        return;
      }
      if (cartoesAtivos().length === 0) {
        lancamentoErro.textContent = "Cadastre um cartão para poder adiantar a fatura.";
        return;
      }
      cartaoId = cartaoSelect.value;
      if (!cartaoId) {
        lancamentoErro.textContent = "Selecione para qual cartão é o adiantamento.";
        return;
      }
      cartaoSelecionado = cartoesCache.find((c) => c.id === cartaoId);
    } else {
      if (!categoriaId) {
        lancamentoErro.textContent = "Selecione uma categoria.";
        return;
      }
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
    }

    const paraTerceiro = tipo === "despesa" && checkboxParaTerceiro.checked;
    let devedor = null;
    let numRecebimentos = 1;
    
    if (paraTerceiro) {
      devedor = devedorInput.value.trim();
      if (!devedor) {
        lancamentoErro.textContent = "Informe o devedor (quem vai te pagar de volta).";
        return;
      }
      numRecebimentos = parseInt(numRecebimentosInput.value, 10) || 1;
      if (numRecebimentos < 1) numRecebimentos = 1;
    }

    const agora = Date.now();
    const botao = formLancamento.querySelector("button[type=submit]");
    botao.disabled = true;
    botao.textContent = "Salvando...";

    try {
      if (tipo === "adiantamento") {
        const idCompra = `ID-${agora}`;
        const catAdiantamento = "adiantamento_fatura"; 
        const descFatura = descricao || "Adiantamento de Fatura";

        const lancamentoCaixa = {
          tipo: "despesa",
          data,
          mes: mesDeData(data),
          mesDesembolso: mesDeData(data),
          valorCentavos,
          descricao: descFatura,
          categoriaId: catAdiantamento,
          meioPagamento, 
          responsavel,
          paraTerceiro: false,
          devedor: null,
          idReembolso: null,
          criadoPor: uid,
          criadoEm: agora,
          atualizadoEm: agora,
          pago: true
        };

        const parcelas = gerarParcelas({
          idCompra,
          dataCompra: data,
          valorCentavos: -valorCentavos, 
          totalParcelas: 1,
          diaFechamentoCartao: cartaoSelecionado.diaFechamento,
          diaVencimentoCartao: cartaoSelecionado.diaVencimento,
          categoriaId: catAdiantamento,
          descricao: descFatura,
          meioPagamento: "credito",
          cartaoId: cartaoSelecionado.id,
          responsavel,
          tipo: "despesa", 
          criadoPor: uid,
          criadoEm: agora + 1 
        });

        await criarLancamento(lancamentoCaixa);
        await salvarParcelasCompra(parcelas, undefined, []);
        
      } else if (meioPagamento === "credito") {
        const idCompra = `ID-${agora}`;
        const parcelas = gerarParcelas({
          idCompra,
          dataCompra: data,
          valorCentavos,
          totalParcelas,
          diaFechamentoCartao: cartaoSelecionado.diaFechamento,
          diaVencimentoCartao: cartaoSelecionado.diaVencimento,
          categoriaId,
          descricao,
          meioPagamento,
          cartaoId,
          responsavel,
          tipo,
          criadoPor: uid,
          criadoEm: agora
        });

        let recebiveis = [];
        if (paraTerceiro) {
          const idReembolso = `REEMB-${agora}`;
          for (const parcela of parcelas) {
            parcela.paraTerceiro = true;
            parcela.devedor = devedor;
            parcela.idReembolso = idReembolso;
          }
          recebiveis = gerarRecebiveis({
            idReembolso,
            origemIdCompra: idCompra,
            devedor,
            numRecebimentos,
            valorTotalCentavos: valorCentavos * totalParcelas,
            mesDesembolsoBase: parcelas[0].mesDesembolso,
            criadoPor: uid,
            criadoEm: agora
          });
        }
        await salvarParcelasCompra(parcelas, undefined, recebiveis);
      } else {
        const lancamento = {
          tipo,
          data,
          mes: mesDeData(data),
          mesDesembolso: mesDeData(data), 
          valorCentavos,
          descricao,
          categoriaId,
          meioPagamento,
          responsavel,
          paraTerceiro: false,
          devedor: null,
          idReembolso: null,
          criadoPor: uid,
          criadoEm: agora,
          atualizadoEm: agora,
          pago: true
        };

        let recebiveis = [];
        if (paraTerceiro) {
          const idReembolso = `REEMB-${agora}`;
          lancamento.paraTerceiro = true;
          lancamento.devedor = devedor;
          lancamento.idReembolso = idReembolso;
          recebiveis = gerarRecebiveis({
            idReembolso,
            origemIdCompra: null, 
            devedor,
            numRecebimentos,
            valorTotalCentavos: valorCentavos,
            mesDesembolsoBase: lancamento.mesDesembolso,
            criadoPor: uid,
            criadoEm: agora
          });
          await criarLancamentoComRecebiveis(lancamento, recebiveis);
        } else {
          await criarLancamento(lancamento);
        }
      }
      lancamentoSucesso.textContent = "Lançamento salvo!";
      formLancamento.reset();
      dataInput.value = dataHojeISO();
      atualizarInterface();
      await carregarLancamentosDoMes();
    } catch (erro) {
      lancamentoErro.textContent = `Erro ao salvar: ${erro.message || erro.code || "erro desconhecido"}`;
    } finally {
      botao.disabled = false;
      botao.textContent = "Salvar lançamento";
    }
  });

  dataInput.value = dataHojeISO();
  popularSelectResponsavel();
  atualizarInterface();
  carregarLancamentosDoMes();

  return {
    recarregarCartoes(novaListaCartoes) {
      cartoesCache = novaListaCartoes || [];
      atualizarInterface();
    },
    recarregar: carregarLancamentosDoMes
  };
}