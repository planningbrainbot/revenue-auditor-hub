import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PORTFOLIO_FILTERS as empty,
  estadoProduto,
  filtrarCarteira,
  origemBase,
  potencialConsultoria,
  situacaoInicialProduto,
} from "../src/lib/monetizacao/portfolio.ts";
import {
  faturamentoDeclarado,
  oferta,
  rotuloSituacaoReceita,
  tetoContradizFaixa,
} from "../src/lib/monetizacao/model.ts";
const account = (key, changes = {}) => ({
  key,
  name: key,
  orgs: [],
  regime: "Lucro Presumido",
  band: "R$ 10 milhões até R$ 25 milhões",
  segment: "Indústria",
  contact: true,
  pipedrive_contract: true,
  new_commercial: true,
  old_base: false,
  base_origin: { status: "nova" },
  ...changes,
});
const old = account("antiga", {
  old_base: true,
  new_commercial: false,
  band: null,
  contact: false,
  pipedrive_contract: false,
  segment: null,
  base_origin: { status: "antiga" },
  consultoria_origin: { status: "retroativa" },
});
const fin = account("finance", { orgs: [10] });
const cella = account("cella", { band: "R$ 25 milhões até R$ 50 milhões" });
const missing = account("pendente", {
  regime: null,
  band: null,
  base_origin: { status: "confirmar" },
});
const accounts = [old, fin, cella, missing];
const data = {
  cards: [],
  reservations: [],
  units: [{ key: "u1", account_keys: ["antiga", "finance"] }],
};
const keys = (filters, rows = accounts, d = data) =>
  filtrarCarteira(rows, { ...empty, ...filters }, d)
    .map((a) => a.key)
    .sort();

test("Selecionar produto filtra mesmo sem situação; Consultoria não inclui fechamento comercial", () => {
  assert.deepEqual(keys({ product: "finance" }), ["finance"]);
  assert.deepEqual(keys({ product: "cella" }), ["cella"]);
  assert.deepEqual(keys({ product: "consultoria" }), ["antiga"]);
  assert.deepEqual(keys({ product: "consultoria", status: ["excluded"] }), [
    "cella",
    "finance",
    "pendente",
  ]);
  assert.deepEqual(keys({ product: "finance", status: ["review"] }), ["pendente"]);
});
test("Origem, unidade, contato, regime, segmento e faixa combinam por interseção", () => {
  assert.deepEqual(
    keys({
      unit: ["u1"],
      origin: ["antiga"],
      contact: ["false"],
      band: ["unknown"],
      segment: ["unknown"],
      regime: ["Lucro Presumido"],
    }),
    ["antiga"],
  );
  assert.deepEqual(keys({ origin: ["nova"], band: ["25"] }), ["cella"]);
  assert.deepEqual(keys({ band: ["exact:R$ 10 milhões até R$ 25 milhões"], query: " FINANCE " }), [
    "finance",
  ]);
  assert.deepEqual(keys({ regime: ["unknown"] }), ["pendente"]);
  assert.deepEqual(keys({ origin: ["divergente"] }), []);
  assert.equal(
    origemBase(account("sem_origem", { base_origin: undefined, new_commercial: false })),
    "confirmar",
  );
});
test("Disponibilidade por produto não confunde reserva de outra oferta", () => {
  const d = {
    ...data,
    reservations: [
      { account_key: "finance", product: "finance", status: "sending", deal_id: null },
    ],
  };
  assert.deepEqual(keys({ product: "finance", status: ["free"] }, accounts, d), []);
  assert.deepEqual(keys({ product: "finance", status: ["occupied"] }, accounts, d), ["finance"]);
  const other = {
    ...data,
    reservations: [
      { account_key: "finance", product: "consultoria", status: "sending", deal_id: null },
    ],
  };
  assert.deepEqual(keys({ product: "finance", status: ["free"] }, accounts, other), ["finance"]);
});
test("Sobreposição preserva a oferta selecionada e não soma contas", () => {
  const both = {
    ...old,
    key: "ambas",
    pipedrive_contract: true,
    band: "R$ 10 milhões até R$ 25 milhões",
  };
  assert.deepEqual(keys({ product: "finance", overlap: true }, [...accounts, both]), ["ambas"]);
  assert.deepEqual(keys({ product: "consultoria", overlap: true }, [...accounts, both]), ["ambas"]);
});

