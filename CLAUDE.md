# Controle Financeiro do Casal

## Objetivo

App pessoal de controle de gastos e receitas do dia a dia, usado por **duas pessoas**
(Roberto e esposa) sobre **uma única base compartilhada** (finanças da casa).
Registra qualquer movimento — receita ou despesa — em qualquer meio de pagamento
(dinheiro, débito, Pix, transferência, cartão de crédito), com categoria e descrição livre.
Uso principal no **celular**, instalado como app (PWA), com sincronia automática entre
os dispositivos do casal e backup na nuvem.

> Substitui o sistema atual de planilha (Google Sheets + Apps Script), preservando as
> boas ideias já validadas ali: agrupamento de parcelas por `idCompra`, desdobramento
> automático de parcelas, cascata para parcelas futuras, pagamento de fatura com
> confirmação e desfazer. **Novidade estrutural:** ciclo de fatura de verdade
> (data de fechamento), que não existia na planilha.

---

## Stack

- **Front-end:** JavaScript vanilla (sem framework), **arquivos separados** (app tem
  várias telas → mais fácil de manter que arquivo único).
- **Banco:** Firebase Realtime Database (RTDB).
- **Auth:** Firebase Authentication (login por e-mail/senha e/ou Google).
- **Hospedagem:** Vercel (redeploy automático via push na branch `main`).
- **PWA:** `manifest.json` + service worker com versionamento de cache.
- **Repositório:** GitHub privado.

### Organização de arquivos (proposta)

```
/
├── index.html            # shell + tela de lançamento (principal)
├── styles.css
├── firebase-config.js    # config pública do Firebase (não é segredo)
├── app.js                # bootstrap, roteamento entre telas, auth
├── db.js                 # camada de acesso ao RTDB (ler/gravar lançamentos)
├── logic.js              # regras: parcelamento, ciclo de fatura, cascata, baixa
├── ui/                   # telas (lançamento, lista, resumo, faturas, catálogos)
├── manifest.json
├── sw.js                 # service worker (cache versionado)
└── icons/                # icon-192.png, icon-512.png, apple-touch-icon
```

---

## Layout

- **Mobile-first.** CSS base pensado pro celular; `@media (min-width: 768px)` expande
  pro desktop. Breakpoint principal: **768px**.
- Tela de lançamento é a "home": abrir o app já pronto pra registrar um gasto em
  poucos toques.
- Desktop pode mostrar mais coisa em paralelo (lista + resumo lado a lado); mobile foca
  em uma tarefa por vez.

---

## Autenticação e acesso

- Firebase Authentication (e-mail/senha, e opcionalmente Google).
- **Acesso restrito a 2 contas** (o casal), via allowlist de UIDs num nó `/membros`.
  Só quem estiver em `/membros/{uid} = true` lê ou grava qualquer coisa.
- Os 2 UIDs são cadastrados **manualmente pelo console** do Firebase na primeira vez
  (ou por uma tela de admin protegida).

> **Trade-off consciente:** o guia geral desaconselha allowlist, mas isso vale pra apps
> de cadastro aberto. Aqui a base é *da casa* e compartilhada, então a allowlist de 2 UIDs
> é ao mesmo tempo mais simples e mais segura que "cada um vê o próprio UID".

---

## Estrutura de dados (RTDB)

Árvore JSON. Coleções **planas** com push IDs, consultadas por índice (não particionar
por mês agora — só quando/se crescer muito; ver "Arquivamento").

