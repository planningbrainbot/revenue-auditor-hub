// Homologação SÓ LEITURA do tema Sex · Estratégico do Cockpit do COO.
//
// 1. Reproduz no Node a carga do servidor (`lerEstrategico` + a parte da carga comum que o tema usa)
//    com a sessão do Paulo Carvalho simulada dentro de `begin transaction read only` (papel
//    `authenticated` e o `sub` dele no JWT: RLS vale como no app).
// 2. Roda `montarEstrategico` sobre essa carga (todas as unidades, rede, própria).
// 3. Confere cada número contra SQL independente, que não passa pelas funções puras do cockpit:
//    agregações diretas em ops.idu_metas / idu_metas_padrao / idu_apuracao, ops.royalties_apuracao
//    (completude do mês contada no SQL), growth.okr_snapshot, ops.clickup_tarefas e ops.unidades.
//
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/cockpit-coo/homologar-estrategico.mjs [AAAA-MM-DD]
// Só agregados por unidade e por departamento vão para a saída.
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { lerUnidades } from "../../src/lib/cockpit-coo/unidades.ts";
import { lerCompromisso } from "../../src/lib/cockpit-coo/compromissos.ts";
import {
  montarEstrategico,
  trimestreIdu,
  trimestreSeguinte,
  PESO_MINIMO_PACTO,
} from "../../src/lib/cockpit-coo/temas/estrategico.ts";

const COO = "acf379ff-3674-4545-86b7-79e0a18360eb"; // Paulo Carvalho (diretor, todas as unidades)
const hoje =
  process.argv[2] ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error("Data inválida: use AAAA-MM-DD.");

const comoCoo = (sql) =>
  consultar(
    `set local role authenticated; set local request.jwt.claims to '{"sub":"${COO}","role":"authenticated"}'; ${sql}`,
    { transacaoSomenteLeitura: true },
  );

const tri = trimestreIdu(hoje);
const prox = trimestreSeguinte(tri);
const deApuracao = new Date(
  Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - 30, 1),
)
  .toISOString()
  .slice(0, 10);
const ateApuracao = `${hoje.slice(0, 7)}-01`;

// ── 1. A carga, como o servidor lê ─────────────────────────────────────
const [cadastro, ranking, apuracaoIdu, metasCont, apuracoes, okrs, tarefas, [rodada]] =
  await Promise.all([
    comoCoo("select id, nome_da_praca, tipo, data_inauguracao::text from ops.unidades order by id"),
    comoCoo(`select * from ops.idu_ranking('${tri.inicio}', '${tri.fim}')`),
    comoCoo(
      `select unidade_id, indicador, peso, meta, meta_origem from ops.idu_apuracao('${tri.inicio}', '${tri.fim}')`,
    ),
    comoCoo(
      `select periodo_inicio::text, count(*)::int n from (
       select periodo_inicio from ops.idu_metas where periodo_inicio in ('${tri.inicio}', '${prox.inicio}')
       union all
       select periodo_inicio from ops.idu_metas_padrao where periodo_inicio in ('${tri.inicio}', '${prox.inicio}')
     ) m group by 1`,
    ),
    comoCoo(
      `select unidade_id, mes_referencia::text mes, status, receita_base, receita_base_antiga, royalties_valor,
            csc_valor_fixo, csc_base_antiga_valor
       from ops.royalties_apuracao
      where mes_referencia >= '${deApuracao}' and mes_referencia <= '${ateApuracao}' order by id`,
    ),
    comoCoo(
      "select dia::text, kr_id, departamento, objetivo, kr_nome, progresso, origem from growth.okr_snapshot where dia >= '2026-08-01' order by dia, kr_id",
    ),
    // O espelho só é legível com a área cockpit_coo (o COO ainda não tem): leitura de conferência.
    consultar(
      "select * from ops.clickup_tarefas where ausente_desde is null and pasta_nome ilike 'Rotina Semanal%' order by id",
      { transacaoSomenteLeitura: true },
    ),
    consultar(
      "select executado_em, status, total_registros from ops.sync_log where fonte = 'clickup' order by executado_em desc limit 1",
      { transacaoSomenteLeitura: true },
    ).then((r) => (r.length ? r : [null])),
  ]);

const unidades = lerUnidades(cadastro);
const contar = (inicio) =>
  metasCont.filter((m) => m.periodo_inicio === inicio).reduce((s, m) => s + m.n, 0);
const dados = {
  idu: {
    ok: true,
    dado: {
      trimestre: tri,
      ranking,
      apuracao: apuracaoIdu.map((a) => ({ ...a, unidade_id: Number(a.unidade_id) })),
      metasNoTrimestre: contar(tri.inicio),
      proximo: { trimestre: prox, metas: contar(prox.inicio) },
    },
  },
  rede: {
    ok: true,
    dado: {
      unidades: cadastro.map((u) => ({
        id: u.id,
        nome: u.nome_da_praca,
        tipo: u.tipo,
        inauguracao: u.data_inauguracao,
      })),
      apuracoes: apuracoes.map((a) => ({ ...a, unidade_id: Number(a.unidade_id) })),
    },
  },
};
const conectado =
  rodada?.status === "sucesso" && Date.now() - Date.parse(rodada.executado_em) < 60 * 60_000;
