-- Portal de Faturamento · T2/T3: endereço da Receita para o cliente novo no Omie, contexto do card do Pipefy e o cron
-- da fila passando a acordar a edge também para o Pipefy (20/10/2026).
--
-- Plano: PM Work/execution/portal-faturamento-prd-20261013/e1/PLANO-E1.md (T2, T3). API: e1/API.md §2.7–§2.9 e
-- "Mudanças". Mapa do pipe: e1/pipefy-307098392-mapa.md (§1.3, §3 e "Mudança de 20/10").
-- Depende de 20261020120000 (T1b), 20261020170000 (ajustes) e 20261020160000 (cron do conector), aplicadas antes.
-- Ensaio (begin … rollback): supabase/gates/20261020_portal_faturamento_conector_pipefy.sql
-- Rollback: supabase/rollback/20261020190000_portal_faturamento_conector_pipefy_rollback.sql
--
-- O que faz:
--   1. integracoes.receita_cnpj ganha o endereço da consulta (logradouro, numero, complemento, bairro, cep), e
--      integracoes.receita_cnpj_gravar passa a gravá-lo. O corpo é o de 20261020170000 (CNPJ alfanumérico) com as
--      cinco colunas a mais; o resto não muda. Quem consulta a CNPJá (a server function da tela, pelo
--      ops.fat_receita_cnpj_gravar) passa as chaves novas em p_dados.
--   2. integracoes.fat_receita_cnpj(p_cnpj) e a passagem ops.fat_conector_receita_cnpj: o conector lê o cache para
--      cadastrar o cliente novo no Omie com endereço. Sem consulta, devolve nulo e o conector segue com município e UF.
--   3. integracoes.fat_pipefy_contexto(p_pedido) e a passagem ops.fat_conector_pipefy_contexto: o que o card precisa e
--      a fila do Pipefy não traz no mover_fase. São o solicitante, o dono e o responsável da tesouraria, com e-mail
--      para casar com a Table Colaboradores, e o card_id. O responsável é quem conferiu; sem conferência, é o autor do
--      último evento de tesouraria (faturar, devolver, cancelar).
--   4. O job faturamento-omie-fila chama a edge quando há envio vencido no Omie OU no Pipefy.
-- Tudo em integracoes e as passagens: security definer, search_path vazio, só o service_role executa (GRANT e
-- integracoes.fat_exigir_conector no corpo).

begin;

-- =================================================================================================================
-- 1. Endereço na consulta da Receita
-- =================================================================================================================
alter table integracoes.receita_cnpj
  add column logradouro text check (logradouro is null or btrim(logradouro) <> ''),
  add column numero text check (numero is null or btrim(numero) <> ''),
  add column complemento text check (complemento is null or btrim(complemento) <> ''),
  add column bairro text check (bairro is null or btrim(bairro) <> ''),
  add column cep text check (cep is null or cep ~ '^[0-9]{8}$');
comment on column integracoes.receita_cnpj.logradouro is 'Logradouro da consulta (CNPJá: address.street), com o tipo (Rua, Av.).';
comment on column integracoes.receita_cnpj.numero is 'Número do endereço como veio (pode ser "S/N").';
comment on column integracoes.receita_cnpj.complemento is 'Complemento do endereço.';
comment on column integracoes.receita_cnpj.bairro is 'Bairro (CNPJá: address.district).';
comment on column integracoes.receita_cnpj.cep is 'CEP só com os 8 dígitos.';

