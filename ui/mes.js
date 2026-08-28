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
  atualizarLancamento
} from "../db.js";
import {
  formatCentavos,
  mesDeData,
  dataHojeISO,
  somarMeses,
  projetarOcorrenciasDoMes,
  projetarOcorrenciasPorDesembolso,
  obterMesDesembolso
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

  function criarItemAgrupado(titulo, total, pago, pendente, tipo, itens) {
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
        btnAcaoGlobal.textContent = tipo === "receita" ? "Receber Tudo" : "Pagar Tudo";
        btnAcaoGlobal.className = "botao-secundario botao-pequeno";
        btnAcaoGlobal.style.marginLeft = "10px";
        
        btnAcaoGlobal.addEventListener("click", async (e) => {
          e.stopPropagation();
          btnAcaoGlobal.disabled = true;
          btnAcaoGlobal.textContent = "...";
          try {
            await Promise.all(pendentesParaBotao.map(p => atualizarLancamento(p.id, { pago: true })));
            await carregar(); 
          } catch (erro) {
            alert("Erro ao atualizar: " + erro.message);
            btnAcaoGlobal.disabled = false;
            btnAcaoGlobal.textContent = tipo === "receita" ? "Receber Tudo" : "Pagar Tudo";
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
      
      if (it.id) {
        const btnToggle = document.createElement("button");
        btnToggle.textContent = isPago ? "Desfazer" : (tipo === "receita" ? "Receber" : "Pagar");
        btnToggle.className = "botao-secundario botao-pequeno";
        btnToggle.style.marginRight = "8px";
        btnToggle.onclick = async (e) => {
          e.stopPropagation();
          btnToggle.disabled = true;
          try {
            await atualizarLancamento(it.id, { pago: !isPago });
            await carregar();
          } catch (erro) {
            alert("Erro: " + erro.message);
            btnToggle.disabled = false;
          }
        };
  
        const btnDel = document.createElement("button");
        btnDel.textContent = "🗑️";
        btnDel.className = "botao-secundario botao-pequeno";
        btnDel.onclick = async (e) => {
          e.stopPropagation();
          if(confirm(`Excluir ${descricaoItem}?`)) {
              btnDel.disabled = true;
              try {
                await excluirLancamento(it);
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
          listaReceitas.appendChild(criarItemAgrupado(obterNomeIconeCategoria(catId), dados.total, dados.pago, dados.pendente, "receita", dados.itens));
        }
      }

      if (listaFaturas) {
        listaFaturas.innerHTML = "";
        if (Object.keys(gruposFaturas).length === 0) listaFaturas.innerHTML = "<li class='lanc-item'>Nenhuma fatura de cartão.</li>";
        for (const [cartaoId, dados] of Object.entries(gruposFaturas)) {
          const nomeCartao = cartoesPorId[cartaoId]?.nome || "Cartão Excluído";
          listaFaturas.appendChild(criarItemAgrupado(`💳 Fatura: ${nomeCartao}`, dados.total, dados.pago, dados.pendente, "despesa", dados.itens));
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