// Confere a régua cumulativa da Operação da Monetização contra a carga REAL do Brain, somente leitura
// (spec docs/superpowers/specs/2026-10-01-monetizacao-acompanhamento-diario.md, "O que precisa bater").
//
// Carrega a base como scripts/cockpit-ceo/carga-real.mjs (Management API do Supabase com papel de leitura), roda
// `funilCumulativo` de src/lib/monetizacao e compara com uma reimplementação independente da regra, escrita a partir
// de monetizacao/base/medir_funil_cumulativo.mjs e da versão por nome e ordem (f03_medir.mjs, 01/10). Confere:
//   - as contagens de setembro da spec (total e por produto; a fila por produto vem da reimplementação);
//   - função = reimplementação, etapa a etapa, em setembro e no mês corrente, por produto, com e sem o farmer;
//   - as contagens só descem (dos abordados para baixo), validadas ≤ realizadas, tudo inteiro.
// Sai com código 1 se alguma checagem falhar. A saída é agregada: nenhum nome de empresa.
//
//   SUPABASE_ACCESS_TOKEN=… node --experimental-strip-types scripts/monetizacao/conferir-funil-cumulativo.mjs
//
// O token vem do ambiente e nunca é gravado nem impresso.
import { carregarBaseReal } from "../cockpit-ceo/carga-real.mjs";
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { funilCumulativo, linhaDa } from "../../src/lib/monetizacao/funil-cumulativo.ts";
import {
  conexaoPorUnidade,
  estoqueERitmo,
  eventosDoDia,
  listaDeAtencao,
  marcacaoDoMes,
  diaUtilAnterior,
  fimDoMes,
  DIAS_UTEIS_ALERTA_ALTO,
} from "../../src/lib/monetizacao/acompanhamento.ts";
import { FARMER, hoje as hojeSp, uteis } from "../../src/lib/monetizacao/model.ts";

const SETEMBRO = { from: "2026-09-01", to: "2026-09-30" };
const CHAVES = [
  "fila",
  "abordagem",
  "conexao",
  "agendada",
  "realizada",
  "negociacao",
  "reuniaoProposta",
  "propostaEnviada",
  "ganho",
];
// Spec, "O que precisa bater": setembro, todos os produtos, carga real. Por produto, sem a fila.
const ESPERADO_TOTAL = [313, 155, 84, 49, 41, 36, 25, 25, 4];
const ESPERADO_PRODUTO = {
  cella: [67, 41, 30, 27, 26, 24, 24, 4],
  finance: [68, 31, 19, 14, 10, 1, 1, 0],
  consultoria: [20, 12, 0, 0, 0, 0, 0, 0],
};
const PRODUTOS = ["cella", "finance", "consultoria"];

const falhas = [];
let checagens = 0;
const checar = (ok, texto) => {
  checagens++;
  if (!ok) falhas.push(texto);
};

