// Avaliação dos modelos da conversa: Claude Sonnet 5 × Claude Opus 5.5 no percurso real (rota
// /api/cockpit-ceo/conversa, Jev real, carga real com a sessão da conta autorizada).
//
// Uso (app local com COCKPIT_IA_AVALIACAO=1):
//   SESSAO_EMAIL=… SUPABASE_*=… SUPABASE_ACCESS_TOKEN=… \
//   node scripts/cockpit-ceo/conversa-avaliar.mjs <base> [--modelos a,b] [--casos P1,P6] [--teto 5]
//
// Orçamento: ledger CUMULATIVO em docs/dev_notes/cockpit-ceo-conversa/avaliacao/ledger.jsonl. Antes
// de cada turno, soma tudo o que já foi gasto em todas as rodadas (turno sem custo informado conta
// US$ 0,25) e para se o próximo turno puder passar do teto. O teto não renova entre rodadas.
//
// Gabaritos por SQL independente, somente leitura (não pela camada testada):
//   grupo_ultimo_fechado / grupo_setembro_parcial — série do Financial Brain;
//   onboarding_30 — cards fora de Concluído/Churn há mais de 30 dias na fase;
//   rede_cur_bel_todas / _nova — apuração confirmada de Curitiba e Belém nos 3 meses fechados.
// Conversas e visões criadas pela avaliação são apagadas no fim de cada caso.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { abrirSessao, lerSSE } from "./_sessao.mjs";
import { consultar } from "./brain-ro.mjs";
import { lerNumeros } from "../../src/lib/cockpit-ceo/conversa/conferir.ts";

const args = process.argv.slice(2);
const BASE = args[0];
const opt = (n, p) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : p;
};
const MODELOS = opt("--modelos", "anthropic/claude-sonnet-5,anthropic/claude-opus-5.5").split(",");
const SO = opt("--casos", "") ? opt("--casos", "").split(",") : null;
const TETO = Number(opt("--teto", "5"));
const ESTIMATIVA = { "anthropic/claude-sonnet-5": 0.08, "anthropic/claude-opus-5.5": 0.16 };
const PASTA = new URL("../../docs/dev_notes/cockpit-ceo-conversa/avaliacao/", import.meta.url);
mkdirSync(PASTA, { recursive: true });
const LEDGER = new URL("ledger.jsonl", PASTA);
const conjunto = JSON.parse(readFileSync(new URL("perguntas.json", PASTA), "utf8"));

const gasto = () =>
  existsSync(LEDGER)
    ? readFileSync(LEDGER, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .reduce((s, r) => s + (typeof r.custoUsd === "number" ? r.custoUsd : 0.25), 0)
    : 0;

// ── Gabaritos ──
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const mes = (n) =>
  new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 10);
const serieG = await consultar(
  `select (x->>'competencia') comp, (x->>'receita')::numeric v, (x->>'parcial')::boolean parcial from jsonb_array_elements(public.fn_faturamento_mensal(p_comp_de => '${mes(-12)}', p_comp_ate => '${mes(0)}')->'serie') x`,
  { ref: "itpddzjfrgrbathcqbpo", transacaoSomenteLeitura: true },
);
const fechadosG = serieG.filter((s) => !s.parcial && s.comp < mes(0));
const onb = await consultar(
  `select count(*) n from ops.cs_onboarding_cards where fase_atual not in ('Concluído','Churn no Onboarding') and entrou_fase_atual_em < now() - interval '30 days' and floor(extract(epoch from now() - entrou_fase_atual_em)/86400) > 30`,
);
const rede = async (base, unidades = ["Curitiba", "Belém"]) =>
  (
    await consultar(`select sum(${base === "nova" ? "coalesce(a.receita_base,0)" : "coalesce(a.receita_base,0)+coalesce(a.receita_base_antiga,0)"})::numeric(14,2) v
      from ops.royalties_apuracao a join ops.unidades u on u.id=a.unidade_id
      where a.status='confirmado' and u.tipo='regional' and u.nome_da_praca in (${unidades.map((u) => `'${u}'`).join(",")})
        and a.mes_referencia between '${mes(-3)}' and '${mes(-1)}' group by u.nome_da_praca, a.mes_referencia`)
  ).map((r) => Number(r.v));
