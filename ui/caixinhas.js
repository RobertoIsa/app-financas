// ui/caixinhas.js
// Aba "Caixinhas": orçamento mensal do dia a dia, uma caixinha fixa por pessoa
// (Roberto / Esposa) — ver CLAUDE.md "Caixinhas (orçamento mensal por pessoa)".
//
// NÃO é um contador persistido: o gasto e o saldo são SEMPRE calculados na hora a partir
// de /lancamentos (mesma abordagem da tela "Mês"), evitando o sincronismo frágil que o
// Caixa exigiu. Só o LIMITE fica gravado em /caixinhas/{pessoa}/{mes}.
//
// Regra do que consome a caixinha de uma pessoa, no MÊS ATUAL (eixo competência/`mes`):
//   tipo = "despesa"  &&  responsavel = a pessoa  &&  idRecorrencia ausente/null
// (recorrências têm limite próprio, fora da caixinha). Também ignoramos o lançamento
// de sistema "pagamento_cartao" (a baixa da fatura) — não é um gasto solto do dia a
// dia, e as compras de crédito já entram uma a uma pela competência; o mesmo filtro é
// usado no Dashboard.
//
// 1ª versão: sempre o mês corrente, sem navegação entre meses (fica pra depois).

import { lerLancamentosDoMes, lerCaixinhaLimite, salvarCaixinhaLimite } from "../db.js";
import { formatCentavos, parseValorParaCentavos, dataHojeISO, mesDeData } from "../logic.js";