// ------------------------------------------------------------------ reimplementação independente (referência)
// Mesma regra, sem importar nada de src/: níveis lidos do pipe por nome e ordem; nível = etapa mais adiantada em que
// o card ficou 30 min ou mais, de onde avançou, ou em que terminou; Stand by = realizada; Gatilho = Conexão.
function referencia(cards, stages) {
  const ord = [...stages].sort((a, b) => a.order - b.order);
  const re = {
    base: /base/i,
    gatilho: /gatilho/i,
    // Nome antigo e novo (09/10/2026: "3 · Qualificação" e "5 · Realizado - Levantamento com sócio").
    conexao: /conex|qualifica/i,
    standby: /stand ?by/i,
    realizada: /reuni.*realiz|realizad.*levant/i,
  };
  const passos = ord.filter(
    (s) => !re.base.test(s.name) && !re.gatilho.test(s.name) && !re.standby.test(s.name),
  );
  const NIVEL = new Map();
  for (const s of ord) if (re.base.test(s.name)) NIVEL.set(s.id, 0);
  passos.forEach((s, i) => NIVEL.set(s.id, i + 1));
  const nivelPor = (r) => NIVEL.get(passos.find((s) => r.test(s.name))?.id);
  for (const s of ord) {
    if (re.gatilho.test(s.name)) NIVEL.set(s.id, nivelPor(re.conexao));
    if (re.standby.test(s.name)) NIVEL.set(s.id, nivelPor(re.realizada));
  }
  const GANHO = passos.length + 1;
  const UTC = (at) =>
    Date.parse(String(at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? "" : "Z"));
  const MIN30 = 30 * 60 * 1000;
  const nivel = (c, inicio, de, ate) => {
    const noMes = (m) => m.date >= de && m.date <= ate;
    const mv = (c.moves ?? [])
      .filter((m) => NIVEL.has(m.stage_id))
      .map((m, k) => ({ m, k }))
      .sort((a, b) => UTC(a.m.at) - UTC(b.m.at) || a.k - b.k)
      .map((x) => x.m);
    let max = 1;
    mv.forEach((m, i) => {
      if (!noMes(m) || UTC(m.at) < UTC(inicio)) return;
      const v = NIVEL.get(m.stage_id),
        prox = mv[i + 1];
      const ficou = !prox || UTC(prox.at) - UTC(m.at) >= MIN30 || NIVEL.get(prox.stage_id) > v;
      if (ficou && v > max) max = v;
    });
    if (c.events.signed.some(noMes)) max = GANHO;
    return max;
  };
  const naFila = (c, de, ate) => {
    const t0 = Date.parse(de + "T03:00:00Z");
    const mv = [...(c.moves ?? [])].sort((a, b) => UTC(a.at) - UTC(b.at));
    if (mv.some((m) => m.date >= de && m.date <= ate && NIVEL.get(m.stage_id) === 0)) return true;
    const antes = mv.filter((m) => UTC(m.at) < t0);
    return (
      antes.length > 0 &&
      NIVEL.get(antes.at(-1).stage_id) === 0 &&
      !(c.lost_on && c.lost_on < de) &&
      !c.events.signed.some((e) => e.date < de)
    );
  };
  return (de, ate, produto, ator) => {
    const pool = cards.filter((c) => !produto || c.route === produto);
    const fila = pool.filter((c) => naFila(c, de, ate)).length;
    const niveis = [];
    for (const c of pool) {
      const st = c.events.started.filter(
        (e) => e.date >= de && e.date <= ate && (!ator || e.actor_id === ator),
      );
      if (!st.length) continue;
      niveis.push(
        nivel(
          c,
          st.reduce((a, e) => (UTC(e.at) < UTC(a) ? e.at : a), st[0].at),
          de,
          ate,
        ),
      );
    }
    return [
      fila,
      ...Array.from({ length: GANHO }, (_, i) => niveis.filter((x) => x >= i + 1).length),
    ];
  };
}

// ------------------------------------------------------------------ carga
const t0 = performance.now();
const { base } = await carregarBaseReal();
const unidades = await consultar("select id, unidade_ids from ops.monetizacao_deals order by id");
const unidadeDe = new Map(unidades.map((r) => [Number(r.id), r.unidade_ids ?? []]));
const cards = base.cards.map((c) => ({ ...c, unidade_ids: unidadeDe.get(c.id) ?? [] }));
const stages = base.stages;
const hoje = hojeSp();
const MES = { from: hoje.slice(0, 7) + "-01", to: hoje };
console.log(
  `Carga do CRM: ${base.measured_at} · ${cards.length} cards · lida em ${Math.round((performance.now() - t0) / 1000)} s`,
);
console.log(
  "Pipe (ordem):",
  [...stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.name)
    .join(" → "),
);

const ref = referencia(cards, stages);
const contagens = (fc) => CHAVES.map((k) => linhaDa(fc, k)?.contagem ?? null);
const linha = (rotulo, v) => console.log(rotulo.padEnd(34), v.map((x) => x ?? "—").join(" → "));