```
/membros/{uid}: {             # allowlist de acesso + identidade da pessoa
  nome: "Roberto",
  chave: "roberto",           # chave estável usada em lancamentos.responsavel
  ativo: true
}
# "casal" é um responsavel virtual (compartilhado), tratado na UI — não é um membro.

/categorias/{chave}: {        # o próprio slug é a chave do nó (ex.: categorias/mercado)
  nome: "Mercado",
  tipo: "despesa",            # "despesa" | "receita" | "ambos"
  icone: "🛒",
  sistema: false,             # true = oculta do seletor manual (ex.: Pagamento de Fatura)
  ativo: true
}
# lancamentos.categoriaId guarda essa chave/slug (ex.: "mercado"), não um push id.

/cartoes/{cartaoId}: {
  nome: "LATAM",
  diaFechamento: 3,           # 1..31 — vira o coração do ciclo de fatura
  diaVencimento: 10,
  titular: "Roberto",
  ativo: true
}

/lancamentos/{id}: {
  tipo: "despesa",            # "receita" | "despesa"
  data: "2026-08-14",         # data do fato (YYYY-MM-DD)
  mes: "2026-08",             # YYYY-MM — indexado, base das consultas mensais
  valorCentavos: 4990,        # INTEIRO em centavos (R$ 49,90) — nunca float
  descricao: "iFood",         # texto livre
  categoriaId: "-Nxxx",
  meioPagamento: "credito",   # "dinheiro"|"debito"|"pix"|"transferencia"|"credito"
  cartaoId: "-Nyyy",          # só quando meioPagamento === "credito"
  responsavel: "roberto",     # "roberto" | "esposa" | "casal" — de quem é o gasto.
                              # DIFERENTE de criadoPor: quem digitou pode não ser
                              # de quem é a despesa (ex.: você lança um gasto dela).

  # --- só para compras no crédito ---
  faturaMes: "2026-09",       # ciclo de fatura em que a compra cai (ver regra)
  idCompra: "ID-1723...",     # agrupa todas as parcelas da mesma compra
  parcelaAtual: 1,
  totalParcelas: 10,
  pago: false,                # baixa da fatura
  dataBaixa: null,            # "2026-10-10" quando a fatura é paga

  # --- auditoria ---
  criadoPor: "{uid}",
  criadoEm: 1723650000000,
  atualizadoEm: 1723650000000
}

/logs/erros/{id}:  { ts, uid, tela, mensagem, contexto }
/logs/acoes/{id}:  { ts, uid, acao, alvo }   # exclusões, baixas, reversões
```

### Índices necessários

```json
"lancamentos": { ".indexOn": ["mes", "idCompra", "cartaoId", "faturaMes"] }
```

O dashboard e a lista **sempre** consultam por `mes` (`orderByChild("mes").equalTo("2026-08")`)
— nunca escutam `/lancamentos` inteiro, senão baixariam a base toda.

### Por que centavos inteiros

`parseFloat("49,90")` retorna `NaN` silencioso no padrão BR e corrompe cálculo sem dar erro.
Regra: no input, trocar vírgula por ponto, converter e **multiplicar por 100 arredondando**
para guardar inteiro. Toda soma é feita em centavos; formata pra R$ só na exibição.

---

## Catálogo de categorias (seed inicial)

Tipos: `despesa`, `receita`, `ambos` (mão dupla — o tipo do lançamento resolve),
`sistema` (oculta do seletor manual).

**Despesas** (`tipo: despesa`)

| chave | nome | ícone | | chave | nome | ícone |
|---|---|---|---|---|---|---|
| moradia | Moradia | 🏠 | | agua | Água / Saneamento | 💧 |
| mercado | Mercado | 🛒 | | internet_telefone | Internet / Telefone | 📶 |
| restaurantes | Restaurantes | 🍽️ | | assinaturas | Assinaturas / Streaming | 📺 |
| saude | Saúde | 🩺 | | impostos_taxas | Impostos e Taxas | 🧾 |
| farmacia | Farmácia | 💊 | | casa_utilidades | Casa e utilidades | 🧹 |
| higiene_beleza | Higiene e Beleza | 🧴 | | vestuario | Vestuário | 👕 |
| lazer | Lazer | 🎬 | | presentes | Presentes | 🎁 |
| transporte | Transporte | 🚌 | | brinquedos | Brinquedos | 🧸 |
| carro | Carro | 🚗 | | mae | Mãe | 👩 |
| educacao | Educação | 📚 | | terceiros | Terceiros | 👥 |
| seguros | Seguros | 🛡️ | | outros | Outros | ⚪ |
| entidades | Entidades Representativas | 🏛️ | | cigarro | Cigarro | 🚬 |
| energia | Energia | ⚡ | | gas | Gás | 🔥 |

**Receitas** (`tipo: receita`)

| chave | nome | ícone |
|---|---|---|
| verbas_remuneratorias | Verbas remuneratórias | 💰 |
| recebimentos_terceiros | Recebimentos de Terceiros | 🔁 |

**Mão dupla** (`tipo: ambos`) — aparecem em receita e despesa; o tipo do lançamento define o sinal.

| chave | nome | ícone |
|---|---|---|
| investimentos | Investimentos | 📈 |
| emprestimo | Empréstimo | 🏦 |