create or replace function integracoes.receita_cnpj_gravar(p_cnpj text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _cnpj text := coalesce(receita.fat_documento_normalizar(p_cnpj), '');
  _d jsonb := coalesce(p_dados, '{}'::jsonb);
  _r integracoes.receita_cnpj;
  _cep text := nullif(regexp_replace(coalesce(p_dados ->> 'cep', ''), '[^0-9]', '', 'g'), '');
begin
  perform integracoes.fat_exigir_conector();
  if char_length(_cnpj) <> 14 or not receita.fat_documento_valido(_cnpj) then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(_d ->> 'fonte'), '') is null then
    raise exception 'p_dados.fonte é obrigatório.' using errcode = '22023';
  end if;
  if _d ? 'emails' and jsonb_typeof(_d -> 'emails') <> 'array' then
    raise exception 'p_dados.emails precisa ser lista.' using errcode = '22023';
  end if;
  if _cep is not null and _cep !~ '^[0-9]{8}$' then
    raise exception 'p_dados.cep: o CEP tem 8 dígitos.' using errcode = '22023';
  end if;
  insert into integracoes.receita_cnpj as r
    (cnpj, razao_social, nome_fantasia, situacao, situacao_desde, municipio, uf, emails, fonte, consultado_em,
     logradouro, numero, complemento, bairro, cep)
  values (_cnpj, nullif(btrim(_d ->> 'razao_social'), ''), nullif(btrim(_d ->> 'nome_fantasia'), ''),
          nullif(upper(btrim(_d ->> 'situacao')), ''), nullif(_d ->> 'situacao_desde', '')::date,
          nullif(btrim(_d ->> 'municipio'), ''), nullif(upper(btrim(_d ->> 'uf')), ''),
          coalesce(array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(_d -> 'emails', '[]'::jsonb)) x
                          where receita.fat_email_valido(lower(btrim(x)))), '{}'),
          btrim(_d ->> 'fonte'), coalesce(nullif(_d ->> 'consultado_em', '')::timestamptz, now()),
          nullif(btrim(_d ->> 'logradouro'), ''), nullif(btrim(_d ->> 'numero'), ''),
          nullif(btrim(_d ->> 'complemento'), ''), nullif(btrim(_d ->> 'bairro'), ''), _cep)
  on conflict (cnpj) do update
     set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, situacao = excluded.situacao,
         situacao_desde = excluded.situacao_desde, municipio = excluded.municipio, uf = excluded.uf,
         emails = excluded.emails, fonte = excluded.fonte, consultado_em = excluded.consultado_em,
         logradouro = excluded.logradouro, numero = excluded.numero, complemento = excluded.complemento,
         bairro = excluded.bairro, cep = excluded.cep
  returning r.* into _r;
  return jsonb_build_object('cnpj', _r.cnpj, 'situacao', _r.situacao, 'consultado_em', _r.consultado_em);
end $$;

-- =================================================================================================================
-- 2. O conector lê o cache da Receita
-- =================================================================================================================
create or replace function integracoes.fat_receita_cnpj(p_cnpj text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _r integracoes.receita_cnpj;
begin
  perform integracoes.fat_exigir_conector();
  select * into _r from integracoes.receita_cnpj where cnpj = receita.fat_documento_normalizar(p_cnpj);
  if not found then return null; end if;
  return jsonb_build_object(
    'cnpj', _r.cnpj, 'razao_social', _r.razao_social, 'nome_fantasia', _r.nome_fantasia, 'situacao', _r.situacao,
    'logradouro', _r.logradouro, 'numero', _r.numero, 'complemento', _r.complemento, 'bairro', _r.bairro,
    'cep', _r.cep, 'municipio', _r.municipio, 'uf', _r.uf, 'fonte', _r.fonte, 'consultado_em', _r.consultado_em);
end $$;
comment on function integracoes.fat_receita_cnpj(text) is
  'Consulta da Receita em cache (integracoes.receita_cnpj) para o conector do Omie cadastrar o cliente novo com '
  'endereço. Nulo quando o CNPJ não foi consultado. Só o service_role.';

create or replace function ops.fat_conector_receita_cnpj(p_cnpj text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_receita_cnpj(p_cnpj);
end $$;
comment on function ops.fat_conector_receita_cnpj(text) is
  'Passagem do conector (service_role) para integracoes.fat_receita_cnpj: integracoes não é exposto no PostgREST.';

-- =================================================================================================================
-- 3. Contexto do card do Pipefy
-- =================================================================================================================
create or replace function integracoes.fat_pipefy_contexto(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _p receita.fat_pedidos;
  _resp uuid;
  _origem text;
begin
  perform integracoes.fat_exigir_conector();
  select * into _p from receita.fat_pedidos where id = p_pedido;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if _p.conferido_por is not null then
    _resp := _p.conferido_por;
    _origem := 'conferencia';
  else
    select e.autor_id, e.evento into _resp, _origem
      from receita.fat_eventos e
     where e.entidade = 'pedido' and e.entidade_id = _p.id and e.autor_id is not null
       and e.evento in ('conferencia', 'faturar_pedido', 'devolvido', 'cancelado')
     order by e.em desc, e.id desc
     limit 1;
  end if;
  return jsonb_build_object(
    'pedido', jsonb_build_object(
      'id', _p.id, 'numero', _p.numero, 'status', _p.status, 'simulacao', _p.simulacao,
      'motivo_status', _p.motivo_status, 'omie_os_codigo', _p.omie_os_codigo, 'omie_nf_numero', _p.omie_nf_numero,
      'omie_nf_link', _p.omie_nf_link, 'omie_nf_emitida_em', _p.omie_nf_emitida_em, 'documento', _p.documento),
    'solicitante', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', lower(u.email))
                      from public.profiles u where u.user_id = _p.solicitante_id),
    'dono', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', lower(u.email))
               from public.profiles u where u.user_id = _p.dono_id),
    'responsavel_ticket', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', lower(u.email),
                                                     'origem', _origem)
                             from public.profiles u where u.user_id = _resp),
    'card_id', (select x.card_id from integracoes.pipefy_envios x
                 where x.origem = 'fat_pedido' and x.origem_id = _p.id and x.card_id is not null
                 order by x.seq desc limit 1));
