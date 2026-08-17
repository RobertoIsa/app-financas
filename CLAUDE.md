# Controle Financeiro do Casal

## Objetivo

App pessoal de **controle e projeção de fluxo de caixa** do casal (Roberto e esposa),
sobre **uma única base compartilhada** (finanças da casa). Não é só um registro do
passado: o objetivo central é **previsibilidade** — parado em qualquer mês, enxergar
meses futuros e responder "quanto vou desembolsar e quanto vou receber em novembro?".
Registra qualquer movimento — receita ou despesa — em qualquer meio (dinheiro, débito,
Pix, transferência, crédito), com categoria e descrição livre. Uso principal no
**celular**, instalado como app (PWA), com sincronia automática e backup na nuvem.

### Os dois eixos de tempo (conceito central)

Todo valor é olhado por **dois eixos**, porque a data em que algo acontece raramente é
a data em que o dinheiro se move:

- **Desembolso (eixo PRINCIPAL):** quando o dinheiro efetivamente **sai/entra da conta**.
  Para crédito, é o **vencimento da fatura** (não a data da compra). Para dinheiro/débito/
  Pix/transferência, é a própria data. Responde: *"quanto vai sair da minha conta em
  novembro?"* → soma tudo que **vence/cai** em novembro. É o número que manda no app.
- **Gasto/competência (eixo secundário):** quando a compra **aconteceu** (data do fato),
  independente de quando é paga. Responde: *"quanto gastei referente a novembro?"* → visão
  de orçamento puro.

Exemplo: compra de R$300 em 3x no cartão em agosto = **um gasto de agosto** (eixo gasto),
mas **três desembolsos** nos meses em que cada fatura vence (eixo desembolso).

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
  data: "2026-08-14",         # data do fato / competência (YYYY-MM-DD)
  mes: "2026-08",             # YYYY-MM da data — eixo GASTO (indexado)
  mesDesembolso: "2026-09",   # YYYY-MM em que o dinheiro sai/cai — eixo DESEMBOLSO (indexado)
                              #   não-crédito: = mes (imediato)
                              #   crédito: = mês do VENCIMENTO da fatura (ver regra)
  valorCentavos: 4990,        # INTEIRO em centavos (R$ 49,90) — nunca float
  descricao: "iFood",         # texto livre
  categoriaId: "mercado",
  meioPagamento: "credito",   # "dinheiro"|"debito"|"pix"|"transferencia"|"credito"
  cartaoId: "-Nyyy",          # só quando meioPagamento === "credito"
  responsavel: "roberto",     # "roberto" | "esposa" | "casal" — de quem é o gasto.
                              # DIFERENTE de criadoPor: quem digitou pode não ser
                              # de quem é a despesa (ex.: você lança um gasto dela).

  # --- só para compras no crédito ---
  faturaMes: "2026-08",       # ciclo de fatura em que a compra cai (fechamento)
  vencimento: "2026-09-05",   # data em que essa fatura é paga (desembolso) — congelado
  idCompra: "ID-1723...",     # agrupa todas as parcelas da mesma compra
  parcelaAtual: 1,
  totalParcelas: 10,
  pago: false,                # baixa da fatura
  dataBaixa: null,            # "2026-10-10" quando a fatura é paga

  # --- crédito a receber (compra para terceiro) ---
  paraTerceiro: false,        # true = esta despesa é reembolsável por alguém
  devedor: null,              # ex.: "Irmão" — quem vai te pagar de volta
  idReembolso: null,          # liga a despesa aos itens em /receber que ela gerou

  # --- recorrência (contas/receitas mensais) ---
  idRecorrencia: null,        # liga as ocorrências mensais de um item recorrente

  # --- auditoria ---
  criadoPor: "{uid}",
  criadoEm: 1723650000000,
  atualizadoEm: 1723650000000
}

# Crédito a receber: espelha uma compra para terceiro. Fica FORA de /lancamentos
# enquanto pendente (não conta como receita até cair). Na baixa, vira uma receita real.
/receber/{id}: {
  idReembolso: "REEMB-1723...",  # agrupa os recebimentos esperados de uma mesma compra
  origemIdCompra: "ID-1723...",  # a compra (despesa) que gerou este crédito
  devedor: "Irmão",
  valorCentavos: 10000,          # valor deste recebimento esperado (R$ 100,00)
  parcelaAtual: 1,
  totalParcelas: 3,
  mesEsperado: "2026-09",        # YYYY-MM em que se espera receber (indexado) — editável
  status: "pendente",            # "pendente" | "recebido"
  dataRecebido: null,            # preenchido na baixa
  lancamentoReceitaId: null,     # id da receita gerada em /lancamentos na baixa
  criadoPor, criadoEm, atualizadoEm
}

