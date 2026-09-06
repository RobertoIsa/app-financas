// ui/mes.js

import {
  lerLancamentosDoMes,
  lerLancamentosPorMesDesembolso,
  lerLancamentosPorFaturaMes,
  lerRecebiveisPorMesEsperado,
  lerRecorrencias,
  lerCartoes,
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

export function initTelaMes({ categorias, uid }) {
  const rotulo = document.getElementById("mesnav-label");
  const btnAnterior = document.getElementById("mesnav-anterior");
  const btnProximo = document.getElementById("mesnav-proximo");
  const btnHoje = document.getElementById("mesnav-hoje");

  const elTotalReceitas = document.getElementById("mes-balanco-receitas");
  const elTotalDespesas = document.getElementById("mes-balanco-despesas");
  const elSaldo = document.getElementById("mes-balanco-saldo");

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

  // Abre (ou fecha, se já aberto) um mini-formulário inline pedindo a data do
  // recebimento, pro botão "Receber" individual de um item de /receber dentro da
  // seção "Recebimentos de Terceiros" — mesmo fluxo/UX da aba "A Receber"
  // (ver ui/receber.js alternarFormRecebimento), só que reaproveitado aqui em vez de
  // chamar atualizarLancamento (que era o bug: um recebível não é um /lancamentos).
  function alternarFormRecebimentoIndividual(subReferencia, recebivel) {
    const existente = subReferencia.nextElementSibling;
    if (existente && existente.dataset && existente.dataset.formRecebivel === recebivel.id) {
      existente.remove();
      return;
    }

    const formLi = document.createElement("li");
    formLi.dataset.formRecebivel = recebivel.id;
    formLi.style.display = "flex";
    formLi.style.flexDirection = "column";
    formLi.style.gap = "8px";
    formLi.style.padding = "8px 0";
    formLi.style.borderBottom = "1px solid var(--fundo)";

    const campoData = document.createElement("input");
    campoData.type = "date";
    campoData.value = dataHojeISO();
    campoData.setAttribute("aria-label", "Data do recebimento");

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
      if (!campoData.value) {
        erro.textContent = "Informe a data do recebimento.";
        return;
      }
      btnConfirmar.disabled = true;
      btnConfirmar.textContent = "Confirmando...";
      try {
        await marcarRecebivelRecebido(recebivel, campoData.value, uid);
        await carregar();
      } catch (erroRequisicao) {
        erro.textContent = `Erro: ${erroRequisicao.message || erroRequisicao.code || "erro desconhecido"}`;
        btnConfirmar.disabled = false;
        btnConfirmar.textContent = "Confirmar recebimento";
      }
    };

    linhaBotoes.appendChild(btnConfirmar);
    linhaBotoes.appendChild(btnCancelar);
    formLi.appendChild(campoData);
    formLi.appendChild(linhaBotoes);
    formLi.appendChild(erro);

    subReferencia.after(formLi);
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
    item.className = "lanc-item";
    item.style.flexDirection = "column";
    item.style.alignItems = "stretch";

    const linhaPrincipal = document.createElement("div");
    linhaPrincipal.className = "lanc-item-linha";
    linhaPrincipal.style.cursor = "pointer";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.style.fontWeight = "bold";
    desc.textContent = titulo;

    const valorTotal = document.createElement("span");
    valorTotal.className = "lanc-valor lanc-receita";
    valorTotal.textContent = `+ ${formatCentavos(total)}`;

    linhaPrincipal.appendChild(desc);
    linhaPrincipal.appendChild(valorTotal);
    item.appendChild(linhaPrincipal);

    const painelDetalhes = document.createElement("div");
    painelDetalhes.style.display = "none";
    painelDetalhes.style.marginTop = "10px";
    painelDetalhes.style.paddingTop = "10px";
    painelDetalhes.style.borderTop = "1px solid var(--borda)";

    if (total > 0) {
      const linhaDetalhe = document.createElement("div");
      linhaDetalhe.style.fontSize = "0.85em";
      linhaDetalhe.style.color = "var(--cor-texto-suave)";
      linhaDetalhe.style.marginBottom = "10px";
      linhaDetalhe.style.display = "flex";
      linhaDetalhe.style.justifyContent = "space-between";
      linhaDetalhe.innerHTML = `<span>✅ Recebido: R$ ${formatCentavos(pago)}</span><span>⏳ A Receber: R$ ${formatCentavos(pendente)}</span>`;
      painelDetalhes.appendChild(linhaDetalhe);
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

        const blocoDevedor = document.createElement("div");
        blocoDevedor.style.marginBottom = "12px";

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
        btnReceberTudoDevedor.onclick = async (e) => {
          e.stopPropagation();
          btnReceberTudoDevedor.disabled = true;
          btnReceberTudoDevedor.textContent = "...";
          try {
            // Mesma função usada pelo botão individual e pela aba "A Receber" — chamada
            // uma vez por item SÓ deste devedor (itensDevedor), nunca os de outro devedor
            // do mesmo grupo. Data de hoje pra todos, igual ao "Pagar Tudo" já existente.
            await Promise.all(itensDevedor.map((r) => marcarRecebivelRecebido(r, dataHojeISO(), uid)));
            await carregar();
          } catch (erro) {
            alert("Erro ao receber: " + erro.message);
            btnReceberTudoDevedor.disabled = false;
            btnReceberTudoDevedor.textContent = "Receber Tudo";
          }
        };
        linhaDevedor.appendChild(btnReceberTudoDevedor);
        blocoDevedor.appendChild(linhaDevedor);

        const listaItensDevedor = document.createElement("ul");
        listaItensDevedor.style.listStyle = "none";
        listaItensDevedor.style.padding = "0";
        listaItensDevedor.style.margin = "4px 0 0";
        listaItensDevedor.style.fontSize = "0.9em";

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

        blocoDevedor.appendChild(listaItensDevedor);
        painelDetalhes.appendChild(blocoDevedor);
      }
    }

    if (jaRecebidos.length > 0) {
      const tituloRecebidos = document.createElement("h4");
      tituloRecebidos.textContent = "Recebidos";
      tituloRecebidos.style.margin = pendentesRaw.length > 0 ? "4px 0" : "0 0 4px";
      tituloRecebidos.style.fontSize = "0.85em";
      tituloRecebidos.style.color = "var(--cor-texto-suave)";
      painelDetalhes.appendChild(tituloRecebidos);

      const listaRecebidos = document.createElement("ul");
      listaRecebidos.style.listStyle = "none";
      listaRecebidos.style.padding = "0";
      listaRecebidos.style.margin = "0";
      listaRecebidos.style.fontSize = "0.9em";

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

      painelDetalhes.appendChild(listaRecebidos);
    }

    item.appendChild(painelDetalhes);

    linhaPrincipal.addEventListener("click", () => {
      painelDetalhes.style.display = painelDetalhes.style.display === "none" ? "block" : "none";
    });

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
    item.className = "lanc-item";
    item.style.flexDirection = "column";
    item.style.alignItems = "stretch";

    const linhaPrincipal = document.createElement("div");
    linhaPrincipal.className = "lanc-item-linha";
    linhaPrincipal.style.cursor = "pointer";

    const desc = document.createElement("span");
    desc.className = "lanc-desc";
    desc.style.fontWeight = "bold";
    desc.textContent = titulo;

    const valorTotal = document.createElement("span");
    valorTotal.className = `lanc-valor lanc-${tipo}`;
    const sinal = tipo === "receita" ? "+" : "−";
    valorTotal.textContent = `${sinal} ${formatCentavos(total)}`;

    linhaPrincipal.appendChild(desc);
    linhaPrincipal.appendChild(valorTotal);
    item.appendChild(linhaPrincipal);

    const painelDetalhes = document.createElement("div");
    painelDetalhes.style.display = "none";
    painelDetalhes.style.marginTop = "10px";
    painelDetalhes.style.paddingTop = "10px";
    painelDetalhes.style.borderTop = "1px solid var(--borda)";

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

      linhaDetalhe.appendChild(divPago);
      linhaDetalhe.appendChild(divPendente);
      item.appendChild(linhaDetalhe);
    }
    
    const subLista = document.createElement("ul");
    subLista.style.listStyle = "none";
    subLista.style.padding = "0";
    subLista.style.margin = "0";
    subLista.style.fontSize = "0.9em";
    painelDetalhes.appendChild(subLista);

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

    item.appendChild(painelDetalhes);

    linhaPrincipal.addEventListener("click", () => {
      painelDetalhes.style.display = painelDetalhes.style.display === "none" ? "block" : "none";
    });

    return item;
  }

  async function carregar() {
    const meuPedido = ++pedidoAtual;
    
    try {
      if (rotulo) rotulo.textContent = formatarMes(mesSelecionado);
      
      if (listaReceitas) listaReceitas.innerHTML = "<li>Carregando...</li>";
      if (listaFaturas) listaFaturas.innerHTML = "<li>Carregando...</li>";
      if (listaDespesasVista) listaDespesasVista.innerHTML = "<li>Carregando...</li>";

      if (elTotalReceitas) elTotalReceitas.textContent = "—";
      if (elTotalDespesas) elTotalDespesas.textContent = "—";
      if (elSaldo) elSaldo.textContent = "—";

      let [lancamentosCompetencia, lancamentosDesembolso, recebiveisDoMes, cartoes, recorrencias] = await Promise.all([
        lerLancamentosDoMes(mesSelecionado),
        lerLancamentosPorMesDesembolso(mesSelecionado),
        lerRecebiveisPorMesEsperado(mesSelecionado),
        lerCartoes(),
        lerRecorrencias()
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

      const totalDesembolsos = totalGeralFaturas + totalGeralVista;
      const saldoFinal = totalGeralReceitas - totalDesembolsos;

      if (elTotalReceitas) elTotalReceitas.textContent = formatCentavos(totalGeralReceitas);
      if (elTotalDespesas) elTotalDespesas.textContent = formatCentavos(totalDesembolsos);
      if (elSaldo) {
        elSaldo.textContent = formatCentavos(saldoFinal);
        elSaldo.className = "mes-resumo-valor"; 
        if (saldoFinal < 0) elSaldo.classList.add("lanc-despesa");
        if (saldoFinal > 0) elSaldo.classList.add("lanc-receita");
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

  carregar();
  

  return {
    recarregarCategorias(novaListaCategorias) {
      categoriasCache = novaListaCategorias || [];
      carregar();
    },
    recarregar: carregar
  };
}