end $$;
comment on function integracoes.fat_pipefy_contexto(uuid) is
  'O que o card do pipe 307098392 precisa e o mover_fase não traz: solicitante, dono e responsável da tesouraria '
  '(quem conferiu; sem conferência, o autor do último evento de tesouraria), com e-mail para casar com a Table '
  'Colaboradores, e o card_id já criado. Só o service_role.';

create or replace function ops.fat_conector_pipefy_contexto(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_pipefy_contexto(p_pedido);
end $$;
comment on function ops.fat_conector_pipefy_contexto(uuid) is
  'Passagem do conector (service_role) para integracoes.fat_pipefy_contexto: integracoes não é exposto no PostgREST.';

revoke all on function integracoes.fat_receita_cnpj(text), ops.fat_conector_receita_cnpj(text),
                       integracoes.fat_pipefy_contexto(uuid), ops.fat_conector_pipefy_contexto(uuid)
  from public, anon, authenticated;
grant execute on function integracoes.fat_receita_cnpj(text), ops.fat_conector_receita_cnpj(text),
                          integracoes.fat_pipefy_contexto(uuid), ops.fat_conector_pipefy_contexto(uuid)
  to service_role;

-- =================================================================================================================
-- 4. O cron da fila acorda a edge também para o Pipefy
-- =================================================================================================================
select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.schedule('faturamento-omie-fila', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"processar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from integracoes.omie_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'))
      or exists (
     select 1 from integracoes.pipefy_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'));
$cron$);

do $conferencia$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'integracoes' and table_name = 'receita_cnpj'
     and column_name in ('logradouro', 'numero', 'complemento', 'bairro', 'cep');
  if n <> 5 then raise exception 'T3: % das 5 colunas de endereço em receita_cnpj', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where (s.nspname, p.proname) in (('ops', 'fat_conector_receita_cnpj'), ('ops', 'fat_conector_pipefy_contexto'),
                                    ('integracoes', 'fat_receita_cnpj'), ('integracoes', 'fat_pipefy_contexto'))
     and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute');
  if n <> 4 then raise exception 'T3: % das 4 funções novas com o acesso certo', n; end if;
  select count(*) into n from cron.job
   where jobname = 'faturamento-omie-fila' and active and command like '%integracoes.pipefy_envios%'
     and command like '%faturamento_cron_secret%';
  if n <> 1 then raise exception 'T3: o job da fila não olha a fila do Pipefy'; end if;
end $conferencia$;

commit;
