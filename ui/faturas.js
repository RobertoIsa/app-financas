// ui/faturas.js
import { lerLancamentosDaFatura, pagarFaturaEmLote } from "../db.js";
import { mesDeData, dataHojeISO, somarMeses, formatCentavos } from "../logic.js";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatarMesAno(mesISO) {
  const [ano, mes] = mesISO.split("-").map(Number);
  return `${NOMES_MES[mes - 1]}/${ano}`;
}

export function initTelaFaturas({ cartoes, uid }) {
  const selectCartao = document.getElementById("fatura-cartao");
  const formBusca = document.getElementById("form-busca-fatura");
  const inputMes = document.getElementById("fatura-mes");
  const secaoDetalhes = document.getElementById("fatura-detalhes");
  const listaItens = document.getElementById("lista-fatura-itens");
  const totalValor = document.getElementById("fatura-total-valor");
  
  const formPagar = document.getElementById("form-pagar-fatura");
  const selectMeioPagamento = document.getElementById("fatura-meio-pagamento");
  const inputDataPagamento = document.getElementById("fatura-data-pagamento");
  const erroPagamento = document.getElementById("fatura-pagamento-erro");

  let lancamentosPendentesIds = [];
  let totalCentavos = 0;

  function popularCartoes(listaCartoes) {
    selectCartao.innerHTML = ""; 
    
    if (!listaCartoes || Object.keys(listaCartoes).length === 0) {
       const opt = document.createElement("option");
       opt.value = "";
       opt.textContent = "Nenhum cartão cadastrado";
       selectCartao.appendChild(opt);
       return;
    }

    listaCartoes.forEach(cartao => {
      const opt = document.createElement("option");
      opt.value = cartao.id;
      opt.textContent = cartao.nome;
      selectCartao.appendChild(opt);
    });
  }

  // Popula o dropdown de mês com 6 meses pra trás e 12 meses pra frente do mês atual,
  // em ordem cronológica, rotulados "Mês/Ano" (ex.: "Fevereiro/2026") — substitui o
  // <input type="month"> nativo, que era pouco prático nesta tela. O mês atual vem
  // pré-selecionado. Não muda em nada a lógica de busca/conciliação: executarBuscaFatura
  // e o submit de pagamento continuam lendo inputMes.value normalmente.
  function popularSelectMes() {
    const mesAtual = mesDeData(dataHojeISO());
    inputMes.innerHTML = "";
    for (let i = -6; i <= 12; i++) {
      const mes = somarMeses(mesAtual, i);
      const opt = document.createElement("option");
      opt.value = mes;
      opt.textContent = formatarMesAno(mes);
      if (mes === mesAtual) opt.selected = true;
      inputMes.appendChild(opt);
    }
  }

  async function executarBuscaFatura() {
    const cartaoId = selectCartao.value;
    const mes = inputMes.value; 

    if (!cartaoId || !mes) return;

    try {
      const compras = await lerLancamentosDaFatura(mes, cartaoId);

      listaItens.innerHTML = "";
      lancamentosPendentesIds = [];
      totalCentavos = 0;

      if (compras.length === 0) {
        alert("Nenhum lançamento encontrado para este cartão neste mês.");
        secaoDetalhes.hidden = true;
        return;
      }

      compras.forEach((lanc) => {
        // Blinda a verificação para aceitar true booleano ou texto
        const estaPago = lanc.pago === true || lanc.pago === "true";
        
        if (!estaPago) {
          lancamentosPendentesIds.push(lanc.id);
          totalCentavos += (lanc.valorCentavos || 0); // Soma apenas o que NÃO está pago
        }

        const li = document.createElement("li");
        li.style.padding = "10px 0";
        li.style.borderBottom = "1px solid #333";
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        
        const valorFormatado = formatCentavos(lanc.valorCentavos || 0);
        
        const statusBadge = estaPago 
          ? `<span style="background: #065f46; color: #34d399; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 10px;">Pago</span>`
          : `<span style="background: #7f1d1d; color: #fca5a5; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 10px;">Pendente</span>`;
        
        li.innerHTML = `
          <div>
            <span>${lanc.descricao}</span>
            ${statusBadge}
          </div>
          <span style="font-weight: bold; color: ${estaPago ? '#9ca3af' : '#ff6b6b'};">${valorFormatado}</span>
        `;
        listaItens.appendChild(li);
      });

      // Exibe no resumo APENAS o somatório do que ainda falta pagar
      totalValor.textContent = formatCentavos(totalCentavos);
      secaoDetalhes.hidden = false;
      
      const avisoAntigo = document.getElementById("aviso-fatura-quitada");
      if (avisoAntigo) avisoAntigo.remove();

      if (lancamentosPendentesIds.length === 0) {
        formPagar.hidden = true;
        const avisoQuitada = document.createElement("p");
        avisoQuitada.id = "aviso-fatura-quitada";
        avisoQuitada.style.color = "#34d399";
        avisoQuitada.style.marginTop = "15px";
        avisoQuitada.style.fontWeight = "bold";
        avisoQuitada.textContent = "✓ Esta fatura já está integralmente paga e conciliada.";
        formPagar.parentNode.appendChild(avisoQuitada);
      } else {
        formPagar.hidden = false;
      }

      erroPagamento.textContent = "";

    } catch (error) {
      console.error("Erro ao buscar fatura:", error);
      alert("Erro ao buscar a fatura.");
    }
  }

  formBusca.addEventListener("submit", (e) => {
    e.preventDefault();
    executarBuscaFatura();
  });

  formPagar.addEventListener("submit", async (e) => {
    e.preventDefault();
    erroPagamento.textContent = "";

    const meioPagamento = selectMeioPagamento.value;
    const dataPagamento = inputDataPagamento.value;
    const faturaMes = inputMes.value;

    if (!dataPagamento) {
      erroPagamento.textContent = "Informe a data do pagamento.";
      return;
    }

    if (lancamentosPendentesIds.length === 0) {
      erroPagamento.textContent = "Não há lançamentos pendentes para pagar.";
      return;
    }

    // Desabilita o botão para evitar clique duplo
    const btnConfirmar = document.getElementById("btn-confirmar-pagamento");
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = "Processando...";

    try {
      // Chama a função centralizada no db.js
      const resultado = await pagarFaturaEmLote(
        lancamentosPendentesIds,
        totalCentavos,
        faturaMes,
        dataPagamento,
        meioPagamento,
        uid
      );

      if (resultado && resultado.caixaAtualizado === false) {
        alert("Fatura paga e lançamentos baixados com sucesso! (Aviso: o saldo do Caixa pode não ter atualizado — confira na aba Caixa.)");
      } else {
        alert("Fatura paga e lançamentos baixados com sucesso!");
      }
      formPagar.reset();
      
      // Atualiza a tela imediatamente para refletir os status "Pago"
      await executarBuscaFatura();

    } catch (error) {
      console.error("Erro ao pagar fatura:", error);
      erroPagamento.textContent = "Erro ao registrar o pagamento. Tente novamente.";
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = "Confirmar Pagamento e Baixar Lançamentos";
    }
  });

  popularCartoes(cartoes);
  popularSelectMes();

  return {
    recarregarCartoes: popularCartoes
  };
}