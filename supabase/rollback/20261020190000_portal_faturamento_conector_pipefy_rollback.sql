-- Rollback de 20261020190000_portal_faturamento_conector_pipefy.sql: volta receita_cnpj_gravar ao corpo de
-- 20261020170000, tira as funções novas e as colunas de endereço, e devolve ao job da fila o comando de 20261020160000.
-- Atenção: apagar as colunas apaga os endereços já gravados no cache da Receita.
begin;

drop function if exists ops.fat_conector_pipefy_contexto(uuid);
drop function if exists integracoes.fat_pipefy_contexto(uuid);
drop function if exists ops.fat_conector_receita_cnpj(text);
drop function if exists integracoes.fat_receita_cnpj(text);

CREATE OR REPLACE FUNCTION integracoes.receita_cnpj_gravar(p_cnpj text, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _cnpj text := coalesce(receita.fat_documento_normalizar(p_cnpj), '');
  _d jsonb := coalesce(p_dados, '{}'::jsonb);
  _r integracoes.receita_cnpj;
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
  insert into integracoes.receita_cnpj as r
    (cnpj, razao_social, nome_fantasia, situacao, situacao_desde, municipio, uf, emails, fonte, consultado_em)
  values (_cnpj, nullif(btrim(_d ->> 'razao_social'), ''), nullif(btrim(_d ->> 'nome_fantasia'), ''),
          nullif(upper(btrim(_d ->> 'situacao')), ''), nullif(_d ->> 'situacao_desde', '')::date,
          nullif(btrim(_d ->> 'municipio'), ''), nullif(upper(btrim(_d ->> 'uf')), ''),
          coalesce(array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(_d -> 'emails', '[]'::jsonb)) x
                          where receita.fat_email_valido(lower(btrim(x)))), '{}'),
          btrim(_d ->> 'fonte'), coalesce(nullif(_d ->> 'consultado_em', '')::timestamptz, now()))
  on conflict (cnpj) do update
     set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, situacao = excluded.situacao,
         situacao_desde = excluded.situacao_desde, municipio = excluded.municipio, uf = excluded.uf,
         emails = excluded.emails, fonte = excluded.fonte, consultado_em = excluded.consultado_em
  returning r.* into _r;
  return jsonb_build_object('cnpj', _r.cnpj, 'situacao', _r.situacao, 'consultado_em', _r.consultado_em);
end $function$;

alter table integracoes.receita_cnpj
  drop column logradouro, drop column numero, drop column complemento, drop column bairro, drop column cep;

select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.schedule('faturamento-omie-fila', '*/2 * * * *', $cron$select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"processar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from integracoes.omie_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'));$cron$);

do $conferencia$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'integracoes' and table_name = 'receita_cnpj'
              and column_name in ('logradouro', 'numero', 'complemento', 'bairro', 'cep')) then
    raise exception 'rollback T3: coluna de endereço sobrou';
  end if;
  if exists (select 1 from cron.job where jobname = 'faturamento-omie-fila' and command like '%pipefy_envios%') then
    raise exception 'rollback T3: o job da fila ainda olha o Pipefy';
  end if;
end $conferencia$;

commit;