// Chaves estáveis de /membros (ver CLAUDE.md "Atribuição por pessoa"). O nome exibido
// vem de /membros quando disponível; senão cai neste rótulo.
const PESSOAS = [
  { chave: "roberto", nome: "Roberto" },
  { chave: "esposa", nome: "Esposa" }
];

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatarMes(mesISO) {
  if (!mesISO) return "";
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES[mes - 1]} ${ano}`;
}

function formatarDataBR(dataISO) {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return dataISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

export function initTelaCaixinhas({ categorias, membros, uid }) {
  const grid = document.getElementById("caixinhas-grid");
  const statusEl = document.getElementById("caixinhas-status");
  const tituloEl = document.getElementById("caixinhas-titulo");

  const categoriasCache = categorias || [];
  const mesAtual = mesDeData(dataHojeISO());

  // Sem o container não há o que montar — devolve um handle inerte pra não quebrar app.js.
  if (!grid) {
    console.warn("ui/caixinhas.js: #caixinhas-grid não encontrado — aba não inicializada.");
    return { recarregar: () => {} };
  }

  const pessoas = PESSOAS.map((p) => {
    const membro = (membros || []).find((m) => m.chave === p.chave);
    return { chave: p.chave, nome: membro && membro.nome ? membro.nome : p.nome };
  });

  function obterNomeIconeCategoria(categoriaId) {
    const cat = categoriasCache.find((c) => c.chave === categoriaId);
    if (!cat) return categoriaId || "Sem categoria";
    return `${cat.icone ? cat.icone + " " : ""}${cat.nome}`;
  }

  function criarLinhaNumero(rotuloTexto) {
    const linha = document.createElement("div");
    linha.className = "caixinha-linha";
    const rotulo = document.createElement("span");
    rotulo.className = "caixinha-rotulo";
    rotulo.textContent = rotuloTexto;
    const valor = document.createElement("span");
    valor.className = "caixinha-valor";
    valor.textContent = "—";
    linha.append(rotulo, valor);
    return { linha, valor };
  }

  function construirPainel(pessoa) {
    const painel = document.createElement("section");
    painel.className = "caixinha-painel";
    painel.setAttribute("aria-label", `Caixinha de ${pessoa.nome}`);

    const titulo = document.createElement("h3");
    titulo.className = "caixinha-nome";
    titulo.textContent = pessoa.nome;

    const numeros = document.createElement("div");
    numeros.className = "caixinha-numeros";
    const limite = criarLinhaNumero("Limite do mês");
    const gasto = criarLinhaNumero("Gasto no mês");
    const saldo = criarLinhaNumero("Saldo restante");
    saldo.linha.classList.add("caixinha-linha-saldo");
    numeros.append(limite.linha, gasto.linha, saldo.linha);

    const aviso = document.createElement("p");
    aviso.className = "caixinha-aviso";
    aviso.hidden = true;

    const form = document.createElement("form");
    form.className = "caixinha-form-limite";
    form.noValidate = true;

    const inputId = `caixinha-input-${pessoa.chave}`;
    const label = document.createElement("label");
    label.setAttribute("for", inputId);
    label.textContent = "Definir limite (R$)";

    const formLinha = document.createElement("div");
    formLinha.className = "caixinha-form-linha";
    const input = document.createElement("input");
    input.type = "text";
    input.id = inputId;
    input.inputMode = "decimal";
    input.placeholder = "0,00";
    input.autocomplete = "off";
    const botao = document.createElement("button");
    botao.type = "submit";
    botao.textContent = "Salvar";
    formLinha.append(input, botao);

    const erro = document.createElement("p");
    erro.className = "erro";
    erro.setAttribute("role", "alert");
    erro.setAttribute("aria-live", "assertive");

    form.append(label, formLinha, erro);

    const listaTitulo = document.createElement("h4");
    listaTitulo.className = "caixinha-lista-titulo";
    listaTitulo.textContent = "Lançamentos que consumiram";
    const lista = document.createElement("ul");
    lista.className = "caixinha-lista";

    painel.append(titulo, numeros, aviso, form, listaTitulo, lista);
    grid.appendChild(painel);

    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      salvarLimite(pessoa, { input, erro, botao });
    });

    return {
      painel,
      limiteValor: limite.valor,
      gastoValor: gasto.valor,
      saldoValor: saldo.valor,
      aviso,
      input,
      erro,
      lista
    };
  }

  const refs = {};
  pessoas.forEach((pessoa) => {
    refs[pessoa.chave] = construirPainel(pessoa);
  });

  async function salvarLimite(pessoa, ui) {
    ui.erro.textContent = "";
    const centavos = parseValorParaCentavos(ui.input.value);
    if (Number.isNaN(centavos)) {
      ui.erro.textContent = "Informe um valor válido (ex.: 500,00).";
      return;
    }

    const textoOriginal = ui.botao.textContent;
    ui.botao.disabled = true;
    ui.botao.textContent = "Salvando...";
    try {
      await salvarCaixinhaLimite(pessoa.chave, mesAtual, centavos, uid);
      await carregar();
    } catch (erro) {
      console.error("Erro ao salvar limite da caixinha:", erro);
      ui.erro.textContent = `Erro ao salvar: ${erro.message || erro.code || "desconhecido"}`;
    } finally {
      ui.botao.disabled = false;
      ui.botao.textContent = textoOriginal;
    }
  }

  function renderLista(listaEl, itens) {
    if (!listaEl) return;
    listaEl.innerHTML = "";
    if (itens.length === 0) {
      const li = document.createElement("li");
      li.className = "lanc-item caixinha-vazia";
      li.textContent = "Nenhum gasto avulso neste mês.";
      listaEl.appendChild(li);
      return;
    }
    itens.forEach((lancamento) => {
      const li = document.createElement("li");
      li.className = "lanc-item";

      const linha = document.createElement("div");
      linha.className = "lanc-item-linha";
      const desc = document.createElement("span");
      desc.className = "lanc-desc";
      desc.textContent = lancamento.descricao || "(sem descrição)";
      const valor = document.createElement("span");
      valor.className = "lanc-valor lanc-despesa";
      valor.textContent = formatCentavos(lancamento.valorCentavos || 0);
      linha.append(desc, valor);

      const meta = document.createElement("span");
      meta.className = "lanc-fatura";
      const dataFmt = formatarDataBR(lancamento.data);
      meta.textContent = `${obterNomeIconeCategoria(lancamento.categoriaId)}${dataFmt ? " · " + dataFmt : ""}`;

      li.append(linha, meta);
      listaEl.appendChild(li);
    });
  }

  async function carregar() {
    if (tituloEl) tituloEl.textContent = `Caixinhas — ${formatarMes(mesAtual)}`;
    if (statusEl) statusEl.textContent = "Carregando...";

    try {
      const [lancamentos, ...limites] = await Promise.all([
        lerLancamentosDoMes(mesAtual),
        ...pessoas.map((p) => lerCaixinhaLimite(p.chave, mesAtual))
      ]);
      if (statusEl) statusEl.textContent = "";

      pessoas.forEach((pessoa, indice) => {
        const ref = refs[pessoa.chave];
        if (!ref) return;

        const limiteDoc = limites[indice];
        const temLimite = !!(limiteDoc && Number.isInteger(limiteDoc.limiteCentavos));
        const limiteCentavos = temLimite ? limiteDoc.limiteCentavos : 0;

        const consumidores = lancamentos
          .filter((l) =>
            l.tipo === "despesa" &&
            l.responsavel === pessoa.chave &&
            (l.idRecorrencia === undefined || l.idRecorrencia === null) &&
            l.categoriaId !== "pagamento_cartao" &&
            l.categoriaId !== "pagamento_fatura"
          )
          .sort((a, b) => {
            const dataA = a.data || "";
            const dataB = b.data || "";
            if (dataA !== dataB) return dataB.localeCompare(dataA);
            return (b.criadoEm || 0) - (a.criadoEm || 0);
          });

        const gasto = consumidores.reduce((soma, l) => soma + (l.valorCentavos || 0), 0);
        const saldo = limiteCentavos - gasto;
        const estourou = saldo < 0;

        ref.limiteValor.textContent = formatCentavos(limiteCentavos);
        ref.gastoValor.textContent = formatCentavos(gasto);
        ref.saldoValor.textContent = formatCentavos(saldo);
        ref.saldoValor.classList.toggle("caixinha-estourou", estourou);
        ref.painel.classList.toggle("caixinha-painel-estourou", estourou);

        if (temLimite) {
          ref.aviso.hidden = true;
          ref.aviso.textContent = "";
          // Pré-preenche o campo com o limite atual só quando o usuário ainda não
          // digitou nada — não sobrescreve uma edição em andamento.
          if (!ref.input.value) {
            ref.input.value = (limiteCentavos / 100).toFixed(2).replace(".", ",");
          }
        } else {
          ref.aviso.hidden = false;
          ref.aviso.textContent = "Defina o limite deste mês.";
        }

        renderLista(ref.lista, consumidores);
      });
    } catch (erro) {
      console.error("Erro ao carregar as caixinhas:", erro);
      if (statusEl) {
        statusEl.textContent = `Erro ao carregar as caixinhas: ${erro.message || erro.code || "erro desconhecido"}`;
      }
    }
  }

  carregar();

  return { recarregar: carregar };
}
