// app.js
// Bootstrap: login, estado de autenticação e navegação entre telas.

import { login, logout, onAuthChange, lerCategorias, lerMembros, lerCartoes } from "./db.js";
import { initTelaLancamento } from "./ui/lancamento.js";
import { initTelaCartoes } from "./ui/cartoes.js";

const telaLogin = document.getElementById("tela-login");
const telaApp = document.getElementById("tela-app");
const formLogin = document.getElementById("form-login");
const emailInput = document.getElementById("login-email");
const senhaInput = document.getElementById("login-senha");
const erroLogin = document.getElementById("login-erro");
const btnSair = document.getElementById("btn-sair");
const usuarioEmailEl = document.getElementById("usuario-email");
const appErro = document.getElementById("app-erro");

const botoesNav = document.querySelectorAll(".nav-botao");
const telasPorNome = {
  lancamento: document.getElementById("tela-lancamento"),
  cartoes: document.getElementById("tela-cartoes")
};

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

function ativarTela(nome) {
  for (const [chave, elemento] of Object.entries(telasPorNome)) {
    elemento.hidden = chave !== nome;
  }
  for (const botao of botoesNav) {
    if (botao.dataset.tela === nome) {
      botao.setAttribute("aria-current", "page");
    } else {
      botao.removeAttribute("aria-current");
    }
  }
}

for (const botao of botoesNav) {
  botao.addEventListener("click", () => ativarTela(botao.dataset.tela));
}

async function inicializarTelaApp(uid) {
  ativarTela("lancamento");
  appErro.textContent = "";
  try {
    const [categorias, membros, cartoes] = await Promise.all([
      lerCategorias(),
      lerMembros(),
      lerCartoes()
    ]);

    const lancamentoHandle = initTelaLancamento({
      categorias,
      membros,
      cartoes,
      uid,
      irParaCartoes: () => ativarTela("cartoes")
    });

    initTelaCartoes({
      membros,
      aoMudar: (novaListaCartoes) => lancamentoHandle.recarregarCartoes(novaListaCartoes)
    });
  } catch (erro) {
    appErro.textContent = `Erro ao carregar dados: ${erro.message || erro.code || "erro desconhecido"}`;
  }
}

onAuthChange((usuario) => {
  if (usuario) {
    telaLogin.hidden = true;
    telaApp.hidden = false;
    usuarioEmailEl.textContent = usuario.email;
    inicializarTelaApp(usuario.uid);
  } else {
    telaLogin.hidden = false;
    telaApp.hidden = true;
    formLogin.reset();
  }
});
