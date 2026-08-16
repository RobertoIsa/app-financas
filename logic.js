// logic.js
// Regras de negócio puras (sem dependência do Firebase): parsing de valores em reais,
// formatação de centavos e datas. A engine de parcelamento/ciclo de fatura entra aqui
// numa próxima etapa.

// Converte texto digitado em reais (padrão BR, ex.: "1.234,56" ou "49,90") para
// centavos inteiros. Retorna NaN se o texto não for um valor válido.
export function parseValorParaCentavos(texto) {
  if (typeof texto !== "string") return NaN;
  let limpo = texto.trim();
  if (!limpo) return NaN;

  // Só remove "." como separador de milhar quando há vírgula decimal;
  // sem vírgula, tratamos "." como separador decimal (ex.: teclado numérico em inglês).
  if (limpo.includes(",")) {
    limpo = limpo.replace(/\./g, "").replace(",", ".");
  }

  const valor = parseFloat(limpo);
  if (isNaN(valor) || valor < 0) return NaN;
  return Math.round(valor * 100);
}

export function formatCentavos(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

// Data local (não UTC) no formato YYYY-MM-DD, para não sofrer o "dia anterior"
// que new Date().toISOString() causa em fusos negativos.
export function dataHojeISO() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function mesDeData(dataISO) {
  return dataISO.slice(0, 7);
}