function conferir(fc, rotulo) {
  const v = contagens(fc);
  checar(
    fc.regua.semNivel.length === 0,
    `${rotulo}: etapas sem nível (${fc.regua.semNivel.join(", ")})`,
  );
  checar(
    v.every((x) => x === null || Number.isInteger(x)),
    `${rotulo}: contagem não inteira (${v.join(", ")})`,
  );
  const cohort = fc.linhas.slice(1).map((l) => l.contagem);
  for (let i = 1; i < cohort.length; i++)
    checar(
      cohort[i] <= cohort[i - 1],
      `${rotulo}: ${fc.linhas[i + 1].nome} (${cohort[i]}) > ${fc.linhas[i].nome} (${cohort[i - 1]})`,
    );
  const val = linhaDa(fc, "negociacao")?.contagem,
    rea = linhaDa(fc, "realizada")?.contagem;
  checar(val <= rea, `${rotulo}: validadas (${val}) > realizadas (${rea})`);
  for (const l of fc.linhas.slice(1))
    if (l.taxa !== null && l.taxa !== undefined)
      checar(Number.isFinite(l.taxa), `${rotulo}: taxa inválida`);
  return v;
}

// ------------------------------------------------------------------ setembro, contra a spec e a referência
console.log(
  "\nSetembro (01–30/09), régua cumulativa · fila, abordados, conexão, agendada, realizada,",
);
console.log("negociação, reunião de proposta, proposta enviada, ganho");
const reguaAtual = funilCumulativo(cards, stages, { ...SETEMBRO, owner: null, product: "" }).regua;
const reordenado = reguaAtual.nivelDe.reuniaoProposta < reguaAtual.nivelDe.negociacao;
if (reordenado)
  console.log(
    "  Aviso: Reunião de proposta está antes de Em negociação no pipe. Os valores da spec para essas duas",
    "etapas assumem a ordem de 01/10 e não se aplicam; a comparação com a referência continua valendo.",
  );
const naoSeAplica = (i) =>
  reordenado && (CHAVES[i] === "negociacao" || CHAVES[i] === "reuniaoProposta");

for (const p of ["", ...PRODUTOS]) {
  const fc = funilCumulativo(cards, stages, { ...SETEMBRO, owner: null, product: p });
  const v = conferir(fc, `setembro ${p || "total"}`);
  const r = ref(SETEMBRO.from, SETEMBRO.to, p, null);
  linha(`  ${p || "total"} (função)`, v);
  linha(`  ${p || "total"} (referência)`, r);
  checar(JSON.stringify(v) === JSON.stringify(r), `setembro ${p || "total"}: função ≠ referência`);
  const esperado = p ? [r[0], ...ESPERADO_PRODUTO[p]] : ESPERADO_TOTAL;
  esperado.forEach((x, i) => {
    if (naoSeAplica(i)) return;
    checar(v[i] === x, `setembro ${p || "total"}: ${CHAVES[i]} = ${v[i]}, a spec diz ${x}`);
  });
}

// ------------------------------------------------------------------ o mês corrente e o recorte do farmer
for (const [periodo, f] of [
  ["setembro", SETEMBRO],
  [`mês corrente (${MES.from} a ${MES.to})`, MES],
]) {
  for (const ator of [null, FARMER.id]) {
    for (const p of ["", ...PRODUTOS]) {
      const fc = funilCumulativo(cards, stages, { ...f, owner: ator, product: p });
      const rotulo = `${periodo} ${p || "total"}${ator ? " · farmer" : ""}`;
      const v = conferir(fc, rotulo);
      const r = ref(f.from, f.to, p, ator);
      checar(
        JSON.stringify(v) === JSON.stringify(r),
        `${rotulo}: função ≠ referência (${v} × ${r})`,
      );
    }
  }
}

