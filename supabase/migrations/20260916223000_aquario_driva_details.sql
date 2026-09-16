begin;

-- Mantém a autorização por carteira e o controle separado de contatos.
-- Acrescenta somente evidências empresariais da consulta Driva, sem segredo de API.
create or replace function ops.monetizacao_detail(_key text) returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare detail jsonb;
begin
 if not ops.monetizacao_can('view.aquario') or not exists(select 1 from ops.monetizacao_contas a where a.key=_key and ops.monetizacao_scope(a.unidade_ids)) then raise exception 'Conta fora do seu escopo'; end if;
 select detalhe into detail from ops.monetizacao_detalhes where account_key=_key;
 return jsonb_build_object('cnpjs',detail->'cnpjs','fields',detail->'fields','driva',detail->'driva','ecd_summary',detail->'ecd_summary','sources',detail->'sources','contacts',case when ops.monetizacao_can('view.contatos') then coalesce(detail->'contacts','[]') else '[]'::jsonb end,'contacts_restricted',not ops.monetizacao_can('view.contatos'));
end $$;
revoke all on function ops.monetizacao_detail(text) from public,anon;
grant execute on function ops.monetizacao_detail(text) to authenticated;
notify pgrst,'reload schema';
commit;
