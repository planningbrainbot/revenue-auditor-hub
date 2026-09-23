// Homologação da trajetória para R$ 1 bi com dado real (somente leitura).
//
// Faz, com o JWT de um super admin simulado dentro de `begin transaction read only`, as mesmas
// leituras de `carregarReceitaCockpit` e passa pelos mesmos construtores (receita-fontes.ts) e pelo
// mesmo resumo (receita.ts). Depois confere cada mês com uma conta SQL independente:
//   · grupo: soma da base da DRE (1.1, sem exclusão, sem os recortes padrão e sem as categorias que
//     o Faturamento tira) contra a série de `fn_faturamento_mensal`;
//   · rede: soma de receita_base + receita_base_antiga confirmada, e os meses com unidade inaugurada
//     sem apuração, contra a leitura.
// Confere também a porta: um sócio regional sem Financeiro tem de ficar sem a leitura do grupo.
// Grava só agregados mensais: nenhum nome de cliente, de empresa ou de unidade.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node scripts/cockpit-ceo/homologar-receita.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";
import {
  extrairFaturamento,
  montarLeituraGrupo,
  montarLeituraRede,
} from "../../src/lib/cockpit-ceo/receita-fontes.ts";
import { resumirLeitura } from "../../src/lib/cockpit-ceo/receita.ts";
import { hoje as hojeSP } from "../../src/lib/monetizacao/model.ts";

const SAIDA = "docs/dev_notes/cockpit-ceo-piloto/homologacao";
const UUID = /^[0-9a-f-]{36}$/;
const hoje = hojeSP();
const de = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 24, 1))
  .toISOString()
  .slice(0, 10);
const ate = `${hoje.slice(0, 7)}-01`;
const ro = { transacaoSomenteLeitura: true };
const comoUsuario = (id) => {
  if (!UUID.test(id)) throw new Error("id de usuário fora do formato");
  const claims = JSON.stringify({ sub: id, role: "authenticated" });
  return `set local role authenticated; set local statement_timeout = '8s';
          set local request.jwt.claims to '${claims}';`;
};
const tempos = {};
const medir = async (nome, fn) => {
  const t = performance.now();
  const r = await fn();
  tempos[nome] = Math.round(performance.now() - t);
  return r;
};

const [adm] = await consultar(
  `select user_id::text id from ops.user_roles where role='admin' order by user_id limit 1`,
  ro,
);

// ── Porta, como o servidor confere ─────────────────────────────────────────
const [porta] = await consultar(
  `${comoUsuario(adm.id)}
   select public.tem_produto('financeiro') tem_financeiro,
          (select todas_empresas from ops.usuario_escopo where user_id = auth.uid()) todas_empresas,
          (select todas_unidades from ops.usuario_escopo where user_id = auth.uid()) todas_unidades,
          'cockpit_ceo' = any(array(select jsonb_array_elements_text(ops.acesso_do_usuario(auth.uid())->'areas'))) area`,
  ro,
);

// ── Grupo: a mesma chamada do servidor ────────────────────────────────────
const [fat] = await medir("faturamento_ms", () =>
  consultar(
    `${comoUsuario(adm.id)}
     select financeiro.fn_faturamento_mensal(p_comp_de => '${de}', p_comp_ate => '${ate}', p_limite_clientes => 1) j`,
    ro,
  ),
);
const grupo = montarLeituraGrupo({
  acesso: porta.tem_financeiro && porta.todas_empresas,
  faturamento: extrairFaturamento(fat.j),
});

