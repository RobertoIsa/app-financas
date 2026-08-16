// app.js
// Bootstrap: login, estado de autenticação e a tela de lançamento.

import {
  auth,
  login,
  logout,
  onAuthChange,
  lerCategorias,
  lerMembros,
  lerCartoes,
  lerLancamentosDoMes,
  criarLancamento
} from "./db.js";
import { parseValorParaCentavos, formatCentavos, dataHojeISO, mesDeData } from "./logic.js";

const telaLogin = document.getElementById("tela-login");
const telaApp = document.getElementById("tela-app");
const formLogin = document.getElementById("form-login");
const emailInput = document.getElementById("login-email");
const senhaInput = document.getElementById("login-senha");
const erroLogin = document.getElementById("login-erro");
const btnSair = document.getElementById("btn-sair");
const usuarioEmailEl = document.getElementById("usuario-email");

const formLancamento = document.getElementById("form-lancamento");
const valorInput = document.getElementById("lanc-valor");
const categoriaSelect = document.getElementById("lanc-categoria");
const descricaoInput = document.getElementById("lanc-descricao");
const meioSelect = document.getElementById("lanc-meio");
const grupoCartao = document.getElementById("grupo-cartao");
const cartaoSelect = document.getElementById("lanc-cartao");
const cartaoAviso = document.getElementById("cartao-aviso");
const grupoParcelas = document.getElementById("grupo-parcelas");
const parcelasInput = document.getElementById("lanc-parcelas");
const responsavelSelect = document.getElementById("lanc-responsavel");
const dataInput = document.getElementById("lanc-data");
const lancamentoErro = document.getElementById("lancamento-erro");
const lancamentoSucesso = document.getElementById("lancamento-sucesso");

const mesStatus = document.getElementById("mes-status");
const listaLancamentos = document.getElementById("lista-lancamentos");

const MENSAGENS_ERRO = {
  "auth/invalid-email": "E-mail inválido.",
  "auth/user-disabled": "Esta conta foi desativada.",
  "auth/user-not-found": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/missing-password": "Digite sua senha.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
  "auth/network-request-failed": "Falha de conexão. Verifique sua internet."
};

function mensagemErroAmigavel(codigo) {
  return MENSAGENS_ERRO[codigo] || "Não foi possível entrar. Tente novamente.";
}

formLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroLogin.textContent = "";

  const email = emailInput.value.trim();
  const senha = senhaInput.value;
  const botao = formLogin.querySelector("button[type=submit]");

  botao.disabled = true;
  botao.textContent = "Entrando...";
  try {
    await login(email, senha);
  } catch (erro) {
    erroLogin.textContent = mensagemErroAmigavel(erro.code);
  } finally {
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});

btnSair.addEventListener("click", () => {
  logout();
});

let categoriasCache = [];
let membrosCache = [];
let cartoesCache = [];

function tipoSelecionado() {
  return formLancamento.querySelector('input[name="tipo"]:checked').value;
}

function categoriasParaTipo(tipo) {
  return categoriasCache.filter(
    (c) => (c.tipo === tipo || c.tipo === "ambos") && !c.sistema && c.ativo !== false
  );
}

function popularSelectCategorias(tipo) {
  const categorias = categoriasParaTipo(tipo);
  categoriaSelect.innerHTML = "";
  if (categorias.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhuma categoria disponível";
    categoriaSelect.appendChild(opt);
    return;
  }
  for (const categoria of categorias) {
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
  const cartoes = cartoesAtivos();
  cartaoSelect.innerHTML = "";
  cartaoAviso.textContent = "";
  if (cartoes.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhum cartão cadastrado";
    cartaoSelect.appendChild(opt);
    cartaoSelect.disabled = true;
    cartaoAviso.textContent = "Cadastre um cartão na tela de Cartões antes de lançar no crédito.";
    return;
  }
  cartaoSelect.disabled = false;
  for (const cartao of cartoes) {
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
    criadoPor: auth.currentUser.uid,
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

async function inicializarTelaApp() {
  dataInput.value = dataHojeISO();
  lancamentoErro.textContent = "";
  lancamentoSucesso.textContent = "";
  try {
    const [categorias, membros, cartoes] = await Promise.all([
      lerCategorias(),
      lerMembros(),
      lerCartoes()
    ]);
    categoriasCache = categorias;
    membrosCache = membros;
    cartoesCache = cartoes;
    popularSelectCategorias(tipoSelecionado());
    popularSelectResponsavel();
    atualizarVisibilidadeCredito();
    await carregarLancamentosDoMes();
  } catch (erro) {
    lancamentoErro.textContent = `Erro ao carregar dados: ${erro.message || erro.code || "erro desconhecido"}`;
  }
}

onAuthChange((usuario) => {
  if (usuario) {
    telaLogin.hidden = true;
    telaApp.hidden = false;
    usuarioEmailEl.textContent = usuario.email;
    inicializarTelaApp();
  } else {
    telaLogin.hidden = false;
    telaApp.hidden = true;
    formLogin.reset();
  }
});