# Recorrência: regra guardada UMA vez. Ocorrências futuras são projetadas virtualmente
# a partir daqui (não gravadas). Ao chegar o mês, materializa em /lancamentos (uma vez),
# com idRecorrencia apontando de volta pra esta regra.
/recorrencias/{id}: {
  descricao: "Aluguel",
  tipo: "despesa",               # "receita" | "despesa"
  valorCentavos: 200000,
  categoriaId: "moradia",
  meioPagamento: "pix",
  cartaoId: null,                # se for no crédito
  responsavel: "casal",
  diaDoMes: 5,                   # dia base da ocorrência
  inicio: "2026-08",             # primeiro mês (YYYY-MM)
  fim: null,                     # null = sem fim; ou "2027-12"
  ativo: true,
  criadoPor, criadoEm, atualizadoEm
}

/logs/erros/{id}:  { ts, uid, tela, mensagem, contexto }
/logs/acoes/{id}:  { ts, uid, acao, alvo }   # exclusões, baixas, reversões
```

### Índices necessários

```json
"lancamentos": { ".indexOn": ["mes", "mesDesembolso", "idCompra", "cartaoId", "faturaMes", "idReembolso"] }
"receber":     { ".indexOn": ["mesEsperado", "idReembolso", "origemIdCompra", "status"] }
```

Consultas **sempre** por índice, nunca escutando o nó inteiro. A lista/orçamento consulta
por `mes` (eixo gasto); a **projeção de desembolso** consulta por `mesDesembolso`; o
"A Receber" consulta `/receber` por `mesEsperado`.

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

### Vencimento e mês de desembolso (eixo principal)
A fatura fecha num mês (`faturaMes`) mas é **paga** no dia de vencimento — que pode cair
no mês seguinte. Dado o cartão (`diaFechamento` F, `diaVencimento` V) e o `faturaMes`:
- se `V > F` → vencimento no **mesmo mês** do faturaMes (fecha dia 5, paga dia 12);
- se `V <= F` → vencimento no **mês seguinte** ao faturaMes (fecha dia 29, paga dia 5).

`vencimento` (data completa) e `mesDesembolso` são gravados e **congelados** na criação.
Para não-crédito, `mesDesembolso = mes` (o dinheiro sai na hora). Este campo é o que
alimenta a pergunta principal do app: "quanto sai da conta no mês X".

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

### Crédito a receber (compra para terceiro)
Fluxo: ao lançar uma despesa, marcar **"compra para terceiro"** + `devedor`. A despesa
segue **normal** (cai na fatura, conta no orçamento e no desembolso do Roberto — decisão
do usuário: entra no orçamento dele). Em paralelo, nasce um **crédito a receber que
espelha a compra**: se a compra é 3x de R$100, gera 3 itens em `/receber` de R$100,
ligados por `idReembolso` e ao `origemIdCompra`.
- **Nº de recebimentos é editável** (o parente pode pagar num ritmo diferente do
  parcelamento do cartão): 1 vez, ou N vezes.
- **`mesEsperado`** de cada recebimento: default = mês do desembolso da parcela
  correspondente (assim a entrada esperada alinha com a saída da fatura); editável.
- **Pendente ≠ receita.** Enquanto `status = "pendente"`, o valor NÃO é receita — aparece
  só como "entrada prevista" na projeção e no painel "A Receber". Na **baixa**
  (`status = "recebido"`), gera uma receita real em `/lancamentos` (categoria
  `recebimentos_terceiros`) no mês em que o dinheiro caiu.
- Evita dinheiro fantasma: nunca infla a receita antes de o valor existir.

### Recorrência (contas e receitas mensais)
Itens que se repetem todo mês (salário, aluguel, assinaturas). **Método: regra + projeção
virtual** (NÃO gerar cópias à frente):
- A recorrência é uma **regra** guardada uma vez em `/recorrencias` (valor, categoria,
  dia, início/fim).
- Meses **futuros** são projetados **virtualmente** a partir da regra na hora de exibir —
  nada é gravado. Assim o **horizonte de projeção é escolha do usuário** (6/12/24/36 meses)
  sem pré-gerar nada, e editar o valor atualiza todas as projeções futuras na hora.
- Quando um mês **chega** (ou o usuário confirma), a ocorrência daquele mês é
  **materializada** em `/lancamentos` (uma vez), virando um lançamento real editável.
- Encerrar/editar a regra afeta só o **futuro**; ocorrências já materializadas ficam.

Isso é mais enxuto que gerar N meses à frente (método comum): sem inchaço no banco, sem
rotina de reabastecimento, sem reescrever cópias quando um valor muda.

### Projeção mês a mês (coração do "controle completo")
Para um mês M, o app calcula e mostra:
- **Saídas previstas (eixo desembolso):** Σ lançamentos com `mesDesembolso = M`
  (faturas que vencem em M + despesas imediatas de M). ← número principal.
- **Entradas previstas:** Σ receitas confirmadas de M + Σ `/receber` pendentes com
  `mesEsperado = M` (marcadas como previstas) + receitas recorrentes de M.
- **Saldo projetado** = entradas − saídas.
- Visão secundária (eixo gasto/orçamento): Σ por `mes`, por categoria, por pessoa.
Funciona para qualquer mês — passado, atual ou futuro (é o que dá a previsibilidade).

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
      ".indexOn": ["mes", "mesDesembolso", "idCompra", "cartaoId", "faturaMes", "idReembolso"]
    },
    "receber": {
      ".write": "auth != null && root.child('membros').child(auth.uid).exists()",
      ".indexOn": ["mesEsperado", "idReembolso", "origemIdCompra", "status"]
    },
    "recorrencias": {
      ".write": "auth != null && root.child('membros').child(auth.uid).exists()"
    },
    "logs":        { ".write": "auth != null && root.child('membros').child(auth.uid).exists()" }
  }
}
```