// Conta independente: base da DRE (motor comum), agregada aqui, com as regras que o Faturamento
// aplica em cima dela (recortes padrão e categorias fora do Faturamento).
const independenteGrupo = await medir("grupo_sql_ms", () =>
  consultar(
    `with rec as (select coalesce(array_agg(id order by ordem, id), null) ids
                    from financeiro.recorte_destacavel where ativo and padrao_clientes = 'excluido')
     select to_char(b.competencia, 'YYYY-MM') mes, round(sum(b.valor), 2) valor
       from rec, financeiro.fn_dre_comp_caixa_base(null, null, null, '${de}', '${ate}', null, null, rec.ids, false) b
      where b.estrutura_dre like '1.1.%' and b.excluido_por is null
        and not exists (select 1 from financeiro.faturamento_categoria_excluida f
                         where f.excluida and unaccent(financeiro.fn_norm(f.categoria)) = unaccent(financeiro.fn_norm(b.categoria_dfc)))
        and exists (select 1 from financeiro.competencia_cobertura c where c.competencia = b.competencia)
      group by 1 order by 1`,
    ro,
  ),
);
// Para explicar a distância entre a soma crua de lançamentos e a régua do Faturamento.
const cru = await consultar(
  `select to_char(l.competencia, 'YYYY-MM') mes, round(sum(l.valor), 2) valor
     from financeiro.lancamentos l join financeiro.empresas e on e.id = l.empresa_id
    where l.estrutura_dre = '1.1. Receita Bruta de Vendas' and e.entra_no_fechamento
      and l.competencia between '${de}' and '${ate}'
    group by 1 order by 1`,
  ro,
);

// ── Rede: as mesmas leituras do servidor, com a RLS do admin ───────────────
const [unidades, apuracoes] = await medir("rede_ms", () =>
  Promise.all([
    consultar(
      `${comoUsuario(adm.id)} select id, nome_da_praca, tipo, data_inauguracao from ops.unidades`,
      ro,
    ),
    consultar(
      `${comoUsuario(adm.id)}
       select unidade_id, mes_referencia, status, receita_base, receita_base_antiga
         from ops.royalties_apuracao where mes_referencia >= '${de}' order by mes_referencia, unidade_id`,
      ro,
    ),
  ]),
);
const rede = montarLeituraRede({
  acesso: porta.todas_unidades,
  unidades: unidades.map((u) => ({
    id: u.id,
    nome: u.nome_da_praca,
    tipo: u.tipo,
    inauguracao: u.data_inauguracao,
  })),
  apuracoes: apuracoes.map((a) => ({
    unidade_id: a.unidade_id,
    mes: a.mes_referencia,
    status: a.status,
    receita_base: a.receita_base,
    receita_base_antiga: a.receita_base_antiga,
  })),
});
const independenteRede = await consultar(
  `with m as (select distinct mes_referencia mes from ops.royalties_apuracao
               where status = 'confirmado' and mes_referencia >= '${de}')
   select to_char(m.mes, 'YYYY-MM') mes,
     (select round(sum(coalesce(a.receita_base,0) + coalesce(a.receita_base_antiga,0)), 2)
        from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id and u.tipo = 'regional'
       where a.status = 'confirmado' and a.mes_referencia = m.mes) valor,
     (select count(*) from ops.unidades u
       where u.tipo = 'regional'
         and coalesce(date_trunc('month', u.data_inauguracao),
                      (select min(mes_referencia) from ops.royalties_apuracao x
                        where x.unidade_id = u.id and x.status = 'confirmado')) <= m.mes
         and not exists (select 1 from ops.royalties_apuracao x
                          where x.unidade_id = u.id and x.status = 'confirmado' and x.mes_referencia = m.mes))::int faltam
   from m order by 1`,
  ro,
);

// ── Porta do grupo para quem não tem Financeiro ───────────────────────────
const [socio] = await consultar(
  `select r.user_id::text id from ops.user_roles r where r.role = 'socio_regional'
     and not exists (select 1 from public.produto_acesso p where p.user_id = r.user_id and p.produto = 'financeiro')
   order by 1 limit 1`,
  ro,
);
let portaSocio = null;
if (socio) {
  const [p] = await consultar(
    `${comoUsuario(socio.id)}
     select public.tem_produto('financeiro') tem_financeiro,
            (select count(*) from financeiro.lancamentos)::int lancamentos_pela_rls,
            jsonb_array_length(financeiro.fn_faturamento_mensal(p_comp_de => '${ate}', p_comp_ate => '${ate}', p_limite_clientes => 1)->'serie') > 0
              or (financeiro.fn_faturamento_mensal(p_comp_de => '${de}', p_comp_ate => '${ate}', p_limite_clientes => 1)#>>'{totais,receita_total_escopo}')::numeric > 0 funcao_devolve_receita`,
    ro,
  );
  portaSocio = {
    ...p,
    cockpit_mostraria: montarLeituraGrupo({ acesso: p.tem_financeiro, faturamento: null }).estado,
  };
}