console.log("\nO que a tela mostra (filtro do farmer: o Matheus moveu o card)");
for (const [periodo, f] of [
  ["setembro", SETEMBRO],
  ["mês corrente", MES],
]) {
  const fc = funilCumulativo(cards, stages, { ...f, owner: FARMER.id, product: "" });
  linha(`  ${periodo} total`, contagens(fc));
  for (const p of PRODUTOS)
    linha(
      `  ${periodo} ${p}`,
      contagens(funilCumulativo(cards, stages, { ...f, owner: FARMER.id, product: p })),
    );
  const semFiltro = funilCumulativo(cards, stages, { ...f, owner: null, product: "" });
  const fora = semFiltro.coorte.filter((c) => !fc.coorte.some((x) => x.id === c.id));
  if (fora.length)
    console.log(
      `  ${periodo}: ${fora.length} abordados fora do recorte do farmer (saída da Base por outro usuário): cards`,
      fora.map((c) => c.id).join(", "),
    );
}

// ------------------------------------------------------------------ visão "Hoje", na mesma carga
const f = { owner: FARMER.id, product: "" };
const anterior = diaUtilAnterior(hoje);
const dia = eventosDoDia(cards, reguaAtual, hoje, f);
const ontem = eventosDoDia(cards, reguaAtual, anterior, f);
console.log(`\nVisão "Hoje" (${hoje}; entre parênteses, o dia útil anterior ${anterior}), farmer`);
for (const k of Object.keys(dia))
  console.log(`  ${k.padEnd(12)} ${dia[k]?.length ?? "—"} (${ontem[k]?.length ?? "—"})`);
const mes = marcacaoDoMes(cards, stages, f, hoje);
const pct = (x) => (x === null ? "—" : (x * 100).toFixed(1).replace(".", ",") + "%");
console.log(
  `  Mês até hoje: ${mes.abordados} abordados · Conexão ${mes.conexao} (${pct(mes.taxaConexao)}) · agendados ${mes.agendados} (levantamento ${pct(mes.taxaLevantamento)}, marcação ${pct(mes.marcacao)}) · faltam ${mes.faltam} para 50%`,
);
const porUnidade = conexaoPorUnidade(mes, base.units);
console.log(
  "  Conexão por unidade:",
  porUnidade?.map((u) => `${u.unidade} ${u.conexao.length} de ${u.abordados.length}`).join(" · "),
);
const plano = base.plans.find((p) => p.month === hoje.slice(0, 7) && p.owner_id === FARMER.id);
const estoque = estoqueERitmo(cards, reguaAtual, f, plano, mes.abordados, hoje);
console.log(
  `  Base elegível: ${estoque.base.length} · dias úteis restantes, contando hoje: ${estoque.uteisRestantes} de ${uteis(MES.from, fimDoMes(hoje.slice(0, 7)))} · meta ${estoque.meta} (${estoque.metaDoPlano ? "plano" : "120 por closer"}) · ${estoque.porDiaUtil} por dia útil · faltam ${estoque.faltamContas} contas`,
);
const atencao = listaDeAtencao(cards, reguaAtual, f, base.units, hoje);
console.log(
  `  Lista de atenção: ${atencao.length} cards · ${atencao.filter((i) => i.diasUteis >= DIAS_UTEIS_ALERTA_ALTO).length} com 10 dias úteis ou mais`,
);
checar(
  [...Object.values(dia), ...Object.values(ontem)].every(
    (x) => x === null || Number.isInteger(x.length),
  ),
  "visão Hoje: contagem não inteira",
);
checar(Number.isInteger(mes.faltam), "visão Hoje: faltam não inteiro");

console.log(
  falhas.length
    ? `\n${falhas.length} de ${checagens} checagens FALHARAM:\n- ${falhas.join("\n- ")}`
    : `\nTodas as ${checagens} checagens passaram.`,
);
process.exit(falhas.length ? 1 : 0);