> Ao chegar na etapa de crédito a receber, **republicar** estas regras no console (elas
> adicionam o nó `/receber` e os índices `mesDesembolso`/`idReembolso`). Enquanto isso não
> acontecer, consultas por esses novos índices vão falhar pedindo `.indexOn`.

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
   meio de pagamento, data (default hoje); se crédito: cartão + nº de parcelas; se despesa:
   opção **"compra para terceiro"** + devedor + nº de recebimentos esperados.
3. **Mês (lista + seletor de mês)** — **navegador de mês** (‹ Agosto 2026 ›) com os
   lançamentos daquele mês e, no topo, os **totais do mês nos dois eixos**: desembolso
   previsto (principal) e gasto por competência (secundário), com saldo. Editar/excluir.
   É a base que dá acesso a meses futuros/passados. **Próxima a construir.**
4. **Projeção / Dashboard** — o coração do controle completo: para o mês selecionado,
   saídas previstas (desembolso), entradas previstas (receitas + recebíveis pendentes),
   **saldo projetado**; totais por categoria e **por pessoa** (Roberto/Esposa/Casal);
   idealmente uma faixa de vários meses à frente para ver a tendência.
5. **Faturas** — fatura por cartão/`faturaMes`; pagar (baixa) e desfazer.
6. **A Receber** — créditos a receber por devedor: quanto cada um deve, o que está
   pendente por mês esperado, e botão de **baixa** (marcar recebido → vira receita).
7. **Cartões** — cadastro in-app (CRUD): nome, dia de fechamento (1–31), dia de vencimento
   (1–31), titular. Editar e **desativar** (preserva histórico); excluir só sem lançamentos
   vinculados.
8. **Categorias** — catálogo (CRUD) de despesa e receita.
9. **Recorrências** — gerenciar itens mensais (salário, aluguel, assinaturas): criar,
   editar valor, encerrar (afeta futuras).
10. **Ajustes** — exportar backup, tema, gerenciar membros (admin).

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
- **Cartões cadastrados no app**, não no console. Desativar preserva histórico.
  `faturaMes` congelado no lançamento — editar fechamento não remexe fatura antiga.
- **Objetivo é projeção de fluxo de caixa**, não só registro. Dois eixos de tempo:
  **desembolso** (quando o dinheiro se move; eixo PRINCIPAL) e **gasto/competência**
  (quando a compra aconteceu; secundário). `mesDesembolso` congelado por lançamento.
- **Crédito a receber:** compra para terceiro **entra no orçamento do Roberto** (decisão
  do usuário) e gera recebíveis espelhando a compra em `/receber`. Recebível **pendente
  não é receita** — só vira receita real na baixa, no mês em que o dinheiro cai. Nº de
  recebimentos e `mesEsperado` editáveis (**default = mês de vencimento da fatura
  correspondente — confirmado**).
- **Recorrência (método regra + projeção virtual):** regra guardada uma vez em
  `/recorrencias`; meses futuros projetados **virtualmente** (horizonte **escolhido pelo
  usuário**, não fixo); mês corrente materializado em `/lancamentos`. Mais enxuto que gerar
  cópias à frente (sem inchaço, sem reabastecer, sem reescrever ao mudar valor).

---

## Estado da implementação

**Feito e validado:** login seguro (allowlist), tela de lançamento, cadastro de cartões,
campos de crédito condicionais, engine de parcelamento + ciclo de fatura (`faturaMes`,
com virada de ano validada), listagem do mês atual, regras de segurança publicadas.

**Próximos passos (nesta ordem):**
1. **Tela "Mês" (lista + seletor de mês)** com totais nos dois eixos — base de tudo.
2. **Eixo desembolso:** adicionar `vencimento`/`mesDesembolso` (congelados) aos lançamentos
   de crédito e passar a projetar por vencimento.
3. **Crédito a receber:** marcador na despesa + nó `/receber` + painel "A Receber"
   (requer republicar as regras com o nó `/receber` e os novos índices).
4. **Projeção / Dashboard** mês a mês (saídas × entradas × saldo projetado).
5. **Recorrências.**
6. **PWA + deploy no Vercel** (instalar no celular).

**Ajustes finos anotados:** rótulo "Valor da parcela" no crédito parcelado; melhorar o
campo de data (fácil esquecer de trocar o dia).
