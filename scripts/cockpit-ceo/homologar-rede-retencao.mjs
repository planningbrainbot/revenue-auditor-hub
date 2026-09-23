// Homologação de coortes de retenção e da rede por unidade com dado real (somente leitura).
//
// Mesmas leituras dos servidores (JWT de super admin simulado, transação só de leitura), mesmos
// construtores (coortes.ts, receita-fontes.ts, rede.ts) e conferência com SQL independente:
//   · coortes: denominador por mês de ganho e churn datado acumulado por mês, com as mesmas regras
//     de universo (vendas, unidade regional, primeiro ganho por negócio);
//   · rede: faturamento e royalties + CSC por unidade na janela de meses completos.
// O arquivo guarda só agregados; unidades aparecem pela posição, sem nome.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node scripts/cockpit-ceo/homologar-rede-retencao.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";
import { montarCoortes } from "../../src/lib/cockpit-ceo/coortes.ts";
import { montarLeituraRede } from "../../src/lib/cockpit-ceo/receita-fontes.ts";
import { resumirLeitura } from "../../src/lib/cockpit-ceo/receita.ts";
import { resumirRedeUnidades } from "../../src/lib/cockpit-ceo/rede.ts";
import { hoje as hojeSP } from "../../src/lib/monetizacao/model.ts";

const SAIDA = "docs/dev_notes/cockpit-ceo-piloto/homologacao";
const ro = { transacaoSomenteLeitura: true };
const hoje = hojeSP();
const [adm] = await consultar(
  `select user_id::text id from ops.user_roles where role='admin' order by user_id limit 1`,
  ro,
);
if (!/^[0-9a-f-]{36}$/.test(adm.id)) throw new Error("id fora do formato");
const comoAdmin = `set local role authenticated; set local statement_timeout = '8s';
  set local request.jwt.claims to '${JSON.stringify({ sub: adm.id, role: "authenticated" })}';`;

// ── Coortes ──────────────────────────────────────────────────────────────
const [contratos, churns, regionais] = await Promise.all([
  consultar(
    `${comoAdmin} select pipedrive_deal_id, ganho_em, unidade, origem_pipeline from ops.contratos where pipedrive_deal_id is not null`,
    ro,
  ),
  consultar(
    `${comoAdmin} select pipedrive_deal_id, data_churn from ops.central_tratativas where status = 'lost'`,
    ro,
  ),
  consultar(`${comoAdmin} select nome_da_praca from ops.unidades where tipo = 'regional'`, ro),
]);
const coortes = montarCoortes({
  contratos: contratos.map((c) => ({
    deal: String(c.pipedrive_deal_id),
    ganho_em: String(c.ganho_em ?? ""),
    unidade: c.unidade,
    origem: c.origem_pipeline,
  })),
  churns: churns
    .filter((c) => c.pipedrive_deal_id !== null)
    .map((c) => ({ deal: String(c.pipedrive_deal_id), data_churn: c.data_churn })),
  regionais: regionais.map((u) => u.nome_da_praca),
  hoje,
});

const sqlCoortes = await consultar(
  `with universo as (
     select c.pipedrive_deal_id deal, min(c.ganho_em) ganho
       from ops.contratos c join ops.unidades u on u.nome_da_praca = c.unidade and u.tipo = 'regional'
      where c.pipedrive_deal_id is not null and c.origem_pipeline = 'inside_sales'
      group by 1),
   churn as (
     select pipedrive_deal_id::text deal, min(data_churn) data
       from ops.central_tratativas where status = 'lost' and data_churn is not null group by 1),
   sem_data as (
     select distinct pipedrive_deal_id::text deal from ops.central_tratativas t
      where status = 'lost' and data_churn is null
        and not exists (select 1 from ops.central_tratativas x
                         where x.pipedrive_deal_id = t.pipedrive_deal_id and x.status = 'lost' and x.data_churn is not null))
   select to_char(u.ganho, 'YYYY-MM') coorte, count(*)::int denominador,
          coalesce(jsonb_agg(to_char(greatest(date_trunc('month', ch.data), date_trunc('month', u.ganho)), 'YYYY-MM'))
                   filter (where ch.data is not null), '[]') saidas,
          count(*) filter (where u.deal in (select deal from sem_data))::int sem_data
     from universo u left join churn ch on ch.deal = u.deal
    where u.ganho <= current_date
    group by 1 order by 1`,
  ro,
);
const somaMeses = (m, n) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 7);
const divergencias = [];
for (const l of coortes.linhas) {
  const s = sqlCoortes.find((x) => x.coorte === l.mes);
  if (!s || s.denominador !== l.denominador) {
    divergencias.push({
      coorte: l.mes,
      campo: "denominador",
      cockpit: l.denominador,
      sql: s?.denominador,
    });
    continue;
  }
  if (s.sem_data !== l.churnsSemData)
    divergencias.push({
      coorte: l.mes,
      campo: "sem_data",
      cockpit: l.churnsSemData,
      sql: s.sem_data,
    });
  l.retidos.forEach((r, k) => {
    if (r === null) return;
    const t = somaMeses(l.mes, k);
    const esperado = s.denominador - s.saidas.filter((m) => m <= t).length;
    if (esperado !== r) divergencias.push({ coorte: l.mes, k, cockpit: r, sql: esperado });
  });
}