const agora = new Date().toISOString();
const extra = {
  okrs,
  compromissos: tarefas.map((l) => lerCompromisso(l, [], agora)),
  clickupConectado: conectado,
};

// ── 2. O montador ──────────────────────────────────────────────────────
const leituras = Object.fromEntries(
  ["", "rede", "propria"].map((f) => [
    f || "todas",
    montarEstrategico(dados, extra, unidades, f, hoje),
  ]),
);

// ── 3. SQL independente ────────────────────────────────────────────────
const [[pactoSql]] = await Promise.all([
  comoCoo(
    `with ap as (select * from ops.idu_apuracao('${tri.inicio}', '${tri.fim}')),
          peso as (select unidade_id, sum(peso) filter (where meta is not null) com_meta from ap group by 1),
          rk as (select * from ops.idu_ranking('${tri.inicio}', '${tri.fim}'))
     select (select count(*) from ops.unidades where tipo = 'regional' and data_inauguracao is not null)::int em_operacao,
            (select count(*) from ops.idu_metas where periodo_inicio = '${tri.inicio}')::int metas_unidade,
            (select count(*) from ops.idu_metas_padrao where periodo_inicio = '${tri.inicio}')::int metas_padrao,
            (select count(*) from ops.idu_metas where periodo_inicio = '${prox.inicio}')::int
              + (select count(*) from ops.idu_metas_padrao where periodo_inicio = '${prox.inicio}')::int metas_proximo,
            (select max(com_meta) from peso)::int maior_peso_com_meta,
            (select count(*) from peso where com_meta >= ${PESO_MINIMO_PACTO})::int cadastradas,
            (select count(*) from rk r join peso p using (unidade_id)
              where p.com_meta >= ${PESO_MINIMO_PACTO} and r.idu >= 75)::int no_pacto,
            (select count(*) from rk where idu >= 75)::int idu_75_sem_regua_de_metas`,
  ),
]);

// Faturamento: completude do mês contada no SQL (unidades inauguradas até o mês × confirmadas).
const meses = await comoCoo(
  `with u as (select id from ops.unidades where tipo = 'regional' and data_inauguracao is not null),
        m as (select generate_series(date '${deApuracao}', date '${ateApuracao}' - interval '1 month', interval '1 month')::date mes)
   select to_char(m.mes, 'YYYY-MM') mes,
          (select count(*) from ops.unidades x where x.tipo = 'regional' and x.data_inauguracao is not null
             and date_trunc('month', x.data_inauguracao) <= m.mes)::int esperadas,
          count(distinct a.unidade_id)::int confirmadas,
          coalesce(sum(coalesce(a.receita_base, 0) + coalesce(a.receita_base_antiga, 0)), 0)::numeric soma
     from m left join ops.royalties_apuracao a
       on a.mes_referencia = m.mes and a.status = 'confirmado' and a.unidade_id in (select id from u)
    group by m.mes order by m.mes`,
);
// Janela: meses completos e seguidos terminando no último fechado (sem dado ou incompleto interrompe).
const janela = [];
for (let i = meses.length - 1; i >= 0 && janela.length < 12; i--) {
  const m = meses[i];
  const completo = m.confirmadas > 0 && m.confirmadas >= m.esperadas;
  if (!completo) {
    if (janela.length === 0 && m.confirmadas > 0) continue; // mês parcial no fim: pula
    break;
  }
  janela.unshift(m);
}
const somaSql = janela.reduce((s, m) => s + Math.round(Number(m.soma) * 100), 0) / 100;
const porUnidadeSql = janela.length
  ? await comoCoo(
      `select u.nome_da_praca unidade, sum(coalesce(a.receita_base, 0) + coalesce(a.receita_base_antiga, 0))::numeric soma
         from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id
        where a.status = 'confirmado' and u.tipo = 'regional' and u.data_inauguracao is not null
          and a.mes_referencia between '${janela[0].mes}-01' and '${janela[janela.length - 1].mes}-01'
        group by 1 order by 2 desc`,
    )
  : [];
const maiorSql = porUnidadeSql.length ? Number(porUnidadeSql[0].soma) / somaSql : null;
const [implSql] = await comoCoo(
  `select count(*)::int n, string_agg(nome_da_praca, ', ' order by nome_da_praca) nomes,
          (select string_agg(distinct u.nome_da_praca, ', ') from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id
            where u.tipo = 'regional' and u.data_inauguracao is null and a.status = 'confirmado') com_apuracao
     from ops.unidades where tipo = 'regional' and data_inauguracao is null`,
);
const [okrSql] = await comoCoo(
  `with d as (select max(dia) dia from growth.okr_snapshot)
   select d.dia::text, count(*)::int krs, count(s.progresso)::int medidas, avg(s.progresso)::float media,
          ((d.dia - date '2026-08-01' + 1)::float / (date '2026-12-31' - date '2026-08-01' + 1)) esperado,
          (select count(*) from (select o.departamento from growth.okr_snapshot o where o.dia = d.dia
             group by 1 having count(progresso) = 0) z)::int deptos_sem_medicao
     from growth.okr_snapshot s, d where s.dia = d.dia group by d.dia`,
);