test("Origem atual divergente ou nova não conserva uma aprovação retroativa antiga", () => {
  for (const status of ["nova", "divergente", "confirmar"]) {
    assert.deepEqual(keys({ product: "consultoria" }, [{ ...old, base_origin: { status } }]), []);
  }
});

test("Consultoria abre a carteira retroativa pendente sem tratá-la como apta para envio", () => {
  const pending = { ...old, key: "sem-regime", regime: null };
  const simples = { ...old, key: "simples", regime: "Simples Nacional" };
  const conflict = { ...old, key: "origem-divergente", base_origin: { status: "divergente" } };
  const rows = [...accounts, pending, simples, conflict];
  assert.equal(situacaoInicialProduto("consultoria"), "potential");
  assert.equal(situacaoInicialProduto("finance"), "eligible");
  assert.deepEqual(keys({ product: "consultoria" }, rows), ["antiga", "sem-regime"]);
  assert.deepEqual(keys({ product: "consultoria", status: ["eligible"] }, rows), ["antiga"]);
  assert.deepEqual(keys({ product: "consultoria", status: ["free"] }, rows), ["antiga"]);
  assert.equal(potencialConsultoria(pending), true);
  assert.equal(oferta(pending, "consultoria").status, "revisar");
  assert.equal(potencialConsultoria(simples), false);
  assert.equal(potencialConsultoria(conflict), false);
  assert.deepEqual(keys({ product: "consultoria", unit: ["u1"] }, rows), ["antiga"]);
});

test("Estimativa de grupo Driva filtra separadamente e não vira faixa anual comprovada", () => {
  const enriched = { ...old, driva: { group_revenue_band: "20M A 30M" } };
  assert.deepEqual(keys({ drivaBand: ["20M A 30M"] }, [enriched]), ["antiga"]);
  assert.deepEqual(keys({ drivaBand: ["50M A 100M"] }, [enriched]), []);
  assert.deepEqual(keys({ band: ["25"] }, [enriched]), []);
  assert.equal(oferta(enriched, "cella").status, "revisar");
});

test("Várias opções no mesmo filtro somam; filtros diferentes continuam em interseção", () => {
  const d = { ...data, units: [...data.units, { key: "u2", account_keys: ["cella"] }] };
  assert.deepEqual(keys({ unit: ["u1", "u2"] }, accounts, d), ["antiga", "cella", "finance"]);
  assert.deepEqual(keys({ origin: ["antiga", "confirmar"] }), ["antiga", "pendente"]);
  assert.deepEqual(keys({ band: ["25", "unknown"] }), ["antiga", "cella", "pendente"]);
  assert.deepEqual(keys({ origin: ["antiga", "confirmar"], band: ["25"] }), []);
  assert.deepEqual(keys({ regime: ["unknown", "Lucro Presumido"] }), [
    "antiga",
    "cella",
    "finance",
    "pendente",
  ]);
  assert.deepEqual(keys({ contact: ["true", "false"] }), keys({}));
  assert.deepEqual(keys({ product: "finance", status: ["review", "eligible"] }), [
    "finance",
    "pendente",
  ]);
});