**Sistema** (`tipo: ambos`, `sistema: true`) — não aparece no seletor manual.

| chave | nome | ícone |
|---|---|---|
| pagamento_fatura | Pagamento de Fatura | 💳 |

> `pagamento_fatura` é gerada **automaticamente** na baixa de fatura (o lançamento do Pix
> que quita o cartão). Fica fora do seletor pra não ser lançada à mão e contar o gasto 2×.

**Pares que evitam ambiguidade** (regra mental fixa):
- **Mercado** = compra de supermercado · **Restaurantes** = comer fora / delivery / lanche.
- **Carro** = manutenção, IPVA, seguro do carro · **Transporte** = Uber, ônibus, combustível.
- **Farmácia** = remédio/produtos · **Saúde** = consulta, plano, exame.

---

## Regras de negócio

### Meio de pagamento
- `dinheiro`, `debito`, `pix`, `transferencia` → movimento **imediato**, sem fatura,
  sem parcelamento. `pago = true` na hora.
- `credito` → entra no **ciclo de fatura**, pode ser parcelado, e só quita na baixa.

### Ciclo de fatura (novidade vs. planilha)
Dado o `diaFechamento` F do cartão e uma compra no dia `d`:
- se `d <= F` → cai na fatura do **mês da compra**;
- se `d > F`  → cai na fatura do **mês seguinte**.

O `faturaMes` de cada lançamento no crédito é calculado por essa regra — **não** pelo mês
da compra. (Isso corrige o agrupamento por mês-da-compra que a planilha usava.)

> **`faturaMes` é congelado.** É gravado no momento em que a compra é criada e **não**
> recalcula retroativamente. Se você editar depois o dia de fechamento do cartão, a mudança
> vale só para compras **novas** — faturas já lançadas/conferidas/pagas não se remexem.

### Parcelamento
- Só no crédito. Ao informar `totalParcelas > 1`, gera N lançamentos ligados por `idCompra`.
- Parcela `k` tem `faturaMes` = faturaMes da parcela 1 **+ (k-1) meses**.
- **Idempotente:** reeditar o total apaga as parcelas antigas daquele `idCompra` antes de recriar.

### Cascata
Editar valor/descrição/categoria de uma parcela propaga para as parcelas **futuras**
do mesmo `idCompra` (as já pagas não mudam).

### Pagamento de fatura (baixa) e desfazer
- Pagar fatura = marcar `pago = true` + `dataBaixa` em todos os lançamentos de crédito
  de um cartão num `faturaMes`, **e** gerar 1 lançamento de despesa (o pagamento em si,
  ex.: via Pix) para não contar o gasto duas vezes no fluxo de caixa.
- Desfazer reverte tudo: remove o lançamento de pagamento e limpa `pago`/`dataBaixa`.

---

## Controle de concorrência

- Estratégia geral: **last write wins**. Só o casal alimenta, sem disputa pelo mesmo
  campo → suficiente.
- **Exceção (atomicidade):** operações que tocam vários registros de uma vez —
  desdobrar parcelas, cascata, pagar/desfazer fatura — usam **update multi-caminho**
  (uma única chamada `update()` com todos os paths), pra não deixar estado intermediário
  inconsistente se a conexão cair no meio.
- Tratar explicitamente o estado `null`/ainda-não-carregado do RTDB (logo após
  reconexão ou cliques muito próximos), pra não interpretar "dado não chegou" como
  "não existe" e duplicar registro.

---

## Segurança do banco (rules)

```json
{
  "rules": {
    ".read":  "auth != null && root.child('membros').child(auth.uid).exists()",
    ".write": false,
    "categorias":  { ".write": "auth != null && root.child('membros').child(auth.uid).exists()" },
    "cartoes":     { ".write": "auth != null && root.child('membros').child(auth.uid).exists()" },
    "lancamentos": {
      ".write": "auth != null && root.child('membros').child(auth.uid).exists()",
      ".indexOn": ["mes", "idCompra", "cartaoId", "faturaMes"]
    },
    "logs":        { ".write": "auth != null && root.child('membros').child(auth.uid).exists()" }
  }
}
```

- Escrita é concedida **ramo a ramo**, nunca na raiz. `/membros` fica sem regra de
  escrita → protegida (só se altera pelo console). **Cuidado com o RTDB:** regras
  cascateiam apenas para *conceder* acesso — um `.write: false` num filho NÃO revoga
  escrita já liberada pelo pai. Por isso a raiz nega e cada ramo libera individualmente.
