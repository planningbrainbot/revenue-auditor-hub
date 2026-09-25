// Prova da RLS das tabelas da conversa, contra o Postgres de produção, SEM deixar rastro.
//
// Manda num único comando: a migration + um bloco que testa como três pessoas (A com a área, B que
// recebe a área só nesta transação, C sem a área) e anônimo, e termina em `raise exception` com o
// resultado. A exceção desfaz TUDO, inclusive a migration: nada fica no banco. Se a migration já
// estiver aplicada, rode com --aplicada para testar só as policies vivas.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node scripts/cockpit-ceo/conversa-rls.mjs [--aplicada]
import { readFileSync } from "node:fs";

const REF = process.env.BRAIN_REF || "npknehhyyzelmrbbxvtu";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN ausente.");
const aplicada = process.argv.includes("--aplicada");
const migration = aplicada
  ? ""
  : readFileSync(
      new URL("../../supabase/migrations/20260925000000_cockpit_ceo_conversa.sql", import.meta.url),
      "utf8",
    );

const bloco = String.raw`
do $teste$
declare
  a uuid; b uuid; c uuid;
  conv uuid; vis uuid; n int; res jsonb := '{}'::jsonb; ok boolean;
  procedure_as text;
begin
  select ur.user_id into a from ops.user_roles ur join ops.role_areas ra on ra.role = ur.role and ra.allowed
   where ra.area = 'cockpit_ceo' limit 1;
  select u.id into b from auth.users u where u.id <> a
     and not exists (select 1 from ops.user_roles ur join ops.role_areas ra on ra.role = ur.role
                      where ur.user_id = u.id and ra.area = 'cockpit_ceo')
   order by u.created_at limit 1;
  select u.id into c from auth.users u where u.id not in (a, b)
     and not exists (select 1 from ops.user_roles ur join ops.role_areas ra on ra.role = ur.role
                      where ur.user_id = u.id and ra.area = 'cockpit_ceo')
     and not exists (select 1 from ops.usuario_areas x where x.user_id = u.id and x.area = 'cockpit_ceo')
   order by u.created_at limit 1;
  -- B ganha a área só dentro desta transação.
  insert into ops.usuario_areas (user_id, area, allowed) values (b, 'cockpit_ceo', true);

  -- ── A: cria conversa, mensagem, visão e consumo ──
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into ops.cockpit_conversas (titulo) values ('teste') returning id into conv;
  insert into ops.cockpit_mensagens (conversa_id, papel, texto) values (conv, 'usuario', 'pergunta');
  insert into ops.cockpit_visoes (nome, definicao, conversa_id) values ('v', '{"versao":1}', conv) returning id into vis;
  insert into ops.cockpit_ia_consumo (tipo, modelo, estado) values ('modelo', 'm', 'reservada');
  select count(*) into n from ops.cockpit_conversas; res := res || jsonb_build_object('a_ve_suas_conversas', n);
  res := res || jsonb_build_object('a_orcamento', ops.cockpit_ia_orcamento() ? 'mes_usd');
  begin
    update ops.cockpit_ia_consumo set custo_usd = 0; get diagnostics n = row_count;
    res := res || jsonb_build_object('a_altera_consumo', n);
  exception when others then res := res || jsonb_build_object('a_altera_consumo', 'negado');
  end;
  begin
    delete from ops.cockpit_ia_consumo; get diagnostics n = row_count;
    res := res || jsonb_build_object('a_apaga_consumo', n);
  exception when others then res := res || jsonb_build_object('a_apaga_consumo', 'negado');
  end;

  -- ── B (tem a área, outra pessoa): não vê nem mexe no que é de A ──
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from ops.cockpit_conversas; res := res || jsonb_build_object('b_ve_conversas_de_a', n);
  select count(*) into n from ops.cockpit_mensagens; res := res || jsonb_build_object('b_ve_mensagens_de_a', n);
  select count(*) into n from ops.cockpit_visoes; res := res || jsonb_build_object('b_ve_visoes_de_a', n);
  select count(*) into n from ops.cockpit_ia_consumo; res := res || jsonb_build_object('b_ve_consumo_de_a', n);
  update ops.cockpit_visoes set nome = 'invadido' where id = vis; get diagnostics n = row_count;
  res := res || jsonb_build_object('b_renomeia_visao_de_a', n);
  delete from ops.cockpit_visoes where id = vis; get diagnostics n = row_count;
  res := res || jsonb_build_object('b_apaga_visao_de_a', n);
  begin
    insert into ops.cockpit_mensagens (conversa_id, papel, texto) values (conv, 'usuario', 'intruso');
    res := res || jsonb_build_object('b_escreve_na_conversa_de_a', 'aceito');
  exception when others then res := res || jsonb_build_object('b_escreve_na_conversa_de_a', 'negado');
  end;
  begin
    insert into ops.cockpit_visoes (nome, definicao, conversa_id) values ('x', '{}', conv);
    res := res || jsonb_build_object('b_liga_visao_a_conversa_de_a', 'aceito');
  exception when others then res := res || jsonb_build_object('b_liga_visao_a_conversa_de_a', 'negado');
  end;
  begin
    insert into ops.cockpit_conversas (user_id, titulo) values (a, 'forjada');
    res := res || jsonb_build_object('b_cria_conversa_em_nome_de_a', 'aceito');
  exception when others then res := res || jsonb_build_object('b_cria_conversa_em_nome_de_a', 'negado');
  end;

  -- ── C (sem a área): nem as próprias ──
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin
    insert into ops.cockpit_conversas (titulo) values ('sem area');
    res := res || jsonb_build_object('c_cria_conversa_sem_area', 'aceito');
  exception when others then res := res || jsonb_build_object('c_cria_conversa_sem_area', 'negado');
  end;
  begin
    perform ops.cockpit_ia_orcamento();
    res := res || jsonb_build_object('c_le_orcamento', 'aceito');
  exception when others then res := res || jsonb_build_object('c_le_orcamento', 'negado');
  end;

  -- ── anônimo ──
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from ops.cockpit_conversas;
    res := res || jsonb_build_object('anon_le_conversas', n);
  exception when others then res := res || jsonb_build_object('anon_le_conversas', 'negado');
  end;

  raise exception 'RESULTADO %', res::text;
end
$teste$;`;

