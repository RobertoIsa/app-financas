// app.js
// Bootstrap: login, estado de autenticação e navegação entre telas.

import { login, logout, onAuthChange, lerCategorias, lerMembros, lerCartoes, lerObservacoes, salvarObservacoes } from "./db.js";
import { initTelaLancamento } from "./ui/lancamento.js";
import { initTelaCartoes } from "./ui/cartoes.js";
import { initTelaMes } from "./ui/mes.js";
import { initTelaReceber } from "./ui/receber.js";
import { initTelaRecorrencias } from "./ui/recorrencias.js";
import { initTelaFaturas } from "./ui/faturas.js";
import { initTelaDashboard } from "./ui/dashboard.js";
import { initTelaCaixa } from "./ui/caixa.js";

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
  dashboard: document.getElementById("tela-dashboard"),
  mes: document.getElementById("tela-mes"),
  caixa: document.getElementById("tela-caixa"),
  receber: document.getElementById("tela-receber"),
  cartoes: document.getElementById("tela-cartoes"),
  faturas: document.getElementById("tela-faturas"),
  recorrencias: document.getElementById("tela-recorrencias"),
  observacoes: document.getElementById("tela-observacoes") // <- ADICIONADO AQUI
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

let receberHandle = null;
let mesHandle = null;
let recorrenciasHandle = null;
let faturasHandle = null; // <- NOVA LINHA
let dashboardHandle = null;
let caixaHandle = null;

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
  // Recarrega a aba ao reabri-la, pra refletir o que mudou em outras telas (recebíveis
  // criados no lançamento, cartões/recorrências criados nessas telas, materialização
  // de recorrências do mês corrente) — cada tela só carrega sozinha na inicialização.
  if (nome === "receber" && receberHandle) {
    receberHandle.recarregar();
  }
  if (nome === "mes" && mesHandle) {
    mesHandle.recarregar();
  }
  if (nome === "recorrencias" && recorrenciasHandle) {
    recorrenciasHandle.recarregar();
  }
  if (nome === "dashboard" && dashboardHandle) {
    dashboardHandle.recarregar();
  }
  if (nome === "caixa" && caixaHandle) {
    caixaHandle.recarregar();
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
      aoMudar: (novaListaCartoes) => {
        lancamentoHandle.recarregarCartoes(novaListaCartoes);
        if (recorrenciasHandle) recorrenciasHandle.recarregarCartoes(novaListaCartoes);
        if (faturasHandle) faturasHandle.recarregarCartoes(novaListaCartoes); // <- NOVA LINHA
      }
    });

    mesHandle = initTelaMes({ categorias, uid });
    receberHandle = initTelaReceber({ uid });
    recorrenciasHandle = initTelaRecorrencias({ categorias, membros, cartoes, uid });
    faturasHandle = initTelaFaturas({ cartoes, uid });
    dashboardHandle = initTelaDashboard({ categorias, membros, uid });
    caixaHandle = initTelaCaixa();
    // --- CONTROLE DA TELA DE OBSERVAÇÕES ---
    // Persiste em /observacoes/{uid} no Firebase (em vez de localStorage), pra ficar
    // sincronizado entre dispositivos como o resto do app.
    const textoObsEl = document.getElementById("texto-observacoes");
    const btnSalvarObs = document.getElementById("btn-salvar-observacoes");
    const obsStatusEl = document.getElementById("obs-status");

    try {
      textoObsEl.value = await lerObservacoes(uid);
    } catch (err) {
      obsStatusEl.textContent = `Não foi possível carregar as observações: ${err.code || err.message || "erro desconhecido"}`;
      obsStatusEl.style.color = "#ef4444";
      console.error("Erro ao ler observações:", err);
    }

    btnSalvarObs.addEventListener("click", async () => {
      btnSalvarObs.disabled = true;
      try {
        await salvarObservacoes(uid, textoObsEl.value);
        obsStatusEl.style.color = "";
        obsStatusEl.textContent = "Salvo com sucesso!";
        setTimeout(() => {
          obsStatusEl.textContent = "";
        }, 3000);
      } catch (err) {
        obsStatusEl.textContent = `Erro ao salvar: ${err.code || err.message || "desconhecido"}`;
        obsStatusEl.style.color = "#ef4444";
        console.error("Erro ao salvar observações:", err);
      } finally {
        btnSalvarObs.disabled = false;
      }
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('Service Worker registrado com sucesso:', registration.scope);
      })
      .catch((erro) => {
        console.error('Falha ao registrar o Service Worker:', erro);
      });
  });
}