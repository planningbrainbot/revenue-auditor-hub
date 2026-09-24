// Verificação SOMENTE LEITURA das propostas de segurança de 23/09 (supabase/proposals/2026092323*).
// Antes de aplicar: mostra o furo. Depois: tem de dar 0 funções abertas, e o sócio regional
// simulado tem de receber "permission denied" em fn_faturamento_mensal; qb_clientes_ativos com
// security_invoker tem de devolver ao sócio o mesmo total que a RLS de empresas.
// Uso: SUPABASE_ACCESS_TOKEN=… node --experimental-strip-types scripts/cockpit-ceo/verificar-financeiro-execute.mjs
import { consultar } from "./brain-ro.mjs";
const ro = (sql) => consultar(sql, { transacaoSomenteLeitura: true });
const [f] = await ro(`select count(*)::int funcoes, count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::int abertas_authenticated
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'financeiro'`);
const [v] = await ro(`select coalesce(array_to_string(reloptions, ','), '') opcoes from pg_class where oid = 'ops.qb_clientes_ativos'::regclass`);
const [socio] = await ro(`select user_id::text id from ops.user_roles where role = 'socio_regional' order by user_id limit 1`);
let chamada = "sem sócio regional para simular";
let view = null;
if (socio?.id && /^[0-9a-f-]{36}$/.test(socio.id)) {
  const claims = JSON.stringify({ sub: socio.id, role: "authenticated" });
  const pre = `set local role authenticated; set local statement_timeout = '8s'; set local request.jwt.claims to '${claims}';`;
  chamada = await ro(`${pre} select jsonb_array_length(financeiro.fn_faturamento_mensal(p_comp_de => '2026-01-01', p_comp_ate => '2026-08-01', p_limite_clientes => 1)->'serie') meses`)
    .then((r) => `DEVOLVEU ${r[0].meses} meses (furo aberto)`)
    .catch((e) => (/permission denied/.test(e.message) ? "permission denied (fechado)" : e.message.slice(0, 120)));
  [view] = await ro(`${pre} select (select count(*) from ops.qb_clientes_ativos)::int pela_view, (select count(*) from ops.empresas)::int pela_rls`);
}
console.log(JSON.stringify({ financeiro: f, socio_chama_fn_faturamento: chamada, qb_clientes_ativos: { ...v, ...view } }, null, 2));