test("Abordagem por produto: nunca, negócio aberto, envio sem card, encerrado e lista", () => {
  const deal = (id, org, route, status, extra = {}) => ({
    id,
    org_id: org,
    route,
    status,
    stage: "Entrada",
    owner: "Matheus",
    url: "https://planning.pipedrive.com/deal/" + id,
    events: { loaded: [] },
    created_at: "2026-08-01",
    ...extra,
  });
  const d = {
    ...data,
    cards: [
      deal(1, 10, "finance", "open"),
      deal(2, 20, "finance", "lost", { updated_at: "2026-07-10", lost_reason: "Sem interesse" }),
      deal(3, 20, "cella", "open"),
    ],
    reservations: [{ account_key: "enviada", product: "finance", status: "sent", deal_id: 99 }],
    lists: [
      {
        id: "l1",
        nome: "Belém · Finance",
        status: "draft",
        items: [{ account_key: "listada", product: "finance", status: "validated" }],
      },
      {
        id: "l2",
        nome: "Antiga",
        status: "sent",
        items: [{ account_key: "listada", product: "finance", status: "sent" }],
      },
    ],
  };
  const aberta = { ...fin, key: "aberta", name: "aberta", orgs: [10] };
  const perdida = { ...fin, key: "perdida", name: "perdida", orgs: [20] };
  const enviada = { ...fin, key: "enviada", name: "enviada", orgs: [30] };
  const listada = { ...fin, key: "listada", name: "listada", orgs: [40] };
  const nunca = { ...fin, key: "nunca", name: "nunca", orgs: [50] };
  const e = (a) => estadoProduto(a, "finance", d);
  assert.deepEqual(e(aberta).abordagem, ["aberta"]);
  assert.equal(e(aberta).aberto.id, 1);
  assert.equal(e(aberta).situacao, "occupied");
  assert.deepEqual(e(perdida).abordagem, ["encerrada"]);
  assert.equal(e(perdida).encerrado.lost_reason, "Sem interesse");
  assert.equal(
    e(perdida).situacao,
    "free",
    "negócio perdido é histórico, não bloqueia nova oferta",
  );
  assert.deepEqual(e(enviada).abordagem, ["enviada"]);
  assert.equal(e(enviada).situacao, "occupied");
  assert.deepEqual(e(listada).abordagem, ["lista"]);
  assert.equal(e(listada).listas.length, 1, "item já enviado não conta como lista pendente");
  assert.equal(e(listada).listas[0].validada, true);
  assert.deepEqual(e(nunca).abordagem, ["nunca"]);
  const rows = [aberta, perdida, enviada, listada, nunca];
  const k = (f) =>
    filtrarCarteira(rows, { ...empty, product: "finance", status: ["eligible"], ...f }, d)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(k({ approach: ["nunca"] }), ["nunca"]);
  assert.deepEqual(k({ approach: ["aberta", "enviada"] }), ["aberta", "enviada"]);
  assert.deepEqual(k({ approach: ["encerrada", "lista"] }), ["listada", "perdida"]);
  assert.deepEqual(
    filtrarCarteira(rows, { ...empty, product: "finance", status: ["eligible"] }, d).map(
      (a) => a.key,
    ),
    ["listada", "nunca", "perdida", "aberta", "enviada"],
    "prontas para enviar primeiro",
  );
});

test("A confirmar da Consultoria é a base retroativa pendente, não toda pendência de origem", () => {
  const pending = { ...old, key: "sem-regime", regime: null };
  const origem = { ...old, key: "origem-pendente", base_origin: { status: "confirmar" } };
  const rows = [old, pending, origem];
  assert.deepEqual(keys({ product: "consultoria", status: ["qualificar"] }, rows), ["sem-regime"]);
  assert.deepEqual(keys({ product: "consultoria", status: ["review"] }, rows), [
    "origem-pendente",
    "sem-regime",
  ]);
  assert.equal(estadoProduto(origem, "consultoria", data).situacao, "review");
  assert.equal(estadoProduto(pending, "consultoria", data).situacao, "qualificar");
  assert.equal(estadoProduto(old, "consultoria", data).situacao, "free");
});

test("Reserva com negócio já sincronizado conta pelo negócio; envio incerto e negócio sem produto têm estado próprio", () => {
  const deal = (id, org, route, status, extra = {}) => ({
    id,
    org_id: org,
    route,
    status,
    stage: "Negociação",
    owner: "Matheus",
    url: "https://planning.pipedrive.com/deal/" + id,
    events: { loaded: [] },
    created_at: "2026-01-01",
    ...extra,
  });
  const d = {
    ...data,
    cards: [
      deal(77, 10, "finance", "won", { won_on: "2026-03-10", updated_at: "2026-09-12 01:30:00" }),
      deal(78, 10, "finance", "lost", { updated_at: "2026-05-01 10:00:00" }),
      deal(90, 30, "sem_produto", "open"),
    ],
    reservations: [
      { account_key: "ganha", product: "finance", status: "sent", deal_id: 77 },
      { account_key: "incerta", product: "finance", status: "uncertain", deal_id: null },
    ],
    lists: [],
  };
  const ganha = { ...fin, key: "ganha", name: "ganha", orgs: [10] };
  const incerta = { ...fin, key: "incerta", name: "incerta", orgs: [20] };
  const semProduto = { ...fin, key: "sem-produto", name: "sem-produto", orgs: [30] };
  const e = (a) => estadoProduto(a, "finance", d);
  assert.deepEqual(e(ganha).abordagem, ["encerrada"], "negócio sincronizado não vira 'enviada'");
  assert.equal(e(ganha).envio, null);
  assert.equal(
    e(ganha).encerrado.id,
    78,
    "fechamento mais recente pela data do ganho (won_on de março), não pela última edição (setembro)",
  );
  assert.equal(e(ganha).situacao, "occupied", "disponibilidade segue a reserva, como no servidor");
  assert.deepEqual(e(incerta).abordagem, ["enviada"]);
  assert.equal(e(incerta).envio, "incerto");
  assert.deepEqual(e(semProduto).abordagem, ["sem_produto"]);
  assert.equal(e(semProduto).semProduto.id, 90);
  assert.equal(
    e(semProduto).situacao,
    "free",
    "negócio sem produto não muda a regra de disponibilidade",
  );
  const k = (approach) =>
    filtrarCarteira(
      [ganha, incerta, semProduto],
      { ...empty, product: "finance", status: ["todas"], approach },
      d,
    )
      .map((a) => a.key)
      .sort();
  assert.deepEqual(k(["nunca"]), []);
  assert.deepEqual(k(["enviada"]), ["incerta"]);
  assert.deepEqual(k(["sem_produto"]), ["sem-produto"]);
});

