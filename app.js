// app.js
// Bootstrap: login, estado de autenticação e o teste de fumaça de leitura do banco.

import { login, logout, onAuthChange, lerCategorias } from "./db.js";

const telaLogin = document.getElementById("tela-login");
const telaApp = document.getElementById("tela-app");
const formLogin = document.getElementById("form-login");
const emailInput = document.getElementById("login-email");
const senhaInput = document.getElementById("login-senha");
const erroLogin = document.getElementById("login-erro");
const btnSair = document.getElementById("btn-sair");
const usuarioEmailEl = document.getElementById("usuario-email");
const listaCategorias = document.getElementById("lista-categorias");
const categoriasStatus = document.getElementById("categorias-status");

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

async function carregarCategorias() {
  categoriasStatus.textContent = "Carregando categorias...";
  listaCategorias.innerHTML = "";
  try {
    const categorias = await lerCategorias();
    if (categorias.length === 0) {
      categoriasStatus.textContent = "Nenhuma categoria encontrada em /categorias.";
      return;
    }
    categoriasStatus.textContent = `${categorias.length} categoria(s) encontrada(s):`;
    for (const categoria of categorias) {
      const item = document.createElement("li");
      const icone = categoria.icone ? `${categoria.icone} ` : "";
      item.textContent = `${icone}${categoria.nome || categoria.chave}`;
      listaCategorias.appendChild(item);
    }
  } catch (erro) {
    categoriasStatus.textContent = `Erro ao ler /categorias: ${erro.message || erro.code || "erro desconhecido"}`;
  }
}

onAuthChange((usuario) => {
  if (usuario) {
    telaLogin.hidden = true;
    telaApp.hidden = false;
    usuarioEmailEl.textContent = usuario.email;
    carregarCategorias();
  } else {
    telaLogin.hidden = false;
    telaApp.hidden = true;
    formLogin.reset();
  }
});
