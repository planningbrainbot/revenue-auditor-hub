// Homologação da primeira fatia do Cockpit do CEO com dado real (somente leitura).
//
// Roda `montarCockpit` — o mesmo código da tela — sobre a carga real e confere cada número com uma
// conta independente em SQL: eventos por métrica e produto, receita prevista aberta, e elegibilidade
// por produto contra `ops.monetizacao_offer_issue` (a régua que o servidor usa para aceitar envio).
// Grava só agregados em docs/dev_notes/cockpit-ceo-piloto/homologacao/.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node scripts/cockpit-ceo/homologar.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";
import { carregarBaseReal } from "./carga-real.mjs";
import { montarCockpit } from "../../src/lib/cockpit-ceo/indicadores.ts";
import { resolverPeriodo } from "../../src/lib/cockpit-ceo/periodo.ts";
import { hoje as hojeSP, oferta, operacao } from "../../src/lib/monetizacao/model.ts";
import { PRODUTOS } from "../../src/lib/monetizacao/types.ts";

const SAIDA = "docs/dev_notes/cockpit-ceo-piloto/homologacao";
const RESPONSAVEL_PADRAO_OPERACAO = 28381245; // filtro com que a tela de Operação abre (dashboard.tsx)

const inicio = performance.now();
const { base, tempos, contagem } = await carregarBaseReal();
const hoje = hojeSP();
const agora = new Date().toISOString();
const fonte = {
  sintetico: false,
  hoje,
  agora,
  acessoBase: true,
  acessoNegocios: true,
  monetizacao: { estado: "ok", erro: null, dados: base },
};

const maiorUnidade = [...base.units].sort(
  (a, b) => b.account_keys.length - a.account_keys.length,
)[0];
const recortes = [
  { nome: "mes_rede", busca: { periodo: "mes" }, perimetro: "" },
  { nome: "mes_anterior_rede", busca: { periodo: "mes_anterior" }, perimetro: "" },
  { nome: "trimestre_rede", busca: { periodo: "trimestre" }, perimetro: "" },
  { nome: "mes_maior_unidade", busca: { periodo: "mes" }, perimetro: maiorUnidade.key },
];

const resumo = (i) => ({
  estado: i.estado,
  valor: i.valor,
  comparacoes: i.comparacoes.map((c) => ({
    rotulo: c.rotulo,
    referencia: c.referencia,
    estado: c.estado,
  })),
  composicao: Object.fromEntries(i.composicao.map((l) => [l.chave, l.valor])),
  dataDado: i.dataDado,
});

const resultados = {};
const tCalc = performance.now();
for (const r of recortes) {
  const periodo = resolverPeriodo(r.busca, hoje);
  const c = montarCockpit(fonte, { periodo, perimetro: r.perimetro });
  resultados[r.nome] = {
    periodo: { de: periodo.de, ate: periodo.ate },
    perimetro: c.perimetroRotulo,
    universo: c.universo,
    indicadores: Object.fromEntries(c.indicadores.map((i) => [i.id, resumo(i)])),
    decisoes: c.decisoes.map((d) => d.id),
    ameacas: c.ameacas.map((a) => a.id),
    avisos: c.avisos,
  };
}
tempos.calculo_4_recortes_ms = Math.round(performance.now() - tCalc);

// ── Conferência 1: eventos por métrica e produto, em SQL, sobre o payload dos negócios ──────────
const conferenciaEventos = {};
for (const nome of ["mes_rede", "mes_anterior_rede", "trimestre_rede"]) {
  const { de, ate } = resultados[nome].periodo;
  const linhas = await consultar(`
    select m.metrica, coalesce(d.payload->>'route','?') rota, count(distinct d.id)::int n
    from ops.monetizacao_deals d
    cross join (values ('started'),('validated'),('signed')) m(metrica)
    where exists (select 1 from jsonb_array_elements(coalesce(d.payload->'events'->m.metrica,'[]'::jsonb)) e
                  where (e->>'date') between '${de}' and '${ate}')
    group by 1,2`);
  const sql = {};
  for (const l of linhas) sql[l.metrica] = { ...(sql[l.metrica] ?? {}), [l.rota]: l.n };
  const mapa = {
    started: "leads-trabalhados",
    validated: "oportunidades-validadas",
    signed: "contratos-ganhos",
  };
  conferenciaEventos[nome] = Object.fromEntries(
    Object.entries(mapa).map(([m, id]) => {
      const ind = resultados[nome].indicadores[id];
      const porProdutoSql = sql[m] ?? {};
      const totalSql = Object.values(porProdutoSql).reduce((s, n) => s + n, 0);
      const divergencias = [...PRODUTOS, "sem_produto"].filter(
        (p) => (porProdutoSql[p] ?? 0) !== (ind.composicao["produto:" + p] ?? 0),
      );
      return [
        id,
        {
          cockpit: ind.valor,
          sql: totalSql,
          confere: ind.valor === totalSql && !divergencias.length,
          divergencias,
        },
      ];
    }),
  );
}