// ── Relatório ──────────────────────────────────────────────────────────
const L = leituras.todas;
const n = (id) => L.numeros.find((x) => x.id === id);
const um = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const linhas = [];
const conferir = (numero, cockpit, sql, ok) =>
  linhas.push({ numero, cockpit, sql, bate: ok ? "sim" : "NÃO" });

const pacto = n("unidades-no-pacto");
conferir(
  "Unidades no Pacto (estado)",
  `${pacto.estado} · ${pacto.valor ?? "—"}`,
  `cadastradas ${pactoSql.cadastradas} de ${pactoSql.em_operacao}; maior peso com meta ${pactoSql.maior_peso_com_meta}; no pacto ${pactoSql.no_pacto}`,
  pactoSql.cadastradas === 0
    ? pacto.estado === "nao_apurado" && pacto.valor === null
    : pacto.valor === pactoSql.no_pacto,
);
conferir(
  "Metas gravadas no trimestre / no próximo",
  `${dados.idu.dado.metasNoTrimestre} / ${dados.idu.dado.proximo.metas}`,
  `${pactoSql.metas_unidade + pactoSql.metas_padrao} / ${pactoSql.metas_proximo}`,
  dados.idu.dado.metasNoTrimestre === pactoSql.metas_unidade + pactoSql.metas_padrao &&
    dados.idu.dado.proximo.metas === pactoSql.metas_proximo,
);
const fat = n("faturamento-rede-12m");
conferir(
  `Faturamento da rede (${fat.rotulo})`,
  `${fat.estado} · ${fat.valor}`,
  `${janela.length} meses (${janela[0]?.mes}–${janela.at(-1)?.mes}) · ${somaSql}`,
  fat.valor === somaSql,
);
const conc = n("concentracao-rede");
conferir(
  "Peso da maior unidade",
  `${conc.estado} · ${conc.valor}% (${conc.nota})`,
  `${um(maiorSql * 100)}% (${porUnidadeSql[0]?.unidade})`,
  conc.valor === um(maiorSql * 100),
);
const okr = n("okrs-expansao");
conferir(
  "OKRs da Expansão (progresso × esperado)",
  `${okr.estado} · ${okr.valor}% × ${okr.meta?.valor}% (${okr.nota})`,
  `${um(okrSql.media * 100)}% × ${um(okrSql.esperado * 100)}% · ${okrSql.medidas} de ${okrSql.krs} · foto ${okrSql.dia}`,
  okr.valor === um(okrSql.media * 100) && okr.meta?.valor === um(okrSql.esperado * 100),
);
conferir(
  "Departamentos sem KR medida (alertas)",
  String(L.alertas.filter((a) => a.regra === "okr-sem-medicao").length),
  String(okrSql.deptos_sem_medicao),
  L.alertas.filter((a) => a.regra === "okr-sem-medicao").length === okrSql.deptos_sem_medicao,
);
const comp = n("compromissos-no-prazo");
conferir(
  "Compromissos no prazo",
  `${comp.estado} · ${comp.valor ?? "—"} (${comp.motivo ?? comp.nota})`,
  `${tarefas.length} tarefas na Rotina Semanal · última rodada ${rodada ? `${rodada.status} ${rodada.executado_em}` : "nenhuma"}`,
  conectado ? true : comp.estado === "nao_apurado",
);
const impl = n("unidades-implantacao");
conferir(
  "Unidades em implantação",
  `${impl.valor} (${impl.nota})`,
  `${implSql.n} (${implSql.nomes})`,
  impl.valor === implSql.n,
);

console.log(`Estratégico · ${hoje} · ${tri.rotulo} · ${L.universo}\n`);
console.table(linhas);
console.log("\nAlertas (todas as unidades):");
for (const a of L.alertas) console.log(`  [${a.gravidade}] ${a.titulo}  ·  ${a.chave}`);
console.log("\nAvisos:", L.avisos);
console.log("Implantação com apuração confirmada (SQL):", implSql.com_apuracao ?? "nenhuma");
console.log(
  "\nFiltro 'rede':",
  leituras.rede.numeros.map((x) => `${x.id}=${x.estado}:${x.valor ?? "—"}`).join(" · "),
);
console.log(
  "Filtro 'propria':",
  leituras.propria.numeros.map((x) => `${x.id}=${x.estado}:${x.valor ?? "—"}`).join(" · "),
);
console.log(
  "Gráficos:",
  L.graficos.map((g) => `${g.id}=${g.estado}${g.motivo ? ` (${g.motivo})` : ""}`).join(" · "),
);
if (linhas.some((l) => l.bate !== "sim")) process.exitCode = 1;