// ── Comparações mês a mês ─────────────────────────────────────────────────
const porMes = (linhas) => {
  const m = new Map();
  for (const l of linhas) m.set(l.mes, (m.get(l.mes) ?? 0) + Math.round(Number(l.valor) * 100));
  return m;
};
const comparar = (cockpit, sql) => {
  const a = porMes(cockpit);
  const b = porMes(sql);
  const meses = [...new Set([...a.keys(), ...b.keys()])].sort();
  const linhas = meses.map((mes) => ({
    mes,
    cockpit: a.has(mes) ? a.get(mes) / 100 : null,
    sql: b.has(mes) ? b.get(mes) / 100 : null,
    confere: a.get(mes) === b.get(mes),
  }));
  return { confere: linhas.every((l) => l.confere), meses: linhas };
};
const sem = ({ notasPorMes, destino, porChave, ...r }) => ({
  ...r,
  meses_com_nota: Object.keys(notasPorMes),
  chaves_na_janela: porChave.length,
});
const resumoGrupo = resumirLeitura(grupo, hoje);
const resumoRede = resumirLeitura(rede, hoje);
const saida = {
  quando: new Date().toISOString(),
  hoje,
  janela: { de, ate },
  fonte:
    "banco único Planning Brain (npknehhyyzelmrbbxvtu), somente leitura, JWT de super admin simulado",
  porta_super_admin: porta,
  grupo: {
    estado_leitura: grupo.estado,
    parciais_fonte: grupo.parciaisFonte,
    resumo: { ...sem(resumoGrupo), notas: resumoGrupo.notas.length },
    conferencia: comparar(grupo.linhas, independenteGrupo),
    soma_crua_lancamentos_1_1: Object.fromEntries(cru.map((l) => [l.mes, Number(l.valor)])),
  },
  rede: {
    estado_leitura: rede.estado,
    parciais_fonte: rede.parciaisFonte,
    resumo: { ...sem(resumoRede), notas: resumoRede.notas.length },
    conferencia: comparar(rede.linhas, independenteRede),
    parciais_sql: independenteRede.filter((l) => l.faltam > 0).map((l) => l.mes),
  },
  porta_socio_regional_sem_financeiro: portaSocio,
  tempos,
};
saida.rede.parciais_conferem =
  JSON.stringify(saida.rede.parciais_sql) === JSON.stringify(rede.parciaisFonte);
mkdirSync(SAIDA, { recursive: true });
const arquivo = `${SAIDA}/receita-${hoje}.json`;
writeFileSync(arquivo, JSON.stringify(saida, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      arquivo,
      porta: porta,
      grupo: {
        estado: resumoGrupo.estado,
        fechados: resumoGrupo.fechados,
        multiplo: resumoGrupo.multiploNecessario,
        confere: saida.grupo.conferencia.confere,
        divergentes: saida.grupo.conferencia.meses.filter((m) => !m.confere),
        parciais: grupo.parciaisFonte,
      },
      rede: {
        estado: resumoRede.estado,
        fechados: resumoRede.fechados,
        multiplo: resumoRede.multiploNecessario,
        confere: saida.rede.conferencia.confere,
        divergentes: saida.rede.conferencia.meses.filter((m) => !m.confere),
        parciais: rede.parciaisFonte,
        parciais_conferem: saida.rede.parciais_conferem,
      },
      portaSocio,
      tempos,
    },
    null,
    2,
  ),
);
