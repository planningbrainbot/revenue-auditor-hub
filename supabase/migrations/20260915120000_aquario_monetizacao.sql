-- Clientes/Aquário e Monetização compartilham as mesmas contas e o pipe 39.
-- Destino: Planning Brain, schema ops. Nenhuma credencial ou dado nominal neste arquivo.
begin;

create table if not exists ops.monetizacao_contas (
  key text primary key,
  perfil jsonb not null,
  empresa_ids integer[] not null default '{}',
  org_ids bigint[] not null default '{}',
  unidade_ids integer[] not null default '{}',
  source_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists monetizacao_contas_org on ops.monetizacao_contas using gin(org_ids);
create index if not exists monetizacao_contas_unidade on ops.monetizacao_contas using gin(unidade_ids);
create table if not exists ops.monetizacao_detalhes (
  account_key text primary key references ops.monetizacao_contas(key),
  detalhe jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists ops.monetizacao_unidades (
  key text primary key, unidade_id integer references ops.unidades(id),
  nome text not null, classification text not null default 'unidade'
);
create table if not exists ops.monetizacao_deals (
  id bigint primary key, org_id bigint, payload jsonb not null,
  unidade_ids integer[] not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists ops.monetizacao_sync (
  id boolean primary key default true check(id), status text not null default 'pending',
  started_at timestamptz, measured_at timestamptz, catalog_at timestamptz,
  error text, stages jsonb not null default '[]', count integer not null default 0
);
insert into ops.monetizacao_sync(id) values(true) on conflict do nothing;
create table if not exists ops.monetizacao_listas (
  id uuid primary key default gen_random_uuid(), nome text not null,
  unidade_id integer references ops.unidades(id), unidade_nome text not null,
  revision integer not null default 1, status text not null default 'draft' check(status in ('draft','validated','sent')),
  owner_id bigint not null, partner text, origin_confirmed boolean not null default false,
  scan_confirmed boolean not null default false,
  created_by uuid not null references auth.users(id), validated_by uuid references auth.users(id),
  validated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists ops.monetizacao_itens (
  id uuid primary key default gen_random_uuid(), list_id uuid not null references ops.monetizacao_listas(id),
  account_key text not null references ops.monetizacao_contas(key),
  product text not null check(product in ('cella','consultoria','finance')),
  review jsonb not null default '{}',
  status text not null default 'draft' check(status in ('draft','validated','sending','sent','uncertain','blocked')),
  deal_id bigint, reason text, unique(list_id,account_key,product)
);
create table if not exists ops.monetizacao_envios (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references ops.monetizacao_itens(id),
  account_key text not null references ops.monetizacao_contas(key), product text not null,
  status text not null check(status in ('sending','sent','uncertain','blocked','released')),
  deal_id bigint, org_id bigint, reason text,
  actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists monetizacao_envios_active on ops.monetizacao_envios(account_key,product) where status in ('sending','sent','uncertain');
create table if not exists ops.monetizacao_planos (
  month text not null check(month ~ '^\d{4}-\d{2}$'), owner_id bigint not null,
  payload jsonb not null, updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), primary key(month,owner_id)
);
create table if not exists ops.monetizacao_registros (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('pdi','roteiro','distribuicao','followup')),
  title text not null, body jsonb not null, unidade_id integer references ops.unidades(id),
  created_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table if not exists ops.monetizacao_audit (
  id bigint generated always as identity primary key, list_id uuid references ops.monetizacao_listas(id),
  action text not null, actor_id uuid references auth.users(id), detail jsonb not null default '{}', created_at timestamptz not null default now()
);

-- Usa a administração de áreas da plataforma, sem senha ou allowlist paralela.
insert into ops.area_chaves(area,permission_key) values
 ('clientes','view.aquario'), ('monetizacao','view.monetizacao'),
 ('monetizacao','manage.aquario'), ('monetizacao','send.monetizacao') on conflict do nothing;
-- Compatibilidade com a navegação ainda baseada na matriz anterior.
insert into ops.role_permissions(role,permission_key,allowed)
 select ra.role,ac.permission_key,true from ops.role_areas ra join ops.area_chaves ac on ac.area=ra.area
 where ra.allowed and ac.permission_key in ('view.aquario','view.monetizacao','manage.aquario','send.monetizacao')
 on conflict(role,permission_key) do update set allowed=excluded.allowed;

create or replace function ops.monetizacao_can(_key text) returns boolean
language sql stable security definer set search_path=ops,public,extensions as $$
 select auth.uid() is not null
   and exists(select 1 from public.profiles where user_id=auth.uid() and ativo)
   and exists(select 1 from public.produto_acesso where user_id=auth.uid() and produto='ops')
   and ops.can(_key)
$$;
create or replace function ops.monetizacao_scope(_ids integer[]) returns boolean
language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce((select todas_unidades from ops.usuario_escopo where user_id=auth.uid()),false)
   or coalesce(_ids && array(select ops.minhas_unidades()),false)
$$;
create or replace function ops.monetizacao_list_scope(_id uuid) returns boolean
language sql stable security definer set search_path=ops,public,extensions as $$
 select exists(select 1 from ops.monetizacao_listas l where l.id=_id and ops.monetizacao_scope(array[l.unidade_id]))
$$;

alter table ops.monetizacao_contas enable row level security;
alter table ops.monetizacao_detalhes enable row level security;
alter table ops.monetizacao_unidades enable row level security;
alter table ops.monetizacao_deals enable row level security;
alter table ops.monetizacao_sync enable row level security;
alter table ops.monetizacao_listas enable row level security;
alter table ops.monetizacao_itens enable row level security;
alter table ops.monetizacao_envios enable row level security;
alter table ops.monetizacao_planos enable row level security;
alter table ops.monetizacao_registros enable row level security;
alter table ops.monetizacao_audit enable row level security;

create policy monetizacao_contas_read on ops.monetizacao_contas for select to authenticated using ((ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) and ops.monetizacao_scope(unidade_ids));
create policy monetizacao_detalhes_read on ops.monetizacao_detalhes for select to authenticated using (ops.monetizacao_can('view.aquario') and ops.monetizacao_can('view.contatos') and exists(select 1 from ops.monetizacao_contas a where a.key=account_key));
create policy monetizacao_unidades_read on ops.monetizacao_unidades for select to authenticated using ((ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) and ops.monetizacao_scope(array[unidade_id]));
create policy monetizacao_deals_read on ops.monetizacao_deals for select to authenticated using ((ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) and ops.monetizacao_scope(unidade_ids));
create policy monetizacao_sync_read on ops.monetizacao_sync for select to authenticated using (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao'));
create policy monetizacao_listas_read on ops.monetizacao_listas for select to authenticated using ((ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) and ops.monetizacao_scope(array[unidade_id]));
create policy monetizacao_itens_read on ops.monetizacao_itens for select to authenticated using ((ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) and ops.monetizacao_list_scope(list_id));
create policy monetizacao_envios_read on ops.monetizacao_envios for select to authenticated using (ops.monetizacao_can('manage.aquario') and exists(select 1 from ops.monetizacao_itens i where i.id=item_id and ops.monetizacao_list_scope(i.list_id)));
create policy monetizacao_planos_read on ops.monetizacao_planos for select to authenticated using (ops.monetizacao_can('view.monetizacao') and ops.monetizacao_scope('{}'));
create policy monetizacao_registros_read on ops.monetizacao_registros for select to authenticated using (ops.monetizacao_can('view.monetizacao') and ops.monetizacao_scope(array[unidade_id]));
create policy monetizacao_audit_read on ops.monetizacao_audit for select to authenticated using (ops.monetizacao_can('manage.aquario') and ops.monetizacao_list_scope(list_id));
grant select on ops.monetizacao_contas,ops.monetizacao_detalhes,ops.monetizacao_unidades,ops.monetizacao_deals,ops.monetizacao_sync,ops.monetizacao_listas,ops.monetizacao_itens,ops.monetizacao_envios,ops.monetizacao_planos,ops.monetizacao_registros,ops.monetizacao_audit to authenticated;
grant all on ops.monetizacao_contas,ops.monetizacao_detalhes,ops.monetizacao_unidades,ops.monetizacao_deals,ops.monetizacao_sync,ops.monetizacao_listas,ops.monetizacao_itens,ops.monetizacao_envios,ops.monetizacao_planos,ops.monetizacao_registros,ops.monetizacao_audit to service_role;
grant usage,select on sequence ops.monetizacao_audit_id_seq to service_role;

-- O resultado é verificado no banco; alterar o JSON no navegador não libera Finance.
create or replace function ops.monetizacao_offer_issue(a jsonb,p text,r jsonb) returns text
language plpgsql immutable set search_path=ops,public,extensions as $$
declare regime text:=lower(coalesce(nullif(r->>'regime',''),a->>'regime',''));
 segment text:=lower(coalesce(nullif(r->>'segment',''),a->>'segment',''));
 band text:=coalesce(nullif(r->>'band',''),a->>'band','');
 low boolean:=band in ('Até R$ 500 mil','R$ 500 mil até R$ 1 milhão','R$ 1 milhão até R$ 2 milhões','R$ 2 milhões até R$ 4,8 milhões','R$ 4,8 milhões até R$ 10 milhões','R$ 10 milhões até R$ 25 milhões');
 high boolean:=band in ('R$ 25 milhões até R$ 50 milhões','R$ 50 milhões até R$ 78 milhões','Entre R$ 78 milhões e R$ 300 milhões','Acima de R$ 300 milhões','[ANTIGO] Acima de R$ 78 milhões');
begin
 if p='finance' and not coalesce((a->>'pipedrive_contract')::boolean,false) then return 'Sem contrato ganho no Pipedrive'; end if;
 if regime ~ '(simples|mei)' then return 'Simples Nacional ou MEI'; end if;
 if regime not in ('lucro real','lucro presumido','lucro arbitrado') then return 'Confirmar regime fora do Simples'; end if;
 if (coalesce((a->>'regime_conflict')::boolean,false) and nullif(r->>'regime','') is null)
 or (coalesce((a->>'band_conflict')::boolean,false) and nullif(r->>'band','') is null) then return 'Resolver divergência de regime ou faturamento'; end if;
 if p='finance' and not low then return 'Finance exige faixa inteiramente abaixo de R$ 25 milhões'; end if;
 if p='cella' and not high then return 'Cella exige faixa a partir de R$ 25 milhões'; end if;
 if p='consultoria' then
  if regime <> 'lucro real' then return 'Consultoria exige Lucro Real'; end if;
  if segment !~ '(ind.str|agro|varejo|distribui)' then return 'Confirmar segmento do perfil de Consultoria'; end if;
  if not low and not high then return 'Confirmar faixa de faturamento'; end if;
  if coalesce((a->>'segment_conflict')::boolean,false) and nullif(r->>'segment','') is null then return 'Resolver divergência de segmento'; end if;
 end if;
 return null;
end $$;

create or replace function ops.monetizacao_save_list(_data jsonb) returns uuid
language plpgsql security definer set search_path=ops,public,extensions as $$
declare lid uuid:=coalesce(nullif(_data->>'id','')::uuid,gen_random_uuid()); current_list ops.monetizacao_listas;
 unit integer:=nullif(_data->>'unidade_id','')::integer; item jsonb; account ops.monetizacao_contas;
 mode text:=coalesce(_data->>'mode','draft'); issue text; n integer; unit_name text;
begin
 if not ops.monetizacao_can('manage.aquario') or not ops.monetizacao_scope(array[unit]) then raise exception 'Sem permissão para gerir esta carteira'; end if;
 if mode not in ('draft','validate') then raise exception 'Ação inválida'; end if;
 if length(trim(coalesce(_data->>'nome',''))) not between 3 and 160 then raise exception 'Informe o nome da lista'; end if;
 if coalesce((_data->>'owner_id')::bigint,0)<=0 then raise exception 'Informe o responsável do Pipedrive'; end if;
 if jsonb_typeof(_data->'items') <> 'array' or jsonb_array_length(_data->'items') not between 1 and 300 then raise exception 'Selecione entre 1 e 300 oportunidades'; end if;
 if unit is not null then select nome_da_praca into unit_name from ops.unidades where id=unit; else unit_name:='Finance · Contratos Pipedrive'; end if;
 if unit_name is null then raise exception 'Unidade não identificada'; end if;
 select * into current_list from ops.monetizacao_listas where id=lid for update;
 if found then
  if not ops.monetizacao_list_scope(lid) then raise exception 'Lista fora do seu escopo'; end if;
  if current_list.revision <> coalesce((_data->>'revision')::integer,-1) then raise exception 'A lista mudou. Atualize antes de salvar'; end if;
  if exists(select 1 from ops.monetizacao_itens where list_id=lid and status in ('sending','sent','uncertain')) then raise exception 'Lista com envio registrado: crie outra lista para novas oportunidades'; end if;
 end if;
 if mode='validate' and (length(trim(coalesce(_data->>'partner','')))<3 or not coalesce((_data->>'origin_confirmed')::boolean,false)) then raise exception 'Registre o sócio e a confirmação da origem das oportunidades'; end if;
 select count(distinct (x->>'account_key',x->>'product')) into n from jsonb_array_elements(_data->'items') x;
 if n <> jsonb_array_length(_data->'items') then raise exception 'Empresa/produto duplicado na lista'; end if;
 for item in select * from jsonb_array_elements(_data->'items') loop
  select * into account from ops.monetizacao_contas where key=item->>'account_key';
  if not found or not ops.monetizacao_scope(account.unidade_ids) then raise exception 'Conta fora do seu escopo'; end if;
  if unit is not null and not (unit=any(account.unidade_ids)) then raise exception 'Conta não pertence à unidade selecionada'; end if;
  if item->>'product' not in ('consultoria','cella','finance') then raise exception 'Produto inválido'; end if;
  if unit is null and item->>'product'<>'finance' then raise exception 'Selecione uma unidade para Consultoria ou Cella'; end if;
  if mode='validate' then
   issue:=ops.monetizacao_offer_issue(account.perfil,item->>'product',coalesce(item->'review','{}'));
   if issue is not null then raise exception '%: %',account.perfil->>'name',issue; end if;
   if item->>'product'='consultoria' and coalesce((account.perfil->>'new_commercial')::boolean,false) and not coalesce((_data->>'scan_confirmed')::boolean,false) then raise exception 'Confirme a varredura anterior e a reoferta da carteira comercial'; end if;
  end if;
 end loop;
 insert into ops.monetizacao_listas(id,nome,unidade_id,unidade_nome,owner_id,created_by,partner,origin_confirmed,scan_confirmed,status,validated_by,validated_at)
 values(lid,trim(_data->>'nome'),unit,unit_name,(_data->>'owner_id')::bigint,auth.uid(),nullif(trim(_data->>'partner'),''),coalesce((_data->>'origin_confirmed')::boolean,false),coalesce((_data->>'scan_confirmed')::boolean,false),case when mode='validate' then 'validated' else 'draft' end,case when mode='validate' then auth.uid() end,case when mode='validate' then now() end)
 on conflict(id) do update set nome=excluded.nome,unidade_id=excluded.unidade_id,unidade_nome=excluded.unidade_nome,owner_id=excluded.owner_id,partner=excluded.partner,origin_confirmed=excluded.origin_confirmed,scan_confirmed=excluded.scan_confirmed,status=excluded.status,validated_by=excluded.validated_by,validated_at=excluded.validated_at,revision=monetizacao_listas.revision+1,updated_at=now();
 delete from ops.monetizacao_itens where list_id=lid and not exists(select 1 from jsonb_array_elements(_data->'items') i where i->>'account_key'=account_key and i->>'product'=product);
 for item in select * from jsonb_array_elements(_data->'items') loop
  insert into ops.monetizacao_itens(list_id,account_key,product,review,status)
  values(lid,item->>'account_key',item->>'product',coalesce(item->'review','{}'),case when mode='validate' then 'validated' else 'draft' end)
  on conflict(list_id,account_key,product) do update set review=excluded.review,status=excluded.status,reason=null;
 end loop;
 insert into ops.monetizacao_audit(list_id,action,actor_id,detail) values(lid,mode,auth.uid(),jsonb_build_object('revision',coalesce(current_list.revision,0)+1,'items',n,'partner',_data->>'partner'));
 return lid;
end $$;

create or replace function ops.monetizacao_claim(_item uuid) returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare i ops.monetizacao_itens; l ops.monetizacao_listas; a ops.monetizacao_contas; e ops.monetizacao_envios; issue text;
begin
 if not ops.monetizacao_can('send.monetizacao') then raise exception 'Sem permissão para enviar ao Pipedrive'; end if;
 select * into i from ops.monetizacao_itens where id=_item for update;
 select * into l from ops.monetizacao_listas where id=i.list_id for update;
 if l.id is null or not ops.monetizacao_list_scope(l.id) then raise exception 'Lista fora do escopo'; end if;
 select * into a from ops.monetizacao_contas where key=i.account_key for update;
 if not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do escopo'; end if;
 if i.status in ('sent','sending','uncertain') then return jsonb_build_object('claimed',false,'status',i.status,'deal_id',i.deal_id); end if;
 if l.status<>'validated' or i.status not in ('validated','blocked') then raise exception 'Valide a lista com o sócio antes do envio'; end if;
 issue:=ops.monetizacao_offer_issue(a.perfil,i.product,i.review);
 if issue is not null then raise exception 'O cadastro mudou: %',issue; end if;
 if exists(select 1 from ops.monetizacao_envios where account_key=i.account_key and product=i.product and status in ('sending','sent','uncertain')) then return jsonb_build_object('claimed',false,'status','blocked','reason','Já existe um envio desta empresa/produto. Confira o CRM.'); end if;
 insert into ops.monetizacao_envios(item_id,account_key,product,status,actor_id) values(i.id,i.account_key,i.product,'sending',auth.uid()) returning * into e;
 update ops.monetizacao_itens set status='sending',reason=null where id=i.id;
 insert into ops.monetizacao_audit(list_id,action,actor_id,detail) values(l.id,'send_claim',auth.uid(),jsonb_build_object('item_id',i.id,'nonce',e.id));
 return jsonb_build_object('claimed',true,'nonce',e.id,'item',to_jsonb(i),'account',a.perfil,'org_ids',a.org_ids,'owner_id',l.owner_id);
end $$;

-- Somente a integração no servidor pode confirmar um efeito remoto.
create or replace function ops.monetizacao_finish(_nonce uuid,_status text,_deal bigint,_org bigint,_reason text) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
declare e ops.monetizacao_envios;
begin
 if _status not in ('sent','uncertain','blocked') then raise exception 'Status inválido'; end if;
 select * into e from ops.monetizacao_envios where id=_nonce for update;
 if not found or e.status not in ('sending','uncertain') then raise exception 'Reserva não localizada ou já concluída'; end if;
 if _status='sent' and _deal is null then raise exception 'Negócio obrigatório'; end if;
 update ops.monetizacao_envios set status=_status,deal_id=_deal,org_id=_org,reason=_reason,updated_at=now() where id=_nonce;
 update ops.monetizacao_itens set status=_status,deal_id=_deal,reason=_reason where id=e.item_id;
 if _org is not null then update ops.monetizacao_contas set org_ids=array(select distinct unnest(org_ids||array[_org])),perfil=jsonb_set(perfil,'{orgs}',to_jsonb(array(select distinct unnest(org_ids||array[_org])))),updated_at=now() where key=e.account_key; end if;
 update ops.monetizacao_listas l set status='sent',updated_at=now(),revision=revision+1 where id=(select list_id from ops.monetizacao_itens where id=e.item_id) and not exists(select 1 from ops.monetizacao_itens i where i.list_id=l.id and i.status<>'sent');
 insert into ops.monetizacao_audit(list_id,action,actor_id,detail) select list_id,'send_'||_status,e.actor_id,jsonb_build_object('nonce',e.id,'deal_id',_deal,'reason',_reason) from ops.monetizacao_itens where id=e.item_id;
end $$;

create or replace function ops.monetizacao_save_record(_kind text,_title text,_body jsonb,_id uuid default null) returns uuid
language plpgsql security definer set search_path=ops,public,extensions as $$
declare rid uuid:=coalesce(_id,gen_random_uuid());
begin
 if not ops.monetizacao_can('view.monetizacao') or not ops.monetizacao_scope('{}') then raise exception 'Sem permissão para gerir a operação geral'; end if;
 if _kind not in ('pdi','roteiro','distribuicao','followup') or length(trim(_title)) not between 3 and 200 or pg_column_size(_body)>60000 then raise exception 'Registro inválido'; end if;
 insert into ops.monetizacao_registros(id,kind,title,body,created_by) values(rid,_kind,trim(_title),_body,auth.uid())
 on conflict(id) do update set title=excluded.title,body=excluded.body,updated_at=now();
 return rid;
end $$;
create or replace function ops.monetizacao_save_plan(_plan jsonb) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
begin
 if not ops.monetizacao_can('view.monetizacao') or not ops.monetizacao_scope('{}') then raise exception 'Sem permissão para gerir metas'; end if;
 if (_plan->>'month') !~ '^\d{4}-(0[1-9]|1[0-2])$' or coalesce((_plan->>'owner_id')::bigint,0)<=0 then raise exception 'Mês ou responsável inválido'; end if;
 if coalesce((_plan->>'capacity')::numeric,-1) not between 0 and 10000 then raise exception 'Capacidade inválida'; end if;
 if coalesce((_plan->>'meetings_capacity')::numeric,-1) not between 0 and 10000 or coalesce((_plan->>'target_contracts')::numeric,-1) not between 0 and 10000 or coalesce((_plan->>'daily_target')::numeric,-1) not between 0 and 1000 then raise exception 'Metas inválidas'; end if;
 if exists(select 1 from jsonb_each_text(_plan->'allocation') x where x.key not in ('cella','consultoria','finance') or x.value::numeric not between 0 and 10000) then raise exception 'Alocação inválida'; end if;
 if exists(select 1 from jsonb_each_text(_plan->'rates') x where x.key not in ('cella','consultoria','finance') or (x.value is not null and x.value::numeric not between 0 and 1)) then raise exception 'Hipótese de conversão inválida'; end if;
 if (coalesce((_plan->'allocation'->>'cella')::numeric,0)+coalesce((_plan->'allocation'->>'consultoria')::numeric,0)+coalesce((_plan->'allocation'->>'finance')::numeric,0)) > (_plan->>'capacity')::numeric then raise exception 'Alocação supera a capacidade'; end if;
 insert into ops.monetizacao_planos(month,owner_id,payload,updated_by) values(_plan->>'month',(_plan->>'owner_id')::bigint,_plan,auth.uid()) on conflict(month,owner_id) do update set payload=excluded.payload,updated_by=auth.uid(),updated_at=now();
end $$;

create or replace function ops.monetizacao_detail(_key text) returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare detail jsonb;
begin
 if not ops.monetizacao_can('view.aquario') or not exists(select 1 from ops.monetizacao_contas a where a.key=_key and ops.monetizacao_scope(a.unidade_ids)) then raise exception 'Conta fora do seu escopo'; end if;
 select detalhe into detail from ops.monetizacao_detalhes where account_key=_key;
 return jsonb_build_object('cnpjs',detail->'cnpjs','fields',detail->'fields','ecd_summary',detail->'ecd_summary','sources',detail->'sources','contacts',case when ops.monetizacao_can('view.contatos') then coalesce(detail->'contacts','[]') else '[]'::jsonb end,'contacts_restricted',not ops.monetizacao_can('view.contatos'));
end $$;
revoke all on function ops.monetizacao_detail(text) from public,anon;
grant execute on function ops.monetizacao_detail(text) to authenticated;

revoke all on function ops.monetizacao_can(text),ops.monetizacao_scope(integer[]),ops.monetizacao_list_scope(uuid),ops.monetizacao_save_list(jsonb),ops.monetizacao_claim(uuid),ops.monetizacao_finish(uuid,text,bigint,bigint,text),ops.monetizacao_save_record(text,text,jsonb,uuid),ops.monetizacao_save_plan(jsonb) from public,anon;
grant execute on function ops.monetizacao_can(text),ops.monetizacao_scope(integer[]),ops.monetizacao_list_scope(uuid),ops.monetizacao_save_list(jsonb),ops.monetizacao_claim(uuid),ops.monetizacao_save_record(text,text,jsonb,uuid),ops.monetizacao_save_plan(jsonb) to authenticated;
revoke all on function ops.monetizacao_finish(uuid,text,bigint,bigint,text) from authenticated;
grant execute on function ops.monetizacao_finish(uuid,text,bigint,bigint,text) to service_role;
notify pgrst,'reload schema';
commit;