- Config do Firebase (`firebaseConfig`) **não é segredo** e pode ficar no client; quem
  protege é a rule, não a chave. (Não há chave de API secreta neste app; se um dia
  entrar integração externa, aí sim vai pra função serverless.)

---

## Acessibilidade e design

- Fonte de corpo mínima 16px (evita zoom automático no iOS); usar `rem`.
- Contraste WCAG AA (4.5:1 corpo, 3:1 texto grande).
- Área de toque mínima 44×44px (mobile-first).
- Todo campo com `<label>`; `aria-live` para toasts/atualizações dinâmicas.
- HTML semântico (`<button>`, `<nav>`, `<main>`, `<section>`).
- Modo claro/escuro mantendo contraste em ambos.
- Feedback visual em toda ação (salvar, excluir, baixar fatura) — herda a ideia dos
  toasts da planilha.

---

## Auditoria e logs

- `window.onerror` + try/catch nas operações críticas (gravação) → `/logs/erros`.
- Ações sensíveis (exclusão, baixa, reversão) → `/logs/acoes` (quem, o quê, quando).
- Retenção: manter só os últimos ~6 meses de log (não crescer indefinidamente no plano free).

---

## Arquivamento e ciclos de vida

- Ciclo natural do app é **mensal**. Por ora, consulta por índice `mes` já resolve
  performance sem particionar.
- Se a base crescer muito (anos de uso), migrar para `/lancamentos/{YYYY}/{id}` ou
  arquivar anos fechados num nó `/arquivo`. Decisão adiada de propósito.
- **Backup:** botão "Exportar JSON" na tela de Ajustes + rotina periódica de export do
  banco (guardar cópia fora do Firebase).

---

## Telas / Módulos

1. **Login** — e-mail/senha (e/ou Google).
2. **Lançamento rápido** (home) — tipo (receita/despesa), valor, categoria, descrição,
   meio de pagamento, data (default hoje); se crédito: cartão + nº de parcelas.
3. **Lista do mês** — lançamentos do mês, com filtro; editar/excluir.
4. **Resumo / Dashboard** — receita × despesa, saldo, totais por categoria, status das
   faturas, e **visão por pessoa** (Roberto / Esposa / Casal) com filtro.
5. **Faturas** — fatura do mês por cartão; pagar (baixa) e desfazer.
6. **Categorias** — catálogo (CRUD) de despesa e receita.
7. **Cartões** — cadastro in-app (CRUD). Formulário: nome, dia de fechamento (1–31),
   dia de vencimento (1–31), titular (Roberto/Esposa). Lista os cartões com editar e
   **desativar** (`ativo: false`) — desativar preserva o histórico de compras; excluir
   de vez só se não houver lançamentos vinculados. Cartão recém-cadastrado já aparece
   no seletor de compras no crédito.
8. **Ajustes** — exportar backup, tema, gerenciar membros (admin).

---

## Trade-offs de segurança/simplicidade aceitos

- Allowlist de 2 UIDs em vez de cadastro aberto — app é da casa, mais simples e seguro.
- Last write wins como padrão — sem multiusuário disputando o mesmo dado.
- Sem backend próprio/segredos por enquanto — nada exige chave secreta.

---

## Decisões e trade-offs registrados

- **Atribuição por pessoa:** cada lançamento tem `responsavel` (`roberto` | `esposa` |
  `casal`). Dashboard tem visão por pessoa. `responsavel` é independente de `criadoPor`.
- `casal` é um balde virtual (compartilhado), não um membro/UID.
- **Categorias:** catálogo fechado com 26 despesas, 2 receitas, 2 de mão dupla
  (Investimentos, Empréstimo) e 1 de sistema (Pagamento de Fatura, oculta). "Alimentação"
  virou "Restaurantes" (par com "Mercado"). Incluídas 4 recorrentes: Água, Internet/Telefone,
  Assinaturas/Streaming, Impostos e Taxas.
- **Cartões cadastrados no app** (tela 7), não no console. Desativar preserva histórico.
  `faturaMes` congelado no lançamento — editar fechamento não remexe fatura antiga.

---

## Pendências desta fase

Nenhuma. Arquitetura fechada — cartões são cadastrados dentro do próprio app (tela 7),
não precisam ser definidos no planejamento. Pronto para implementação.
