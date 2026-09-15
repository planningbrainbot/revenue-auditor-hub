begin;
-- Correções restritas às novas funções. Sem mudanças em papéis, áreas ou policies.
create or replace function ops.monetizacao_replace_snapshot(_run uuid,_snapshot jsonb) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
declare c jsonb; units integer[];
begin
 perform 1 from ops.monetizacao_sync where id and run_id=_run for update;
 if not found then raise exception 'Sincronização substituída por outra execução'; end if;
 if jsonb_typeof(_snapshot->'cards')<>'array' or jsonb_array_length(_snapshot->'cards') <> (_snapshot->>'verified_count')::integer then raise exception 'Contagem do CRM não foi conciliada'; end if;
 for c in select * from jsonb_array_elements(_snapshot->'cards') loop
  select array_agg(distinct u) into units from ops.monetizacao_contas a cross join unnest(a.unidade_ids) u where (c->>'org_id')::bigint=any(a.org_ids);
  insert into ops.monetizacao_deals(id,org_id,payload,unidade_ids) values((c->>'id')::bigint,(c->>'org_id')::bigint,c,coalesce(units,'{}')) on conflict(id) do update set org_id=excluded.org_id,payload=excluded.payload,unidade_ids=excluded.unidade_ids,updated_at=now();
 end loop;
 delete from ops.monetizacao_deals d where not exists(select 1 from jsonb_array_elements(_snapshot->'cards') entry where (entry->>'id')::bigint=d.id);
 -- Reserva enviada só é liberada para nova tentativa em mês posterior quando o negócio foi perdido.
 update ops.monetizacao_envios e set status='released',updated_at=now() from ops.monetizacao_deals d where d.id=e.deal_id and e.status='sent' and d.payload->>'status'='lost' and to_char(e.created_at at time zone 'America/Sao_Paulo','YYYY-MM')<to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM');
 update ops.monetizacao_sync set status='ok',measured_at=(_snapshot->>'measured_at')::timestamptz,stages=_snapshot->'stages',count=jsonb_array_length(_snapshot->'cards'),error=null where id;
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
notify pgrst,'reload schema';
commit;