const resp = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    "User-Agent": "planning-cockpit-ceo-conversa-rls/1.0",
  },
  body: JSON.stringify({ query: migration + "\n" + bloco }),
});
const texto = await resp.text();
const m = texto.match(/RESULTADO (\{.*?\})(?:\\n|")/);
if (!m) {
  console.error("Sem resultado. Resposta:", texto.slice(0, 1500));
  process.exit(1);
}
const r = JSON.parse(m[1].replace(/\\"/g, '"'));
const esperado = {
  a_ve_suas_conversas: 1,
  a_altera_consumo: "negado",
  a_apaga_consumo: "negado",
  b_ve_conversas_de_a: 0,
  b_ve_mensagens_de_a: 0,
  b_ve_visoes_de_a: 0,
  b_ve_consumo_de_a: 0,
  b_renomeia_visao_de_a: 0,
  b_apaga_visao_de_a: 0,
  b_escreve_na_conversa_de_a: "negado",
  b_liga_visao_a_conversa_de_a: "negado",
  b_cria_conversa_em_nome_de_a: "negado",
  c_cria_conversa_sem_area: "negado",
  c_le_orcamento: "negado",
  anon_le_conversas: "negado",
};
let falhas = 0;
for (const [k, v] of Object.entries(esperado)) {
  const ok = JSON.stringify(r[k]) === JSON.stringify(v);
  if (!ok) falhas++;
  console.log(
    `${ok ? "ok  " : "FALHA"} ${k}: ${JSON.stringify(r[k])}${ok ? "" : ` (esperado ${JSON.stringify(v)})`}`,
  );
}
console.log(`orçamento visto por A: ${JSON.stringify(r.a_orcamento)}`);
console.log(
  falhas
    ? `${falhas} falha(s).`
    : "Todas as regras conferidas; nada ficou no banco (a transação foi desfeita).",
);
process.exit(falhas ? 1 : 0);
