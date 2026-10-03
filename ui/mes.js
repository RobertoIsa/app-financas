// ui/mes.js

import {
  lerLancamentosDoMes,
  lerLancamentosPorMesDesembolso,
  lerLancamentosPorFaturaMes,
  lerTodosLancamentos,
  lerRecebiveisPorMesEsperado,
  lerRecorrencias,
  lerCartoes,
  lerSaldoCaixa,
  materializarOcorrencia,
  excluirLancamento,
  marcarLancamentoPago,
  marcarRecebivelRecebido,
  desfazerRecebimento,
  pagarFaturaEmLote
} from "../db.js";
import {
  formatCentavos,
  mesDeData,
  dataHojeISO,
  somarMeses,
  projetarOcorrenciasDoMes,
  projetarOcorrenciasPorDesembolso,
  obterMesDesembolso,
  ehReceitaDeRecebivel
} from "../logic.js";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatarMes(mesISO) {
  if (!mesISO) return "Mês Indefinido";
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES[mes - 1]} ${ano}`;
}

function formatarDataBR(dataISO) {
  if (!dataISO) return "—";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return dataISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

const MEIOS_PAGAMENTO_LEGIVEIS = {
  dinheiro: "Dinheiro",
  debito: "Débito",
  pix: "Pix",
  transferencia: "Transferência",
  credito: "Crédito"
};

// Colunas do Excel exportado — ver CLAUDE.md "Exportar para Excel (aba Mês)".
const COLUNAS_EXPORTACAO_EXCEL = [
  "Data", "Descrição", "Categoria", "Tipo", "Valor (R$)", "Meio de Pagamento",
  "Cartão", "Responsável", "Parcela", "Status", "Mês Desembolso/Esperado", "Origem"
];

export function initTelaMes({ categorias, uid }) {
  const rotulo = document.getElementById("mesnav-label");
  const btnAnterior = document.getElementById("mesnav-anterior");
  const btnProximo = document.getElementById("mesnav-proximo");
  const btnHoje = document.getElementById("mesnav-hoje");

  // Quadro 1 — "Projeção do Mês" (ver CLAUDE.md "Resumo da aba Mês — dois quadros").
  const elProjReceitas = document.getElementById("mes-proj-receitas");
  const elProjDespesasAPagar = document.getElementById("mes-proj-despesas-pagar");
  const elProjSaldo = document.getElementById("mes-proj-saldo");

  // Quadro 2 — "Caixa Real".
  const elCaixaTotal = document.getElementById("mes-caixa-total");
  const elCaixaGastosDiaDia = document.getElementById("mes-caixa-gastos-dia-dia");
  const elCaixaSaldo = document.getElementById("mes-caixa-saldo");

  const listaReceitas = document.getElementById("lista-mes-receitas");
  const listaFaturas = document.getElementById("lista-mes-faturas");
  const listaDespesasVista = document.getElementById("lista-mes-despesas-vista");

  let categoriasCache = categorias || [];
  let mesSelecionado = mesDeData(dataHojeISO());
  let pedidoAtual = 0;
  // Trava por mês: evita que duas chamadas concorrentes de carregar() (reload rápido,
  // navegação de ida-e-volta, cliques em sequência) disparem materialização em paralelo
  // para o mesmo mês. A ausência real de duplicata é garantida pela transação em
  // db.js materializarOcorrencia; esta trava só evita trabalho/leituras redundantes.
  const mesesMaterializando = new Set();

  function obterNomeIconeCategoria(categoriaId) {
    const cat = categoriasCache.find(c => c.chave === categoriaId);
    if (!cat) return categoriaId;
    return `${cat.nome}${cat.icone ? " " + cat.icone : ""}`;
  }

  // Padrão de recolhimento reaproveitado das Caixinhas (ver ui/caixinhas.js): lista de
  // itens individuais recolhida por padrão + botão "Ver lançamentos (N)" + rolagem
  // própria quando aberta. Diferença aqui: é UNIVERSAL (desktop + mobile), não só
  // mobile como nas Caixinhas — o volume de informação (devedores/categorias/faturas)
  // é um problema nos dois tamanhos de tela nesta aba. Por isso usa classes CSS
  // próprias (.mes-grupo-lista*), não as .caixinha-lista* (essas têm a desfeita mobile-
  // only no @media(min-width:768px) que não queremos aqui).
  let contadorListaColapsavelMes = 0;

  function sincronizarBotaoToggleListaMes(btn, lista) {
    if (!btn || !lista) return;
    const fechada = lista.classList.contains("mes-grupo-lista-fechada");
    const n = Number(btn.dataset.count || 0);
    btn.textContent = fechada ? `Ver lançamentos (${n})` : "Ocultar lançamentos";
    btn.setAttribute("aria-expanded", fechada ? "false" : "true");
  }

  // Cria { btnToggle, lista } — um <button> + <ul> prontos pra receber itens via
  // appendChild, com o toggle já ligado. O chamador só precisa setar
  // `btnToggle.dataset.count` com a quantidade real de itens (ou chamar
  // `finalizarListaColapsavel`, abaixo) antes de anexar no DOM.
  function criarBlocoListaColapsavel() {
    const btnToggle = document.createElement("button");
    btnToggle.type = "button";
    btnToggle.className = "botao-secundario botao-pequeno mes-grupo-lista-toggle";
    btnToggle.dataset.count = "0";

    const lista = document.createElement("ul");
    lista.className = "mes-grupo-lista mes-grupo-lista-fechada";
    lista.id = `mes-grupo-lista-${++contadorListaColapsavelMes}`;
    btnToggle.setAttribute("aria-controls", lista.id);
    sincronizarBotaoToggleListaMes(btnToggle, lista);

    btnToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      lista.classList.toggle("mes-grupo-lista-fechada");
      sincronizarBotaoToggleListaMes(btnToggle, lista);
    });

    return { btnToggle, lista };
  }

  // Atualiza o contador do botão depois que os itens já foram anexados à lista (ou só a
  // contagem é conhecida de antemão) — mantém o rótulo "Ver lançamentos (N)" correto.
  function finalizarListaColapsavel(btnToggle, lista, quantidade) {
    btnToggle.dataset.count = String(quantidade);
    sincronizarBotaoToggleListaMes(btnToggle, lista);
  }

  // Abre (ou fecha, se já aberto) um mini-formulário inline pedindo o MÊS do recebimento
  // — nunca uma data livre (ver CLAUDE.md "Crédito a receber", "Baixa: escolha de MÊS,
  // não de data exata"): um campo de data livre com "hoje" como padrão fazia confirmações
  // atrasadas (recebível esperado em setembro, só confirmado em outubro) caírem
  // silenciosamente no mês errado. Reaproveitado tanto pelo botão "Receber" individual
  // quanto pelo "Receber Tudo" por devedor, pra nunca existir um segundo caminho que peça
  // uma data em vez de um mês.
  function abrirFormMesRecebimento(ancora, { chave, mesPadrao, onConfirmar }) {
    const existente = ancora.nextElementSibling;
    if (existente && existente.dataset && existente.dataset.formRecebivel === chave) {
      existente.remove();
      return;
    }

    const formLi = document.createElement("li");
    formLi.dataset.formRecebivel = chave;
    formLi.style.display = "flex";
    formLi.style.flexDirection = "column";
    formLi.style.gap = "8px";
    formLi.style.padding = "8px 0";
    formLi.style.borderBottom = "1px solid var(--fundo)";

    const campoMes = document.createElement("input");
    campoMes.type = "month";
    campoMes.value = mesPadrao;
    campoMes.setAttribute("aria-label", "Mês do recebimento");

    const linhaBotoes = document.createElement("div");
    linhaBotoes.style.display = "flex";
    linhaBotoes.style.gap = "8px";

    const btnConfirmar = document.createElement("button");
    btnConfirmar.type = "button";
    btnConfirmar.textContent = "Confirmar recebimento";
    btnConfirmar.className = "botao-secundario botao-pequeno";

    const btnCancelar = document.createElement("button");
    btnCancelar.type = "button";
    btnCancelar.textContent = "Cancelar";
    btnCancelar.className = "botao-secundario botao-pequeno";
    btnCancelar.onclick = (e) => {
      e.stopPropagation();
      formLi.remove();
    };

    const erro = document.createElement("p");
    erro.className = "erro";
    erro.setAttribute("role", "alert");
    erro.style.margin = "0";

    btnConfirmar.onclick = async (e) => {
      e.stopPropagation();
      if (!campoMes.value) {
        erro.textContent = "Informe o mês do recebimento.";
        return;
      }
      btnConfirmar.disabled = true;
      btnConfirmar.textContent = "Confirmando...";
      try {
        await onConfirmar(campoMes.value);
        await carregar();
      } catch (erroRequisicao) {
        erro.textContent = `Erro: ${erroRequisicao.message || erroRequisicao.code || "erro desconhecido"}`;
        btnConfirmar.disabled = false;
        btnConfirmar.textContent = "Confirmar recebimento";
      }
    };

    linhaBotoes.appendChild(btnConfirmar);
    linhaBotoes.appendChild(btnCancelar);
    formLi.appendChild(campoMes);
    formLi.appendChild(linhaBotoes);
    formLi.appendChild(erro);

    ancora.after(formLi);
  }

  // Botão "Receber" individual de um item de /receber dentro da seção "Recebimentos de
  // Terceiros" — mesmo fluxo/UX da aba "A Receber" (ver ui/receber.js
  // alternarFormRecebimento), só que reaproveitado aqui em vez de chamar
  // atualizarLancamento (que era o bug: um recebível não é um /lancamentos).
  function alternarFormRecebimentoIndividual(subReferencia, recebivel) {
    abrirFormMesRecebimento(subReferencia, {
      chave: recebivel.id,
      mesPadrao: recebivel.mesEsperado,
      onConfirmar: (mes) => marcarRecebivelRecebido(recebivel, mes, uid)
    });
  }

  // Cria o botão "Desfazer" (ou o aviso de fallback) pra uma receita gerada por baixa de
  // recebível — reaproveitado tanto pelo loop genérico de itens quanto pela seção
  // reorganizada "Recebimentos de Terceiros" abaixo, pra nunca existirem dois caminhos
  // que chamem desfazerRecebimento de formas diferentes.
  function criarAcaoDesfazerRecebivel(lancamento) {
    if (lancamento.idRecebivel) {
      const btnDesfazer = document.createElement("button");
      btnDesfazer.type = "button";
      btnDesfazer.textContent = "Desfazer";
      btnDesfazer.className = "botao-secundario botao-pequeno";
      btnDesfazer.onclick = async (e) => {
        e.stopPropagation();
        btnDesfazer.disabled = true;
        try {
          await desfazerRecebimento(
            { id: lancamento.idRecebivel, lancamentoReceitaId: lancamento.id, valorCentavos: lancamento.valorCentavos },
            uid
          );
          await carregar();
        } catch (erro) {
          alert("Erro: " + erro.message);
          btnDesfazer.disabled = false;
        }
      };
      return btnDesfazer;
    }

    // Receita antiga, gerada antes de idRecebivel existir — sem essa referência não dá
    // pra chamar desfazerRecebimento sem uma consulta por índice inexistente. Desfazer
    // continua possível pela aba "A Receber" (mesma função, a partir de lá).
    const spanLegado = document.createElement("span");
    spanLegado.textContent = 'Desfaça pela aba "A Receber"';
    spanLegado.style.color = "var(--cor-texto-suave)";
    spanLegado.style.fontSize = "0.85em";
    return spanLegado;
  }

  // Seção "Recebimentos de Terceiros" reorganizada: pendentes agrupados por devedor
  // (mesmo padrão visual/estrutural da aba "A Receber" — ver ui/receber.js
  // renderizarPendentes), com um "Receber Tudo" POR DEVEDOR; já recebidos continuam numa
  // lista simples abaixo, igual à aba "A Receber" também não agrupa os recebidos.
  // Reaproveita marcarRecebivelRecebido/desfazerRecebimento em todo caminho — nunca um
  // atualizarLancamento(id, {pago}) direto aqui, pra não reincidir no bug de "Receber
  // Tudo"/"Pagar Tudo" desconectado da lógica de caixa (já visto mais de uma vez).
  function criarItemRecebimentosTerceiros(titulo, total, pago, pendente, itens) {
    const item = document.createElement("li");
    // Card com borda — mesmo estilo visual de .caixinha-painel (ver styles.css
    // .card-grupo), pra separar visualmente este grupo dos vizinhos na lista.
    item.className = "card-grupo";

    // Cabeçalho (título + total) SEMPRE visível — não há mais um clique pra revelar os
    // números; só a lista de itens individuais abaixo é que se recolhe (ver CLAUDE.md,
    // melhoria de recolhimento universal).
    const cabecalho = document.createElement("div");
    cabecalho.className = "lanc-item-linha";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.style.fontWeight = "bold";
    desc.textContent = titulo;

    const valorTotal = document.createElement("span");
    valorTotal.className = "lanc-valor lanc-receita";
    valorTotal.textContent = `+ ${formatCentavos(total)}`;

    cabecalho.appendChild(desc);
    cabecalho.appendChild(valorTotal);
    item.appendChild(cabecalho);

    if (total > 0) {
      const linhaDetalhe = document.createElement("div");
      linhaDetalhe.style.fontSize = "0.85em";
      linhaDetalhe.style.color = "var(--cor-texto-suave)";
      linhaDetalhe.style.marginTop = "8px";
      linhaDetalhe.style.marginBottom = "10px";
      linhaDetalhe.style.display = "flex";
      linhaDetalhe.style.justifyContent = "space-between";
      linhaDetalhe.innerHTML = `<span>✅ Recebido: R$ ${formatCentavos(pago)}</span><span>⏳ A Receber: R$ ${formatCentavos(pendente)}</span>`;
      item.appendChild(linhaDetalhe);
    }

    // Um item de /receber (pendente) não tem "tipo" nem "pago" — tem "status". A receita
    // já baixada (ehReceitaDeRecebivel) é um /lancamentos de verdade.
    const pendentesRaw = (itens || []).filter((it) => it.id && it.tipo === undefined && it.status !== undefined);
    const jaRecebidos = (itens || []).filter((it) => it.id && ehReceitaDeRecebivel(it));

    if (pendentesRaw.length > 0) {
      const porDevedor = new Map();
      pendentesRaw.forEach((r) => {
        const chave = r.devedor || "Sem devedor";
        if (!porDevedor.has(chave)) porDevedor.set(chave, []);
        porDevedor.get(chave).push(r);
      });

      for (const [devedor, itensDevedor] of porDevedor) {
        const totalDevedor = itensDevedor.reduce((soma, r) => soma + r.valorCentavos, 0);

        // Card aninhado por devedor — mesmo tratamento visual do grupo externo.
        const blocoDevedor = document.createElement("div");
        blocoDevedor.className = "card-grupo";

        // Cabeçalho do devedor (nome + total pendente + "Receber Tudo") SEMPRE visível —
        // só a lista de parcelas dele (abaixo) se recolhe.
        const linhaDevedor = document.createElement("div");
        linhaDevedor.style.display = "flex";
        linhaDevedor.style.justifyContent = "space-between";
        linhaDevedor.style.alignItems = "center";
        linhaDevedor.style.fontWeight = "bold";
        linhaDevedor.style.fontSize = "0.9em";

        const nomeDevedorEl = document.createElement("span");
        nomeDevedorEl.textContent = `${devedor}: ${formatCentavos(totalDevedor)} pendente`;
        linhaDevedor.appendChild(nomeDevedorEl);

        const btnReceberTudoDevedor = document.createElement("button");
        btnReceberTudoDevedor.type = "button";
        btnReceberTudoDevedor.textContent = "Receber Tudo";
        btnReceberTudoDevedor.className = "botao-secundario botao-pequeno";
        btnReceberTudoDevedor.onclick = (e) => {
          e.stopPropagation();
          // Mesmo seletor de MÊS do botão individual (abrirFormMesRecebimento) — nunca
          // uma data livre. Pré-seleciona o mesEsperado mais antigo do grupo (parcelas
          // deste devedor podem ter mesEsperado diferentes); o usuário pode trocar antes
          // de confirmar. onConfirmar chama marcarRecebivelRecebido uma vez SÓ pelos
          // itens deste devedor (itensDevedor), nunca os de outro devedor do mesmo grupo.
          const mesPadrao = itensDevedor.reduce(
            (menor, r) => (r.mesEsperado < menor ? r.mesEsperado : menor),
            itensDevedor[0].mesEsperado
          );
          abrirFormMesRecebimento(linhaDevedor, {
            chave: `devedor-${devedor}`,
            mesPadrao,
            onConfirmar: (mes) => Promise.all(itensDevedor.map((r) => marcarRecebivelRecebido(r, mes, uid)))
          });
        };
        linhaDevedor.appendChild(btnReceberTudoDevedor);
        blocoDevedor.appendChild(linhaDevedor);

        // Lista de parcelas pendentes deste devedor — recolhida por padrão, com seu
        // próprio "Ver lançamentos (N)", independente dos outros devedores e da lista de
        // "Recebidos" abaixo (ver criarBlocoListaColapsavel).
        const { btnToggle: btnToggleDevedor, lista: listaItensDevedor } = criarBlocoListaColapsavel();

        itensDevedor.forEach((r) => {
          const sub = document.createElement("li");
          sub.style.padding = "6px 0";
          sub.style.borderBottom = "1px solid var(--fundo)";
          sub.style.display = "flex";
          sub.style.justifyContent = "space-between";
          sub.style.alignItems = "center";

          const textSpan = document.createElement("span");
          textSpan.textContent = `⏳ ${r.devedor || "Sem devedor"} - R$ ${formatCentavos(r.valorCentavos)}`;

          const btnReceber = document.createElement("button");
          btnReceber.type = "button";
          btnReceber.textContent = "Receber";
          btnReceber.className = "botao-secundario botao-pequeno";
          btnReceber.onclick = (e) => {
            e.stopPropagation();
            alternarFormRecebimentoIndividual(sub, r);
          };

          sub.appendChild(textSpan);
          sub.appendChild(btnReceber);
          listaItensDevedor.appendChild(sub);
        });
        finalizarListaColapsavel(btnToggleDevedor, listaItensDevedor, itensDevedor.length);

        blocoDevedor.appendChild(btnToggleDevedor);
        blocoDevedor.appendChild(listaItensDevedor);
        item.appendChild(blocoDevedor);
      }
    }

    if (jaRecebidos.length > 0) {
      const tituloRecebidos = document.createElement("h4");
      tituloRecebidos.textContent = "Recebidos";
      tituloRecebidos.style.margin = pendentesRaw.length > 0 ? "4px 0" : "0 0 4px";
      tituloRecebidos.style.fontSize = "0.85em";
      tituloRecebidos.style.color = "var(--cor-texto-suave)";
      item.appendChild(tituloRecebidos);

      // Lista de recebimentos já confirmados — mesmo padrão de recolhimento, própria e
      // independente da(s) lista(s) de pendentes acima.
      const { btnToggle: btnToggleRecebidos, lista: listaRecebidos } = criarBlocoListaColapsavel();

      jaRecebidos.forEach((l) => {
        const sub = document.createElement("li");
        sub.style.padding = "6px 0";
        sub.style.borderBottom = "1px solid var(--fundo)";
        sub.style.display = "flex";
        sub.style.justifyContent = "space-between";
        sub.style.alignItems = "center";

        const textSpan = document.createElement("span");
        textSpan.textContent = `✅ ${l.descricao || "Lançamento"} - R$ ${formatCentavos(l.valorCentavos)}`;

        const acoesDiv = document.createElement("div");
        acoesDiv.appendChild(criarAcaoDesfazerRecebivel(l));

        sub.appendChild(textSpan);
        sub.appendChild(acoesDiv);
        listaRecebidos.appendChild(sub);
      });
      finalizarListaColapsavel(btnToggleRecebidos, listaRecebidos, jaRecebidos.length);

      item.appendChild(btnToggleRecebidos);
      item.appendChild(listaRecebidos);
    }

    return item;
  }

  // `faturaCtx` (opcional) só é passado pelos grupos da seção "Faturas de Cartão":
  // { cartaoId }. Quando presente, o botão "Pagar Tudo" NÃO usa o caminho genérico de
  // marcar `pago` item a item — ele delega 100% pra db.js `pagarFaturaEmLote`, a MESMA
  // função que a aba "Faturas" usa (que, além de baixar as compras, cria o lançamento
  // de desembolso `pagamento_cartao` e movimenta o Caixa com origem "pagamento_fatura").
  // Sem isso, "Pagar Tudo" aqui só marcava as compras como pagas e o Caixa nunca mexia
  // — mesmo tipo de caminho paralelo que já causou bug antes (ver CLAUDE.md
  // "Padrão recorrente identificado").
  function criarItemAgrupado(titulo, total, pago, pendente, tipo, itens, faturaCtx) {
    const item = document.createElement("li");
    // Card com borda — mesmo estilo visual de .caixinha-painel (ver styles.css
    // .card-grupo), pra separar visualmente este grupo dos vizinhos na lista.
    item.className = "card-grupo";

    // Cabeçalho (título + total) SEMPRE visível — não há mais um clique pra revelar os
    // números/botões de ação; só a lista de lançamentos individuais abaixo é que se
    // recolhe (ver CLAUDE.md, melhoria de recolhimento universal, desktop + mobile).
    const cabecalho = document.createElement("div");
    cabecalho.className = "lanc-item-linha";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.style.fontWeight = "bold";
    desc.textContent = titulo;

    const valorTotal = document.createElement("span");
    valorTotal.className = `lanc-valor lanc-${tipo}`;
    const sinal = tipo === "receita" ? "+" : "−";
    valorTotal.textContent = `${sinal} ${formatCentavos(total)}`;

    cabecalho.appendChild(desc);
    cabecalho.appendChild(valorTotal);
    item.appendChild(cabecalho);

    if (total > 0) {
      const linhaDetalhe = document.createElement("div");
      linhaDetalhe.style.fontSize = "0.85em";
      linhaDetalhe.style.color = "var(--texto-secundario)";
      linhaDetalhe.style.marginTop = "8px";
      linhaDetalhe.style.display = "flex";
      linhaDetalhe.style.justifyContent = "space-between";
      linhaDetalhe.style.alignItems = "center";
      
      const textoPago = tipo === "receita" ? "Recebido" : "Pago";
      const textoPendente = tipo === "receita" ? "A Receber" : "Falta Quitar";

      const divPago = document.createElement("span");
      divPago.innerHTML = `✅ ${textoPago}: R$ ${formatCentavos(pago)}`;
      
      const divPendente = document.createElement("div");
      divPendente.style.display = "flex";
      divPendente.style.alignItems = "center";
      divPendente.innerHTML = `⏳ ${textoPendente}: R$ ${formatCentavos(pendente)}`;

      const pendentesParaBotao = (itens || []).filter(i => {
        if (!i.id) return false;
        return tipo === "receita" ? i.pago !== true : (i.pago === false || i.pago === "false");
      });

      if (pendentesParaBotao.length > 0) {
        const btnAcaoGlobal = document.createElement("button");
        btnAcaoGlobal.type = "button";
        btnAcaoGlobal.textContent = tipo === "receita" ? "Receber Tudo" : "Pagar Tudo";
        btnAcaoGlobal.className = "botao-secundario botao-pequeno";
        btnAcaoGlobal.style.marginLeft = "10px";
        
        btnAcaoGlobal.addEventListener("click", async (e) => {
          e.stopPropagation();
          const rotuloBotao = tipo === "receita" ? "Receber Tudo" : "Pagar Tudo";
          btnAcaoGlobal.disabled = true;
          btnAcaoGlobal.textContent = "...";
          try {
            let caixaFalhou = false;

            if (faturaCtx) {
              // Grupo da seção "Faturas de Cartão": paga a fatura inteira pelo MESMO
              // caminho da aba "Faturas" — db.js `pagarFaturaEmLote` — que baixa as
              // compras, cria o lançamento `pagamento_cartao` e movimenta o Caixa
              // (origem "pagamento_fatura"). Nada de marcar `pago` compra a compra aqui.
              // Todas as compras de um mesmo cartão num mesmo mês de desembolso
              // compartilham o mesmo faturaMes; uso o das próprias compras (fallback: o
              // mês selecionado) pra casar com o estorno de excluirLancamento, que
              // reencontra as compras por faturaMes.
              const ids = pendentesParaBotao.map((p) => p.id);
              const totalCentavos = pendentesParaBotao.reduce((s, p) => s + (p.valorCentavos || 0), 0);
              const faturaMes = pendentesParaBotao.find((p) => p.faturaMes)?.faturaMes || mesSelecionado;
              const resultado = await pagarFaturaEmLote(
                ids,
                totalCentavos,
                faturaMes,
                dataHojeISO(),
                "debito",
                uid
              );
              caixaFalhou = !!(resultado && resultado.caixaAtualizado === false);
            } else {
              // marcarLancamentoPago (db.js) é o ÚNICO ponto de entrada pra isso — decide
              // sozinho se precisa mexer no Caixa (ver comentário lá). Nunca chamar
              // atualizarLancamento(id, {pago}) direto aqui de novo.
              const resultados = await Promise.all(
                pendentesParaBotao.map((p) => marcarLancamentoPago(p, true, uid))
              );
              caixaFalhou = resultados.some((r) => r && r.caixaAtualizado === false);
            }

            await carregar();
            if (caixaFalhou) {
              alert("Atualizado! (Aviso: o saldo do Caixa pode não ter atualizado pra algum item — confira na aba Caixa.)");
            }
          } catch (erro) {
            alert("Erro ao atualizar: " + erro.message);
            btnAcaoGlobal.disabled = false;
            btnAcaoGlobal.textContent = rotuloBotao;
          }
        });
        divPendente.appendChild(btnAcaoGlobal);
      }

      // "Desfazer Pagamento da Fatura": só aparece quando a fatura deste cartão está
      // 100% paga (Falta Quitar = R$0,00) — se estiver parcial/pendente, o fluxo normal
      // acima ("Pagar Tudo"/pagamento individual) já cobre o caso. Evita o usuário ter
      // que procurar manualmente o lançamento "Pagamento Fatura {mês}" na aba Lançar.
      if (faturaCtx && tipo === "despesa" && pendente === 0 && total > 0) {
        const btnDesfazerPagamento = document.createElement("button");
        btnDesfazerPagamento.type = "button";
        btnDesfazerPagamento.textContent = "↩️ Desfazer Pagamento da Fatura";
        btnDesfazerPagamento.className = "botao-secundario botao-pequeno";
        btnDesfazerPagamento.style.marginLeft = "10px";

        btnDesfazerPagamento.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm("Desfazer o pagamento desta fatura? As compras voltam a ficar pendentes e o valor é estornado no Caixa.")) {
            return;
          }
          btnDesfazerPagamento.disabled = true;
          btnDesfazerPagamento.textContent = "Desfazendo...";
          try {
            // O lançamento de pagamento (categoriaId "pagamento_cartao"/"pagamento_fatura",
            // criado por pagarFaturaEmLote) não guarda cartaoId nem faturaMes — só a
            // descrição "Pagamento Fatura {faturaMes}" e o valor total pago. Localiza por
            // esses dois campos entre TODOS os lançamentos (lerTodosLancamentos, sem
            // índice — ver db.js); com valor igual ao total (fatura 100% paga, então
            // total === pago) e, havendo mais de um candidato, pega o mais recente.
            const faturaMesAlvo = (itens || []).find((i) => i.faturaMes)?.faturaMes || mesSelecionado;
            const todosLancamentos = await lerTodosLancamentos();
            const candidatos = todosLancamentos.filter(
              (l) =>
                (l.categoriaId === "pagamento_cartao" || l.categoriaId === "pagamento_fatura") &&
                l.descricao === `Pagamento Fatura ${faturaMesAlvo}` &&
                l.valorCentavos === total
            );
            const pagamento = candidatos.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0))[0];

            if (!pagamento) {
              alert('Não encontrei o lançamento "Pagamento Fatura" desta fatura — desfaça manualmente na aba Lançar.');
              btnDesfazerPagamento.disabled = false;
              btnDesfazerPagamento.textContent = "↩️ Desfazer Pagamento da Fatura";
              return;
            }

            // Reaproveita exatamente excluirLancamento (db.js) — já trata o estorno das
            // compras pra pago:false e o estorno no Caixa (ver CLAUDE.md), nada novo
            // reimplementado aqui.
            await excluirLancamento(pagamento, uid);
            await carregar();
          } catch (erro) {
            alert("Erro ao desfazer pagamento da fatura: " + erro.message);
            btnDesfazerPagamento.disabled = false;
            btnDesfazerPagamento.textContent = "↩️ Desfazer Pagamento da Fatura";
          }
        });

        divPendente.appendChild(btnDesfazerPagamento);
      }

      linhaDetalhe.appendChild(divPago);
      linhaDetalhe.appendChild(divPendente);
      item.appendChild(linhaDetalhe);
    }

    // Lista de lançamentos individuais deste grupo — recolhida por padrão, com seu
    // próprio "Ver lançamentos (N)" (ver criarBlocoListaColapsavel). Os botões de ação
    // em massa acima (Pagar/Receber Tudo, Desfazer Pagamento da Fatura) continuam
    // sempre visíveis e funcionais independente deste estado.
    const { btnToggle: btnToggleSubLista, lista: subLista } = criarBlocoListaColapsavel();

    (itens || []).forEach(it => {
      const sub = document.createElement("li");
      sub.style.padding = "6px 0";
      sub.style.borderBottom = "1px solid var(--fundo)";
      sub.style.display = "flex";
      sub.style.justifyContent = "space-between";
      sub.style.alignItems = "center";
      
      const isPago = tipo === "receita" ? (it.pago === true) : (it.pago !== false && it.pago !== "false"); 
      const statusIcon = isPago ? "✅" : "⏳";
      const descricaoItem = it.descricao || "Lançamento";
      
      const textSpan = document.createElement("span");
      textSpan.textContent = `${statusIcon} ${descricaoItem} - R$ ${formatCentavos(it.valorCentavos)}`;
      
      const acoesDiv = document.createElement("div");

      // Itens de /receber (recebível pendente) e a receita gerada por baixa de
      // recebível nunca chegam aqui — a categoria "recebimentos_terceiros" é
      // interceptada em carregar() e renderizada por criarItemRecebimentosTerceiros,
      // que reagrupa por devedor e reaproveita marcarRecebivelRecebido/
      // desfazerRecebimento diretamente (ver função acima). Este loop só trata
      // despesas/receitas/recorrências normais.
      if (it.id) {
        const btnToggle = document.createElement("button");
        btnToggle.type = "button";
        btnToggle.textContent = isPago ? "Desfazer" : (tipo === "receita" ? "Receber" : "Pagar");
        btnToggle.className = "botao-secundario botao-pequeno";
        btnToggle.style.marginRight = "8px";
        btnToggle.onclick = async (e) => {
          e.stopPropagation();
          btnToggle.disabled = true;
          try {
            // marcarLancamentoPago (db.js) é o ÚNICO ponto de entrada pra isso — decide
            // sozinho se precisa mexer no Caixa (ver comentário lá). Nunca chamar
            // atualizarLancamento(id, {pago}) direto aqui de novo — foi exatamente essa
            // duplicação (o botão "Pagar Tudo" tinha seu próprio caminho paralelo) que
            // causou o bug de recorrência paga não mover o caixa.
            const resultado = await marcarLancamentoPago(it, !isPago, uid);
            await carregar();
            if (resultado && resultado.caixaAtualizado === false) {
              alert("Atualizado! (Aviso: o saldo do Caixa pode não ter atualizado — confira na aba Caixa.)");
            }
          } catch (erro) {
            alert("Erro: " + erro.message);
            btnToggle.disabled = false;
          }
        };

        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.textContent = "🗑️";
        btnDel.className = "botao-secundario botao-pequeno";
        btnDel.onclick = async (e) => {
          e.stopPropagation();
          if(confirm(`Excluir ${descricaoItem}?`)) {
              btnDel.disabled = true;
              try {
                await excluirLancamento(it, uid);
                await carregar();
              } catch (erro) {
                alert("Erro: " + erro.message);
                btnDel.disabled = false;
              }
          }
        };

        acoesDiv.appendChild(btnToggle);
        acoesDiv.appendChild(btnDel);
      } else {
        const spanVirtual = document.createElement("span");
        spanVirtual.textContent = "Projeção";
        spanVirtual.style.color = "var(--texto-secundario)";
        acoesDiv.appendChild(spanVirtual);
      }

      sub.appendChild(textSpan);
      sub.appendChild(acoesDiv);
      subLista.appendChild(sub);
    });
    finalizarListaColapsavel(btnToggleSubLista, subLista, (itens || []).length);

    item.appendChild(btnToggleSubLista);
    item.appendChild(subLista);

    return item;
  }

  async function carregar() {
    const meuPedido = ++pedidoAtual;
    
    try {
      if (rotulo) rotulo.textContent = formatarMes(mesSelecionado);
      
      if (listaReceitas) listaReceitas.innerHTML = "<li>Carregando...</li>";
      if (listaFaturas) listaFaturas.innerHTML = "<li>Carregando...</li>";
      if (listaDespesasVista) listaDespesasVista.innerHTML = "<li>Carregando...</li>";

      if (elProjReceitas) elProjReceitas.textContent = "—";
      if (elProjDespesasAPagar) elProjDespesasAPagar.textContent = "—";
      if (elProjSaldo) elProjSaldo.textContent = "—";
      if (elCaixaTotal) elCaixaTotal.textContent = "—";
      if (elCaixaGastosDiaDia) elCaixaGastosDiaDia.textContent = "—";
      if (elCaixaSaldo) elCaixaSaldo.textContent = "—";

      let [lancamentosCompetencia, lancamentosDesembolso, recebiveisDoMes, cartoes, recorrencias, saldoCaixa] = await Promise.all([
        lerLancamentosDoMes(mesSelecionado),
        lerLancamentosPorMesDesembolso(mesSelecionado),
        lerRecebiveisPorMesEsperado(mesSelecionado),
        lerCartoes(),
        lerRecorrencias(),
        lerSaldoCaixa()
      ]);
      if (meuPedido !== pedidoAtual) return;

      const cartoesPorId = Object.fromEntries(cartoes.map((c) => [c.id, c]));
      const mesAtual = mesDeData(dataHojeISO());

      if (mesSelecionado <= mesAtual && !mesesMaterializando.has(mesSelecionado)) {
        mesesMaterializando.add(mesSelecionado);
        try {
          const ocorrenciasEsperadas = projetarOcorrenciasDoMes(recorrencias, mesSelecionado, cartoesPorId);
          const faltantes = ocorrenciasEsperadas.filter(
            (oc) => !lancamentosCompetencia.some((l) => l.idRecorrencia === oc.idRecorrencia)
          );
          if (faltantes.length > 0) {
            await Promise.all(faltantes.map((oc) => materializarOcorrencia(oc, uid)));
            if (meuPedido !== pedidoAtual) return;
            lancamentosCompetencia = await lerLancamentosDoMes(mesSelecionado);
            lancamentosDesembolso = await lerLancamentosPorMesDesembolso(mesSelecionado);
            if (meuPedido !== pedidoAtual) return;
          }
        } finally {
          mesesMaterializando.delete(mesSelecionado);
        }
      }

      let recorrentesVirtuaisCompetencia = [];
      let recorrentesVirtuaisDesembolso = [];
      if (mesSelecionado > mesAtual) {
        recorrentesVirtuaisCompetencia = projetarOcorrenciasDoMes(recorrencias, mesSelecionado, cartoesPorId);
        recorrentesVirtuaisDesembolso = projetarOcorrenciasPorDesembolso(recorrencias, mesSelecionado, cartoesPorId);
      }

      // Fallback pra lançamentos de crédito antigos sem mesDesembolso preenchido: como
      // mesDesembolso só pode ser o próprio faturaMes ou o mês seguinte (ver CLAUDE.md
      // "Vencimento e mês de desembolso"), consultar faturaMes = mesSelecionado e
      // faturaMes = mês anterior cobre todo candidato possível. Mesclado (por id) com
      // lancamentosDesembolso — que já cobre corretamente os registros com o campo
      // preenchido — e resolvido com obterMesDesembolso (fallback: faturaMes || mes).
      const [lancamentosFaturaAtual, lancamentosFaturaAnterior] = await Promise.all([
        lerLancamentosPorFaturaMes(mesSelecionado),
        lerLancamentosPorFaturaMes(somarMeses(mesSelecionado, -1))
      ]);
      if (meuPedido !== pedidoAtual) return;

      const candidatosDesembolsoPorId = new Map();
      lancamentosDesembolso.forEach((l) => candidatosDesembolsoPorId.set(l.id, l));
      [...lancamentosFaturaAtual, ...lancamentosFaturaAnterior].forEach((l) => {
        if (!candidatosDesembolsoPorId.has(l.id)) candidatosDesembolsoPorId.set(l.id, l);
      });

      const despesasCreditoDoMes = [...candidatosDesembolsoPorId.values()].filter(
        (l) => l.tipo === "despesa" && l.meioPagamento === "credito" && obterMesDesembolso(l) === mesSelecionado
      );

      const gruposReceitas = {};
      let totalGeralReceitas = 0;

      function addReceita(catId, valor, recebido, itemOriginal) {
        if (!gruposReceitas[catId]) gruposReceitas[catId] = { total: 0, pago: 0, pendente: 0, itens: [] };
        gruposReceitas[catId].total += valor;
        if (recebido) gruposReceitas[catId].pago += valor;
        else gruposReceitas[catId].pendente += valor;
        if (itemOriginal) gruposReceitas[catId].itens.push(itemOriginal);
        totalGeralReceitas += valor;
      }

      lancamentosDesembolso.filter(l => l.tipo === "receita").forEach(l => {
        addReceita(l.categoriaId, l.valorCentavos, l.pago === true, l);
      });
      recebiveisDoMes.filter(r => r.status === "pendente").forEach(r => {
        addReceita("recebimentos_terceiros", r.valorCentavos, false, r);
      });

      // Recorrências de RECEITA ainda não materializadas (meses futuros): mesmo tratamento
      // dado às de despesa acima (addFatura/addVista) — sem isso, uma receita recorrente
      // "sem fim" simplesmente some da projeção assim que o mês deixa de estar
      // materializado, mesmo a regra continuando ativa. Espelha o split crédito/não-crédito
      // já usado pra despesa: crédito por mesDesembolso, não-crédito por competência (pra
      // não-crédito os dois eixos são o mesmo mês, ver CLAUDE.md "Os dois eixos de tempo").
      recorrentesVirtuaisDesembolso.filter(r => r.tipo === "receita" && r.meioPagamento === "credito").forEach(r => {
        addReceita(r.categoriaId, r.valorCentavos, false, r);
      });
      recorrentesVirtuaisCompetencia.filter(r => r.tipo === "receita" && r.meioPagamento !== "credito").forEach(r => {
        addReceita(r.categoriaId, r.valorCentavos, false, r);
      });

      const gruposFaturas = {};
      let totalGeralFaturas = 0;

      function addFatura(cartaoId, valor, pago, itemOriginal) {
        if (!gruposFaturas[cartaoId]) gruposFaturas[cartaoId] = { total: 0, pago: 0, pendente: 0, itens: [] };
        gruposFaturas[cartaoId].total += valor;
        if (pago) gruposFaturas[cartaoId].pago += valor;
        else gruposFaturas[cartaoId].pendente += valor;
        if (itemOriginal) gruposFaturas[cartaoId].itens.push(itemOriginal);
        totalGeralFaturas += valor;
      }

      // Agrupa por eixo DESEMBOLSO (mesDesembolso), não por faturaMes nem por mes de
      // competência — uma compra parcelada tem o mesmo "mes" (competência) em todas as
      // parcelas, mas cada parcela vence (desembolsa) num mês diferente; é isso que essa
      // seção precisa mostrar (ver CLAUDE.md "Vencimento e mês de desembolso").
      despesasCreditoDoMes.forEach(l => {
        addFatura(l.cartaoId, l.valorCentavos, !!l.pago, l);
      });

      recorrentesVirtuaisDesembolso.filter(r =>
        r.tipo === "despesa" &&
        r.meioPagamento === "credito"
      ).forEach(r => {
        addFatura(r.cartaoId, r.valorCentavos, false, r);
      });

      const gruposVista = {};
      let totalGeralVista = 0;

      function addVista(catId, valor, pago, itemOriginal) {
        if (!gruposVista[catId]) gruposVista[catId] = { total: 0, pago: 0, pendente: 0, itens: [] };
        gruposVista[catId].total += valor;
        if (pago) gruposVista[catId].pago += valor;
        else gruposVista[catId].pendente += valor;
        if (itemOriginal) gruposVista[catId].itens.push(itemOriginal);
        totalGeralVista += valor;
      }

      // Lê da competência para amarrar as despesas à vista ao mês em que foram feitas
      lancamentosCompetencia.filter(l => l.tipo === "despesa" && l.meioPagamento !== "credito" && l.categoriaId !== "pagamento_cartao").forEach(l => {
        addVista(l.categoriaId, l.valorCentavos, l.pago !== false, l);
      });
      recorrentesVirtuaisCompetencia.filter(r => r.tipo === "despesa" && r.meioPagamento !== "credito").forEach(r => {
        addVista(r.categoriaId, r.valorCentavos, false, r);
      });

      // ---- Quadro 1: "Projeção do Mês" (ver CLAUDE.md "Resumo da aba Mês — dois
      // quadros"). Total de Receitas é exatamente o totalGeralReceitas somado acima:
      // receitas confirmadas do mês (lancamentosDesembolso) + recebíveis pendentes
      // (mesEsperado=M) + recorrências de receita, materializadas (já estão em
      // lancamentosDesembolso) ou virtuais (recorrentesVirtuaisDesembolso/Competencia,
      // só populadas pra meses futuros) — nada novo a calcular aqui.
      const todosPorDesembolsoDoMes = [...candidatosDesembolsoPorId.values()].filter(
        (l) => obterMesDesembolso(l) === mesSelecionado
      );

      // Despesas do Mês (ver CLAUDE.md, renomeado/corrigido de "Despesas a Pagar"): TODAS
      // as despesas RECORRENTES com mesDesembolso=M, pagas OU NÃO, + TODAS as despesas
      // NÃO-recorrentes NO CRÉDITO com mesDesembolso=M, pagas OU NÃO — sem filtro por
      // `pago`, de propósito: é o comprometimento TOTAL do mês, não o que ainda falta
      // pagar, pra não oscilar (diminuir) conforme o usuário vai pagando contas durante o
      // mês. Não inclui despesa imediata não-recorrente — essa é "dinheiro que já saiu",
      // domínio do Quadro 2 (Caixa Real).
      const despesasRecorrentesDoMes = todosPorDesembolsoDoMes.filter(
        (l) => l.tipo === "despesa" && l.idRecorrencia
      );
      // Ocorrências de recorrência ainda NÃO materializadas (só existem pra meses
      // futuros — recorrentesVirtuaisDesembolso fica vazio pra mês atual/passado, pois
      // aí a materialização acima já rodou): contam igual às materializadas. Dedupe
      // defensivo por idRecorrencia contra o conjunto real: uma regra visitada/
      // materializada numa competência passada, cujo desembolso cai neste mês futuro,
      // não deve contar 2× (uma vez como real, outra como projeção virtual da mesma
      // regra).
      const idsRecorrenciaJaMaterializados = new Set(
        despesasRecorrentesDoMes.map((l) => l.idRecorrencia)
      );
      const despesasRecorrentesVirtuais = recorrentesVirtuaisDesembolso.filter(
        (r) => r.tipo === "despesa" && !idsRecorrenciaJaMaterializados.has(r.idRecorrencia)
      );
      const despesasCreditoNaoRecorrentesDoMes = despesasCreditoDoMes.filter(
        (l) => !l.idRecorrencia
      );

      const totalDespesasDoMes =
        despesasRecorrentesDoMes.reduce((s, l) => s + l.valorCentavos, 0) +
        despesasRecorrentesVirtuais.reduce((s, r) => s + r.valorCentavos, 0) +
        despesasCreditoNaoRecorrentesDoMes.reduce((s, l) => s + l.valorCentavos, 0);

      const saldoDoMes = totalGeralReceitas - totalDespesasDoMes;

      if (elProjReceitas) elProjReceitas.textContent = formatCentavos(totalGeralReceitas);
      if (elProjDespesasAPagar) elProjDespesasAPagar.textContent = formatCentavos(totalDespesasDoMes);
      if (elProjSaldo) {
        elProjSaldo.textContent = formatCentavos(saldoDoMes);
        elProjSaldo.className = "mes-resumo-valor";
        if (saldoDoMes < 0) elProjSaldo.classList.add("lanc-despesa");
        if (saldoDoMes > 0) elProjSaldo.classList.add("lanc-receita");
      }

      // ---- Quadro 2: "Caixa Real" ----
      // Total Caixa: mesmo saldo acumulado exibido na aba Caixa (/caixa/saldo).
      // Gastos do Dia a Dia: despesas IMEDIATAS (não-crédito) e NÃO-recorrentes do mês,
      // das DUAS pessoas somadas (visão da casa, sem filtrar por responsável) — mesmo
      // filtro usado em ui/caixinhas.js pro "gasto no mês" de cada pessoa, generalizado
      // aqui só tirando a condição de responsavel. Lê de lancamentosCompetencia: pra
      // meio não-crédito, mesDesembolso === mes sempre, então competência e desembolso
      // são o mesmo mês (ver CLAUDE.md "Os dois eixos de tempo").
      const gastosDiaDia = lancamentosCompetencia.filter((l) =>
        l.tipo === "despesa" &&
        l.meioPagamento !== "credito" &&
        (l.idRecorrencia === undefined || l.idRecorrencia === null) &&
        l.categoriaId !== "pagamento_cartao" &&
        l.categoriaId !== "pagamento_fatura"
      );
      const totalGastosDiaDia = gastosDiaDia.reduce((s, l) => s + (l.valorCentavos || 0), 0);
      const totalCaixa = (saldoCaixa && saldoCaixa.valorCentavos) || 0;
      const saldoCaixaMes = totalCaixa - totalGastosDiaDia;

      if (elCaixaTotal) elCaixaTotal.textContent = formatCentavos(totalCaixa);
      if (elCaixaGastosDiaDia) elCaixaGastosDiaDia.textContent = formatCentavos(totalGastosDiaDia);
      if (elCaixaSaldo) {
        elCaixaSaldo.textContent = formatCentavos(saldoCaixaMes);
        elCaixaSaldo.className = "mes-resumo-valor";
        if (saldoCaixaMes < 0) elCaixaSaldo.classList.add("lanc-despesa");
        if (saldoCaixaMes > 0) elCaixaSaldo.classList.add("lanc-receita");
      }

      if (listaReceitas) {
        listaReceitas.innerHTML = "";
        if (Object.keys(gruposReceitas).length === 0) listaReceitas.innerHTML = "<li class='lanc-item'>Nenhuma receita neste mês.</li>";
        for (const [catId, dados] of Object.entries(gruposReceitas)) {
          // "Recebimentos de Terceiros" tem estrutura própria (agrupado por devedor,
          // ver criarItemRecebimentosTerceiros) — todas as outras categorias de receita
          // continuam pelo caminho genérico de sempre.
          if (catId === "recebimentos_terceiros") {
            listaReceitas.appendChild(criarItemRecebimentosTerceiros(obterNomeIconeCategoria(catId), dados.total, dados.pago, dados.pendente, dados.itens));
          } else {
            listaReceitas.appendChild(criarItemAgrupado(obterNomeIconeCategoria(catId), dados.total, dados.pago, dados.pendente, "receita", dados.itens));
          }
        }
      }

      if (listaFaturas) {
        listaFaturas.innerHTML = "";
        if (Object.keys(gruposFaturas).length === 0) listaFaturas.innerHTML = "<li class='lanc-item'>Nenhuma fatura de cartão.</li>";
        for (const [cartaoId, dados] of Object.entries(gruposFaturas)) {
          const nomeCartao = cartoesPorId[cartaoId]?.nome || "Cartão Excluído";
          listaFaturas.appendChild(criarItemAgrupado(`💳 Fatura: ${nomeCartao}`, dados.total, dados.pago, dados.pendente, "despesa", dados.itens, { cartaoId }));
        }
      }

      if (listaDespesasVista) {
        listaDespesasVista.innerHTML = "";
        if (Object.keys(gruposVista).length === 0) listaDespesasVista.innerHTML = "<li class='lanc-item'>Nenhuma despesa à vista.</li>";
        for (const [catId, dados] of Object.entries(gruposVista)) {
          listaDespesasVista.appendChild(criarItemAgrupado(obterNomeIconeCategoria(catId), dados.total, dados.pago, dados.pendente, "despesa", dados.itens));
        }
      }

    } catch (erro) {
      console.error(erro);
      if (listaReceitas) {
        listaReceitas.innerHTML = `<li class='lanc-item lanc-despesa' style='color:red'>Erro no painel: ${erro.message}</li>`;
      } else {
        alert("Erro no painel: " + erro.message);
      }
    }
  }

  if (btnAnterior) btnAnterior.addEventListener("click", () => {
    mesSelecionado = somarMeses(mesSelecionado, -1);
    carregar();
  });
  if (btnProximo) btnProximo.addEventListener("click", () => {
    mesSelecionado = somarMeses(mesSelecionado, 1);
    carregar();
  });
  if (btnHoje) btnHoje.addEventListener("click", () => {
    mesSelecionado = mesDeData(dataHojeISO());
    carregar();
  });

  // "Exportar Excel" (ver CLAUDE.md "Exportar para Excel (aba Mês)") — exporta o mês
  // ATUALMENTE selecionado na navegação (fecha sobre `mesSelecionado` no momento do
  // clique, não um mês fixo). Mesmas duas fontes/eixo desembolso da aba Mês: lançamentos
  // via obterMesDesembolso + recebíveis pendentes por mesEsperado, com o mesmo merge por
  // id (desembolso + competência + faturaMes atual/anterior) usado em carregar() pra
  // cobrir lançamentos de crédito antigos sem mesDesembolso gravado.
  const btnExportar = document.getElementById("mes-exportar-excel");
  const statusExportar = document.getElementById("mes-exportar-status");

  async function exportarExcel() {
    const mesAlvo = mesSelecionado;
    if (statusExportar) statusExportar.textContent = "Gerando planilha...";
    if (btnExportar) {
      btnExportar.disabled = true;
      btnExportar.textContent = "Gerando...";
    }

    try {
      const [porDesembolso, porCompetencia, faturaAtual, faturaAnterior, recebiveisDoMes, cartoes] =
        await Promise.all([
          lerLancamentosPorMesDesembolso(mesAlvo),
          lerLancamentosDoMes(mesAlvo),
          lerLancamentosPorFaturaMes(mesAlvo),
          lerLancamentosPorFaturaMes(somarMeses(mesAlvo, -1)),
          lerRecebiveisPorMesEsperado(mesAlvo),
          lerCartoes()
        ]);

      const porId = new Map();
      [porDesembolso, porCompetencia, faturaAtual, faturaAnterior].forEach((lista) => {
        lista.forEach((l) => {
          if (l && l.id && !porId.has(l.id)) porId.set(l.id, l);
        });
      });
      const lancamentosDoMesAlvo = [...porId.values()].filter(
        (l) => obterMesDesembolso(l) === mesAlvo
      );

      const cartoesPorIdExport = Object.fromEntries(cartoes.map((c) => [c.id, c]));
      const nomeCartaoExport = (id) => (cartoesPorIdExport[id] && cartoesPorIdExport[id].nome) || "—";
      const nomeCategoriaExport = (chave) => {
        const cat = categoriasCache.find((c) => c.chave === chave);
        return cat ? cat.nome : (chave || "—");
      };
      const nomeResponsavelExport = (chave) =>
        chave ? chave.charAt(0).toUpperCase() + chave.slice(1) : "—";
      const nomeMeioExport = (meio) => MEIOS_PAGAMENTO_LEGIVEIS[meio] || meio || "—";

      const linhasLancamentos = lancamentosDoMesAlvo.map((l) => ({
        _ordem: l.data || "9999-99-99",
        "Data": formatarDataBR(l.data),
        "Descrição": l.descricao || "(sem descrição)",
        "Categoria": nomeCategoriaExport(l.categoriaId),
        "Tipo": l.tipo === "receita" ? "Receita" : "Despesa",
        "Valor (R$)": l.tipo === "receita" ? (l.valorCentavos || 0) / 100 : -(l.valorCentavos || 0) / 100,
        "Meio de Pagamento": nomeMeioExport(l.meioPagamento),
        "Cartão": l.meioPagamento === "credito" ? nomeCartaoExport(l.cartaoId) : "—",
        "Responsável": nomeResponsavelExport(l.responsavel),
        "Parcela": l.totalParcelas > 1 ? `${l.parcelaAtual}/${l.totalParcelas}` : "—",
        "Status": l.pago === true ? "Pago" : "Pendente",
        "Mês Desembolso/Esperado": mesAlvo,
        "Origem": "Lançamento"
      }));

      const recebiveisPendentes = recebiveisDoMes.filter((r) => r.status === "pendente");
      const linhasRecebiveis = recebiveisPendentes.map((r) => ({
        _ordem: "9999-99-99",
        "Data": "—",
        "Descrição": `Recebimento de ${r.devedor || "devedor não informado"}`,
        "Categoria": "Recebimentos de Terceiros",
        "Tipo": "A Receber - Pendente",
        "Valor (R$)": (r.valorCentavos || 0) / 100,
        "Meio de Pagamento": "—",
        "Cartão": "—",
        "Responsável": r.devedor || "—",
        "Parcela": r.totalParcelas > 1 ? `${r.parcelaAtual}/${r.totalParcelas}` : "—",
        "Status": "Pendente",
        "Mês Desembolso/Esperado": mesAlvo,
        "Origem": "A Receber Pendente"
      }));

      const todasLinhas = [...linhasLancamentos, ...linhasRecebiveis].sort((a, b) =>
        a._ordem.localeCompare(b._ordem)
      );
      todasLinhas.forEach((linha) => delete linha._ordem);

      // Import dinâmico do SheetJS via CDN — sem instalar pacote, mantém vanilla JS sem
      // build (ver CLAUDE.md "Stack").
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs");

      const planilha = todasLinhas.length > 0
        ? XLSX.utils.json_to_sheet(todasLinhas, { header: COLUNAS_EXPORTACAO_EXCEL })
        : XLSX.utils.aoa_to_sheet([COLUNAS_EXPORTACAO_EXCEL]); // sem dados: só o cabeçalho

      planilha["!cols"] = COLUNAS_EXPORTACAO_EXCEL.map((c) => ({ wch: Math.max(12, c.length + 2) }));

      if (todasLinhas.length > 0) {
        const colValorIndex = COLUNAS_EXPORTACAO_EXCEL.indexOf("Valor (R$)");
        todasLinhas.forEach((_, indice) => {
          const endereco = XLSX.utils.encode_cell({ r: indice + 1, c: colValorIndex });
          if (planilha[endereco]) planilha[endereco].z = '"R$" #,##0.00';
        });
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, planilha, `Caixa ${mesAlvo}`);
      XLSX.writeFile(workbook, `caixa-${mesAlvo}.xlsx`);

      if (statusExportar) {
        statusExportar.textContent = todasLinhas.length > 0
          ? `Exportado: ${todasLinhas.length} linha(s) de ${formatarMes(mesAlvo)}.`
          : `Nenhum lançamento ou recebível pendente em ${formatarMes(mesAlvo)} — planilha gerada só com cabeçalho.`;
      }
    } catch (erro) {
      console.error("Erro ao exportar Excel da aba Mês:", erro);
      if (statusExportar) {
        statusExportar.textContent = `Erro ao exportar: ${erro.message || erro.code || "erro desconhecido"}`;
      }
    } finally {
      if (btnExportar) {
        btnExportar.disabled = false;
        btnExportar.textContent = "📊 Exportar Excel";
      }
    }
  }

  if (btnExportar) btnExportar.addEventListener("click", exportarExcel);

  carregar();


  return {
    recarregarCategorias(novaListaCategorias) {
      categoriasCache = novaListaCategorias || [];
      carregar();
    },
    recarregar: carregar
  };
}