test("Cache do estado é por objeto de conta: contas diferentes com a mesma chave não se misturam", () => {
  const a1 = { ...old, key: "mesma" };
  const a2 = { ...old, key: "mesma", base_origin: { status: "nova" } };
  assert.equal(estadoProduto(a1, "consultoria", data).perfil.status, "elegivel");
  assert.equal(estadoProduto(a2, "consultoria", data).perfil.status, "fora_regra");
  assert.equal(estadoProduto(a1, "consultoria", data), estadoProduto(a1, "consultoria", data));
});

test("Empresa não ativa na Receita sai das ofertas e vira lista à parte; porte é teto, não faixa", () => {
  const baixada = { ...cella, key: "baixada", name: "baixada", situacao_receita: "baixada" };
  const suspensa = { ...old, key: "suspensa", name: "suspensa", situacao_receita: "suspensa" };
  for (const p of ["consultoria", "cella", "finance"]) {
    assert.equal(oferta(baixada, p).status, "fora_regra");
    assert.match(oferta(baixada, p).reason, /baixada na Receita/);
  }
  assert.equal(oferta(suspensa, "consultoria").status, "fora_regra");
  assert.equal(oferta({ ...cella, situacao_receita: "ativa" }, "cella").status, "elegivel");
  const rows = [baixada, suspensa, cella, old];
  const k = (f) =>
    filtrarCarteira(rows, { ...empty, ...f }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(k({ receita: ["baixada", "suspensa"] }), ["baixada", "suspensa"]);
  assert.deepEqual(k({ receita: ["sem_consulta"] }), ["antiga", "cella"]);
  assert.deepEqual(k({ receita: ["ativa"] }), []);

  // Porte ME/EPP: teto legal resolve o corte de Finance e exclui de Cella, sem inventar faixa.
  const epp = { ...fin, key: "epp", name: "epp", band: null, faturamento_teto: 4.8 };
  assert.equal(oferta(epp, "finance").status, "elegivel");
  assert.match(oferta(epp, "finance").reason, /porte na Receita/);
  assert.equal(oferta(epp, "cella").status, "fora_regra");
  const semTeto = { ...fin, key: "sem-teto", name: "sem-teto", band: null };
  assert.equal(oferta(semTeto, "finance").status, "revisar");
  const declarada = {
    ...fin,
    key: "declarada",
    band: "R$ 25 milhões até R$ 50 milhões",
    faturamento_teto: 4.8,
  };
  assert.equal(
    oferta(declarada, "finance").status,
    "fora_regra",
    "faixa declarada prevalece sobre o teto",
  );
});

test("Situação vence review de faixa, cede a identidade divergente e volta por revisão explícita", () => {
  const baixada = { ...fin, key: "baixada", name: "baixada", situacao_receita: "baixada" };
  // O editor de lista mexe em band/regime; nenhum dos dois pode reabrir uma empresa fechada.
  assert.equal(oferta(baixada, "finance", { band: "Até R$ 500 mil" }).status, "fora_regra");
  assert.equal(oferta(baixada, "finance", { regime: "Lucro Real" }).status, "fora_regra");
  // A correção da própria situação, sim: é o caminho de volta quando a inscrição é regularizada.
  assert.equal(oferta(baixada, "finance", { situacao_receita: "ativa" }).status, "elegivel");
  assert.equal(
    oferta({ ...baixada, situacao_receita: "ativa" }, "finance", { situacao_receita: "inapta" })
      .status,
    "fora_regra",
  );
  // Identidade divergente e cadastro ausente pedem ação humana antes; a ordem é a mesma do servidor.
  assert.equal(
    oferta({ ...baixada, base: { identity_conflict: true } }, "finance").status,
    "revisar",
  );
  assert.match(
    oferta({ ...baixada, base: { source_status: "absent" } }, "finance").reason,
    /baixada na Receita/,
    "situação é definitiva; cadastro ausente vem depois",
  );
  // review.band do editor de lista também apaga o teto, como a faixa do cadastro.
  const epp = { ...fin, key: "epp", name: "epp", band: null, faturamento_teto: 4.8 };
  assert.equal(oferta(epp, "cella").status, "fora_regra");
  assert.equal(
    oferta(epp, "cella", { band: "R$ 25 milhões até R$ 50 milhões" }).status,
    "elegivel",
  );
  assert.equal(
    oferta(epp, "finance", { band: "R$ 25 milhões até R$ 50 milhões" }).status,
    "fora_regra",
  );
});

test("Filtro e ordenação enxergam o teto do porte; 'sem consulta' cobre campo ausente e nulo", () => {
  const epp = { ...fin, key: "epp", name: "epp", band: null, faturamento_teto: 4.8 };
  const me = { ...fin, key: "me", name: "me", band: null, faturamento_teto: 0.36 };
  const nada = { ...fin, key: "nada", name: "nada", band: null };
  const nulo = { ...fin, key: "nulo", name: "nulo", band: null, situacao_receita: null };
  const rows = [epp, me, nada, nulo, cella];
  const k = (f) =>
    filtrarCarteira(rows, { ...empty, ...f }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(k({ band: ["teto:4.8"] }), ["epp"]);
  assert.deepEqual(k({ band: ["teto:0.36"] }), ["me"]);
  assert.deepEqual(
    k({ band: ["unknown"] }),
    ["nada", "nulo"],
    "'nada informado' exclui quem tem teto",
  );
  assert.deepEqual(k({ band: ["25"] }), ["cella"], "teto de 4,8 não atende 'a partir de R$ 25 mi'");
  // situacao_receita ausente e explicitamente nulo caem no mesmo balde do filtro.
  assert.deepEqual(k({ receita: ["sem_consulta"] }), ["cella", "epp", "me", "nada", "nulo"]);
  // Ordenação: teto coloca a conta acima de quem não tem faturamento nenhum.
  const ordem = filtrarCarteira([nada, epp], { ...empty }, data).map((a) => a.key);
  assert.deepEqual(ordem, ["epp", "nada"]);
});

test("Faixa declarada acima do teto do porte acende conflito, sem mudar a decisão", () => {
  const conflito = {
    ...cella,
    key: "conflito",
    faturamento_teto: 4.8,
    band: "R$ 25 milhões até R$ 50 milhões",
  };
  assert.equal(oferta(conflito, "cella").status, "elegivel", "a faixa declarada segue mandando");
  assert.match(tetoContradizFaixa(conflito), /acima do teto do porte/);
  assert.equal(tetoContradizFaixa({ ...conflito, faturamento_teto: null }), null);
  assert.equal(
    tetoContradizFaixa({ ...cella, faturamento_teto: 4.8, band: "Até R$ 500 mil" }),
    null,
  );
  // Rótulo e texto de faturamento são os mesmos na tela e no CSV.
  assert.equal(
    faturamentoDeclarado({ band: null, faturamento_teto: 0.36 }),
    "Até R$ 0,36 mi · teto pelo porte (Receita)",
  );
  assert.equal(faturamentoDeclarado({ band: null }), "Declarado não informado");
  assert.equal(faturamentoDeclarado({ band: "Até R$ 500 mil" }), "Até R$ 500 mil");
  assert.equal(rotuloSituacaoReceita({ situacao_receita: "inapta" }), "Inapta na Receita");
  assert.equal(rotuloSituacaoReceita({}), null);
  assert.equal(
    rotuloSituacaoReceita({ situacao_receita: "nova_da_receita" }),
    "nova_da_receita na Receita",
  );
});
