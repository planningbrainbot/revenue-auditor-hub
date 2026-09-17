begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create or replace function ops.base_propor_alteracao(_empresa integer,_campo text,_valor jsonb,_motivo text)
returns uuid language plpgsql security definer set search_path=ops,public,extensions as $$
declare e ops.empresas; ident uuid; col text; previous jsonb;
begin
 if auth.uid() is null or not ops.monetizacao_can('view.clientes') or not ops.has_role(auth.uid(),'admin'::ops.app_role) then raise exception 'Sem permissão para corrigir cadastro'; end if;
 if _campo not in ('raz_o_social','cnpj','origem_da_base','segmento') then raise exception 'Campo não editável por esta operação'; end if;
 select * into e from ops.empresas where id=_empresa;
 if e.id is null or e.pipefy_record_id is null then raise exception 'Empresa sem vínculo confirmado com Pipefy'; end if;
 if not ops.monetizacao_scope(case when e.unidade_id is null then '{}'::integer[] else array[e.unidade_id] end) then raise exception 'Empresa fora do escopo'; end if;
 if length(trim(coalesce(_motivo,'')))<5 then raise exception 'Informe o motivo da correção'; end if;
 if jsonb_typeof(_valor) not in ('string','null') then raise exception 'Valor inválido'; end if;
 if _campo='origem_da_base' and _valor#>>'{}' not in ('Base Antiga','Base Nova') then raise exception 'Origem inválida'; end if;
 if exists(select 1 from ops.base_alteracoes where empresa_id=e.id and campo=_campo and (status in ('pending','sending') or (status='error' and tentativas<5))) then raise exception 'Já existe uma correção deste campo em andamento';end if;
 col:=case _campo when 'raz_o_social' then 'razao_social' else _campo end;
 select campos->col into previous from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=e.pipefy_record_id;
 insert into ops.base_alteracoes(empresa_id,campo,valor_anterior,valor_proposto,ator_id,motivo)
  values(e.id,_campo,coalesce(previous,to_jsonb(e)->col),_valor,auth.uid(),_motivo) returning id into ident;
 return ident;
end $$;
create or replace function ops.base_unica_catalogo(_keys text[] default null) returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem='nova' and cardinality(a.pipefy_ids)>0 and a.declarada<>array['Base Nova'])),'[]')
 from ops.base_conta_estado a
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.monetizacao_can('view.clientes')) and ops.monetizacao_scope(a.unidade_ids) and (_keys is null or a.key=any(_keys))
$$;
create or replace function ops.base_sync_status() returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select case when auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then
 jsonb_build_object('sources',(select jsonb_agg(to_jsonb(s)) from (select distinct on(fonte) fonte,inicio,fim,status,recebidos,gravados,erro from ops.base_sync_execucoes order by fonte,inicio desc) s),'pending_changes',(select count(distinct b.id) from ops.base_alteracoes b join ops.monetizacao_contas a on b.empresa_id=any(a.empresa_ids) where b.status in ('pending','sending','error','conflict') and ops.monetizacao_scope(a.unidade_ids))) else null end
$$;
create or replace function ops.base_contatos() returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select c.id,c.nome_completo name,c.email,c.whatsapp phone,c.cargo role,array_agg(distinct a.key) accounts
 from ops.contatos c join ops.monetizacao_contas a on c.empresa_id=any(a.empresa_ids)
 left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where auth.uid() is not null and ops.monetizacao_can('view.contatos') and (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario')) and ops.monetizacao_scope(a.unidade_ids) and s.status is distinct from 'ausente'
 group by c.id,c.nome_completo,c.email,c.whatsapp,c.cargo
 ) x
$$;
create or replace function ops.monetizacao_detail(_key text) returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare detail jsonb; a ops.monetizacao_contas; channels jsonb:='[]'; documents jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
 select * into a from ops.monetizacao_contas where key=_key;
 if a.key is null or not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do seu escopo';end if;
 select detalhe into detail from ops.monetizacao_detalhes where account_key=_key;
 select coalesce(jsonb_agg(cnpj),'[]') into documents from ops.base_conta_cnpjs where account_key=_key;
 if ops.monetizacao_can('view.contatos') then
  select coalesce(jsonb_agg(distinct x),'[]') into channels from (
   select x from jsonb_array_elements(coalesce(detail->'contacts','[]')) x
    where cardinality(a.empresa_ids)=0 and coalesce(x->>'source','') not like 'ops.contatos%'
   union all
   select jsonb_build_object('type',v.tipo,'value',v.valor,'source','Pipefy · contato vinculado','at',c.updated_at)
   from ops.contatos c left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
   cross join lateral (values ('email',c.email),('whatsapp',c.whatsapp)) v(tipo,valor)
   where c.empresa_id=any(a.empresa_ids) and s.status is distinct from 'ausente' and nullif(trim(v.valor),'') is not null
   union all
   select jsonb_build_object('type',v.tipo,'value',v.valor,'source','Omie · canal da empresa','at',coalesce(o.synced_at,o.updated_at))
   from ops.base_conta_cnpjs d join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj
   cross join lateral (values ('email',o.email),('telefone',o.telefone)) v(tipo,valor)
   where d.account_key=_key and nullif(trim(v.valor),'') is not null
  ) q;
 end if;
 return jsonb_build_object('cnpjs',documents,'fields',detail->'fields','driva',detail->'driva','ecd_summary',detail->'ecd_summary','sources',detail->'sources','contacts',channels,'contacts_restricted',not ops.monetizacao_can('view.contatos'));
end $$;
alter policy base_clientes_contas_read on ops.monetizacao_contas using (ops.monetizacao_can('view.clientes') and ops.monetizacao_scope(unidade_ids));
alter policy base_clientes_unidades_read on ops.monetizacao_unidades using (ops.monetizacao_can('view.clientes') and ops.monetizacao_scope(array[unidade_id]));
alter policy base_clientes_sync_read on ops.monetizacao_sync using (ops.monetizacao_can('view.clientes'));
notify pgrst,'reload schema';
commit;