// ── Conferência 2: receita prevista aberta, reconstruída em SQL ──────────────────────────────
const [rec] = await consultar(`
  with abertos as (
    select payload p,
      (payload#>>'{revenue,status}') in ('ok','calculated')
      and not exists (
        select 1 from (values (payload#>'{revenue,total}'),(payload#>'{revenue,partners}'),(payload#>'{revenue,unit}')) v(x)
        where x->>'amount' is not null and coalesce(x->>'currency','') <> 'BRL') as ok
    from ops.monetizacao_deals
    where payload->>'status' = 'open' and coalesce(payload->>'validated_at','') <> '')
  select count(*) filter (where ok)::int conhecidos,
         count(*) filter (where not ok)::int faltantes,
         coalesce(sum(round(coalesce((p#>>'{revenue,total,amount}')::numeric,(p#>>'{revenue,sum}')::numeric,0)*100)) filter (where ok),0)/100 total
  from abertos`);
const indRec = resultados.mes_rede.indicadores["receita-prevista-aberta"];
const conferenciaReceita = {
  cockpit: {
    valor: indRec.valor,
    conhecidos: indRec.composicao.conhecidos,
    faltantes: indRec.composicao.faltante,
  },
  sql: { valor: Number(rec.total), conhecidos: rec.conhecidos, faltantes: rec.faltantes },
};
conferenciaReceita.confere =
  Math.abs((conferenciaReceita.cockpit.valor ?? 0) - conferenciaReceita.sql.valor) < 0.005 &&
  conferenciaReceita.cockpit.conhecidos === conferenciaReceita.sql.conhecidos &&
  conferenciaReceita.cockpit.faltantes === conferenciaReceita.sql.faltantes;

// ── Conferência 3: elegibilidade TS (oferta) × SQL (monetizacao_offer_issue), conta a conta ─────
const t3 = performance.now();
const paridade = Object.fromEntries(
  PRODUTOS.map((p) => [p, { ambos: 0, so_ts: 0, so_sql: 0, nenhum: 0 }]),
);
const porChave = new Map(base.accounts.map((a) => [a.key, a]));
const chaves = base.accounts.map((a) => a.key);
for (let i = 0; i < chaves.length; i += 500) {
  const lote = chaves.slice(i, i + 500);
  const linhas = await consultar(
    `select c.key,
       ops.monetizacao_offer_issue(c.perfil,'consultoria','{}'::jsonb) is null consultoria,
       ops.monetizacao_offer_issue(c.perfil,'finance','{}'::jsonb) is null finance,
       ops.monetizacao_offer_issue(c.perfil,'cella','{}'::jsonb) is null cella
     from ops.monetizacao_contas c where c.key = any(array[${lote.map((k) => `'${k}'`).join(",")}]::text[])`,
    { transacaoSomenteLeitura: true },
  );
  for (const l of linhas) {
    const a = porChave.get(l.key);
    for (const p of PRODUTOS) {
      const ts = oferta(a, p).status === "elegivel";
      const sql = l[p] === true;
      paridade[p][ts && sql ? "ambos" : ts ? "so_ts" : sql ? "so_sql" : "nenhum"]++;
    }
  }
}
tempos.paridade_elegibilidade_ms = Math.round(performance.now() - t3);

// ── O que a Operação mostra ao abrir (responsável padrão), para comparar com o cockpit ─────────
const { de: deMes, ate: ateMes } = resultados.mes_rede.periodo;
const opPadrao = operacao(base.cards, {
  from: deMes,
  to: ateMes,
  owner: RESPONSAVEL_PADRAO_OPERACAO,
  product: "",
});
const operacaoAoAbrir = {
  filtro: "mês corrente, responsável padrão da tela de Operação",
  leads_trabalhados: opPadrao.rows.started.length,
  oportunidades_validadas: opPadrao.rows.validated.length,
  contratos_ganhos: opPadrao.rows.signed.length,
};

tempos.total_ms = Math.round(performance.now() - inicio);
const saida = {
  quando: agora,
  hoje,
  fonte: "banco único Planning Brain (npknehhyyzelmrbbxvtu), somente leitura",
  carga: {
    ...contagem,
    negocios: base.cards.length,
    unidades: base.units.length,
    measured_at: base.measured_at,
    catalog_at: base.catalog_at,
    sync_status: base.sync_status,
    sync_error: !!base.sync_error,
  },
  recortes: resultados,
  conferencias: {
    eventos: conferenciaEventos,
    receita: conferenciaReceita,
    elegibilidade: paridade,
  },
  operacaoAoAbrir,
  tempos,
};
mkdirSync(SAIDA, { recursive: true });
const arquivo = `${SAIDA}/resultado-${hoje}.json`;
writeFileSync(arquivo, JSON.stringify(saida, null, 2) + "\n");
console.log(
  JSON.stringify(
    { arquivo, carga: saida.carga, conferencias: saida.conferencias, operacaoAoAbrir, tempos },
    null,
    2,
  ),
);