const somas = (vs) => [...vs, vs.reduce((a, b) => a + b, 0)];
const GABARITO = {
  grupo_ultimo_fechado: [Number(fechadosG.at(-1).v)],
  grupo_setembro_parcial: serieG.filter((s) => s.parcial).map((s) => Number(s.v)),
  onboarding_30: [Number(onb[0].n)],
  rede_cur_bel_todas: somas(await rede("todas")),
  rede_cur_bel_nova: somas(await rede("nova")),
  rede_cur_pat_nova: somas(await rede("nova", ["Curitiba", "Patos de Minas"])),
};
console.log("gabaritos:", JSON.stringify(GABARITO));
const citaGabarito = (texto, chave) =>
  lerNumeros(texto).some((n) =>
    GABARITO[chave].some(
      (g) => Math.abs(Math.abs(g) - Math.abs(n.valor)) <= Math.max(n.tolerancia, 0.005) + 1e-9,
    ),
  );

// ── Sessão ──
const s = await abrirSessao(process.env.SESSAO_EMAIL);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${s.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "ops" },
});

const contem = (obj, parcial) => {
  if (parcial === undefined) return true;
  if (Array.isArray(parcial))
    return (
      Array.isArray(obj) &&
      parcial.every((p) => obj.some((o) => JSON.stringify(o) === JSON.stringify(p)))
    );
  if (parcial && typeof parcial === "object")
    return (
      !!obj &&
      typeof obj === "object" &&
      Object.entries(parcial).every(([k, v]) => contem(obj[k], v))
    );
  return obj === parcial;
};

function avaliar(caso, r) {
  const e = caso.espera;
  const c = {};
  c.estado = e.estado.includes(r.estado);
  const chamadas = (r.consultas ?? []).map((x) => ({ nome: x.consulta, args: x.args }));
  const exigidas = r.estado === "ok" ? (e.consultas ?? e.consultas_se_ok ?? []) : [];
  c.metrica = exigidas.every((q) =>
    chamadas.some((ch) => q.uma_de.includes(ch.nome) && contem(ch.args, q.args_contem)),
  );
  c.visual = e.blocos ? r.estado !== "ok" || r.blocos.some((b) => e.blocos.includes(b.tipo)) : true;
  if (e.min_blocos) c.visual &&= r.blocos.length >= e.min_blocos;
  const confere = e.conferir ?? (r.estado === "ok" ? e.conferir_se_ok : undefined);
  c.numero = confere ? citaGabarito(r.conclusao, confere) : true;
  c.semInvencao = r.descartadas.filter((d) => !d.startsWith("falha")).length === 0;
  c.texto = (e.texto ?? []).every((t) => new RegExp(t, "i").test(r.conclusao));
  c.proibido = !(e.proibido ?? []).some((p) =>
    new RegExp(p, "i").test(r.conclusao + JSON.stringify(r.blocos)),
  );
  if (e.sem_reais) c.proibido &&= !/R\$/.test(r.conclusao);
  if (e.nao_citar) c.proibido &&= !citaGabarito(r.conclusao, e.nao_citar);
  if (e.visao_salva) c.estado &&= !!r.visaoSalva;
  return c;
}