// ── Rede por unidade ────────────────────────────────────────────────────
const de = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 24, 1))
  .toISOString()
  .slice(0, 10);
const [unidades, apuracoes] = await Promise.all([
  consultar(`${comoAdmin} select id, nome_da_praca, tipo, data_inauguracao from ops.unidades`, ro),
  consultar(
    `${comoAdmin} select unidade_id, mes_referencia, status, receita_base, receita_base_antiga,
       royalties_valor, csc_valor_fixo, csc_base_antiga_valor
       from ops.royalties_apuracao where mes_referencia >= '${de}'`,
    ro,
  ),
]);
const leitura = montarLeituraRede({
  acesso: true,
  unidades: unidades.map((u) => ({
    id: u.id,
    nome: u.nome_da_praca,
    tipo: u.tipo,
    inauguracao: u.data_inauguracao,
  })),
  apuracoes: apuracoes.map((a) => ({ ...a, mes: a.mes_referencia })),
});
const resumo = resumirLeitura(leitura, hoje);
const rede = resumirRedeUnidades(leitura, resumo);
const sqlRede = rede.janela
  ? await consultar(
      `select u.nome_da_praca unidade,
         -- Centavo por apuração, como a fatura (royalties_valor é gravado com 12 casas).
         sum(round(coalesce(a.receita_base,0), 2) + round(coalesce(a.receita_base_antiga,0), 2)) faturamento,
         sum(round(coalesce(a.royalties_valor,0), 2) + round(coalesce(a.csc_valor_fixo,0), 2)
             + round(coalesce(a.csc_base_antiga_valor,0), 2)) roy
       from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id and u.tipo = 'regional'
      where a.status = 'confirmado'
        and a.mes_referencia between '${rede.janela.de}-01' and '${rede.janela.ate}-01'
      group by 1`,
      ro,
    )
  : [];
const redeConfere = rede.linhas.map((l, i) => {
  const s = sqlRede.find((x) => x.unidade === l.unidade);
  return {
    posicao: i + 1,
    faturamento: l.faturamento,
    participacao: l.participacao,
    royalties_csc: l.royaltiesCsc,
    take_rate: l.takeRate,
    confere: !!s && Number(s.faturamento) === l.faturamento && Number(s.roy) === l.royaltiesCsc,
  };
});

const saida = {
  quando: new Date().toISOString(),
  hoje,
  fonte:
    "banco único Planning Brain (npknehhyyzelmrbbxvtu), somente leitura, JWT de super admin simulado",
  coortes: {
    estado: coortes.estado,
    inicio_registro_churn: coortes.inicioRegistroChurn,
    linhas: coortes.linhas,
    fora_da_origem: coortes.foraDaOrigem,
    fora_de_regional: coortes.foraDeRegional,
    churns_sem_contrato: coortes.churnsSemContrato,
    churns_antes_do_ganho: coortes.churnsAntesDoGanho,
    divergencias,
    confere: divergencias.length === 0,
  },
  rede: {
    estado: rede.estado,
    janela: rede.janela,
    unidades: redeConfere,
    top1: rede.top1,
    top3: rede.top3,
    hhi: rede.hhi,
    soma_participacoes: rede.somaParticipacoes,
    unidades_no_sql: sqlRede.length,
    confere: redeConfere.every((r) => r.confere) && sqlRede.length === rede.linhas.length,
  },
};
mkdirSync(SAIDA, { recursive: true });
const arquivo = `${SAIDA}/rede-retencao-${hoje}.json`;
writeFileSync(arquivo, JSON.stringify(saida, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      arquivo,
      coortes: {
        estado: coortes.estado,
        inicio: coortes.inicioRegistroChurn,
        linhas: coortes.linhas.map(
          (l) =>
            `${l.mes} n=${l.denominador} ${JSON.stringify(l.retidos)}${l.churnsSemData ? " semData=" + l.churnsSemData : ""}`,
        ),
        foraDaOrigem: coortes.foraDaOrigem,
        foraDeRegional: coortes.foraDeRegional,
        churnsSemContrato: coortes.churnsSemContrato,
        confere: saida.coortes.confere,
        divergencias,
      },
      rede: {
        ...saida.rede,
        unidades: redeConfere.map(
          (u) =>
            `${u.posicao}: ${u.faturamento} ${(u.participacao * 100).toFixed(1)}% roy ${u.royalties_csc} ${u.confere}`,
        ),
      },
    },
    null,
    2,
  ),
);