const resultados = [];
parar: for (const modelo of MODELOS)
  for (const caso of conjunto.casos) {
    if (SO && !SO.includes(caso.id)) continue;
    let conversaId = null;
    let ultima = null;
    let custoCaso = 0;
    let latencia = 0;
    for (const [t, pergunta] of caso.turnos.entries()) {
      const ja = gasto();
      if (ja + (ESTIMATIVA[modelo] ?? 0.2) > TETO) {
        console.log(
          `Teto de US$ ${TETO} alcançado (gasto acumulado US$ ${ja.toFixed(4)}). Parando.`,
        );
        break parar;
      }
      const t0 = Date.now();
      const resp = await fetch(`${BASE}/api/cockpit-ceo/conversa`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ conversaId, pergunta, modelo }),
      });
      if (resp.status !== 200) {
        ultima = {
          estado: "http_" + resp.status,
          conclusao: await resp.text(),
          blocos: [],
          descartadas: [],
        };
        break;
      }
      const partes = await lerSSE(resp);
      conversaId ??=
        partes.find((p) => p.type === "data-estado" && p.data?.etapa === "conversa")?.data
          ?.detalhe ?? null;
      ultima = partes.find((p) => p.type === "data-resposta")?.data ?? {
        estado: "sem_resposta",
        conclusao: "",
        blocos: [],
        descartadas: [],
      };
      latencia += Date.now() - t0;
      custoCaso += ultima.custoUsd ?? 0;
      appendFileSync(
        LEDGER,
        JSON.stringify({
          em: new Date().toISOString(),
          modelo,
          caso: caso.id,
          turno: t,
          estado: ultima.estado,
          custoUsd: ultima.custoUsd ?? (ultima.tentativas ? null : 0),
          latenciaMs: ultima.latenciaMs,
        }) + "\n",
      );
    }
    if (!ultima) continue;
    const criterios = avaliar(caso, ultima);
    const linha = {
      modelo,
      caso: caso.id,
      categoria: caso.categoria,
      estado: ultima.estado,
      criterios,
      aprovado: Object.values(criterios).every(Boolean),
      conclusao: ultima.conclusao,
      blocos: (ultima.blocos ?? []).map((b) => `${b.tipo}:${b.resultado.consulta}`),
      descartadas: ultima.descartadas,
      jev: ultima.jev,
      latenciaMs: latencia,
      custoUsd: Math.round(custoCaso * 1e6) / 1e6,
    };
    resultados.push(linha);
    console.log(
      `${linha.aprovado ? "ok   " : "FALHA"} ${modelo.split("/")[1]} ${caso.id} ${ultima.estado} ${(latencia / 1000).toFixed(1)}s US$${linha.custoUsd} ${JSON.stringify(criterios)}`,
    );
    if (conversaId) await db.from("cockpit_conversas").delete().eq("id", conversaId);
    if (ultima.visaoSalva?.id)
      await db.from("cockpit_visoes").delete().eq("id", ultima.visaoSalva.id);
  }

const porModelo = Object.fromEntries(
  MODELOS.map((m) => {
    const rs = resultados.filter((r) => r.modelo === m);
    const lat = rs.map((r) => r.latenciaMs).sort((a, b) => a - b);
    const crit = (k) => rs.filter((r) => r.criterios[k]).length;
    return [
      m,
      {
        casos: rs.length,
        aprovados: rs.filter((r) => r.aprovado).length,
        estado: crit("estado"),
        metrica: crit("metrica"),
        visual: crit("visual"),
        numero: crit("numero"),
        semInvencao: crit("semInvencao"),
        texto: crit("texto"),
        proibido: crit("proibido"),
        latenciaMedianaS: lat.length ? lat[Math.floor(lat.length / 2)] / 1000 : null,
        latenciaP90S: lat.length ? lat[Math.floor(lat.length * 0.9)] / 1000 : null,
        custoTotalUsd: Math.round(rs.reduce((s, r) => s + r.custoUsd, 0) * 1e4) / 1e4,
        custoMedioUsd: rs.length
          ? Math.round((rs.reduce((s, r) => s + r.custoUsd, 0) / rs.length) * 1e4) / 1e4
          : null,
      },
    ];
  }),
);
const arq = new URL(
  `resultado-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`,
  PASTA,
);
writeFileSync(
  arq,
  JSON.stringify(
    {
      em: new Date().toISOString(),
      teto: TETO,
      gastoAcumuladoUsd: gasto(),
      gabaritos: GABARITO,
      porModelo,
      resultados,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ porModelo, gastoAcumuladoUsd: gasto() }, null, 2));
