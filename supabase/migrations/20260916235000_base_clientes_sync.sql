begin;
set local lock_timeout = '3s';
set local statement_timeout = '25s';

-- Estado técnico de sincronização. Não constitui um segundo cadastro de empresas.
create table if not exists ops.base_sync_registros (
 fonte text not null check(fonte in ('pipefy_empresa','pipefy_contato')),
 registro_id text not null,
 empresa_id integer references ops.empresas(id),
 contato_id bigint references ops.contatos(id),
 fonte_at timestamptz,
 lido_em timestamptz not null,
 campos jsonb not null default '{}',
 vinculos jsonb not null default '{}',
 status text not null default 'ok' check(status in ('ok','ausente','pendente')),
 primary key(fonte,registro_id)
);
create table if not exists ops.base_sync_execucoes (
 id uuid primary key default gen_random_uuid(),
 fonte text not null,
 inicio timestamptz not null default now(),
 fim timestamptz,
 status text not null default 'running' check(status in ('running','ok','partial','error')),
 recebidos integer not null default 0,
 gravados integer not null default 0,
 divergencias integer not null default 0,
 erro text,
 detalhes jsonb not null default '{}'
);
create index if not exists base_sync_execucoes_fonte on ops.base_sync_execucoes(fonte,inicio desc);
create table if not exists ops.base_alteracoes (
 id uuid primary key default gen_random_uuid(),
 empresa_id integer not null references ops.empresas(id),
 campo text not null,
 valor_anterior jsonb,
 valor_proposto jsonb,
 ator_id uuid,
 motivo text not null,
 regra text,
 status text not null default 'pending' check(status in ('pending','sending','confirmed','conflict','error','cancelled')),
 criado_em timestamptz not null default now(),
 confirmado_em timestamptz,
 tentativas integer not null default 0,
 tentativa_em timestamptz,
 erro text
);
create index if not exists base_alteracoes_pendentes on ops.base_alteracoes(criado_em) where status in ('pending','sending');
create unique index if not exists base_alteracoes_campo_pendente on ops.base_alteracoes(empresa_id,campo) where status in ('pending','sending') or (status='error' and tentativas<5);

alter table ops.empresas add column if not exists unidade_id integer references ops.unidades(id);
alter table ops.empresas add column if not exists pipefy_sincronizado_em timestamptz;
alter table ops.empresas add column if not exists pipefy_atualizado_em timestamptz;
alter table ops.empresas add column if not exists pipefy_situacao text;

alter table ops.base_sync_registros enable row level security;
alter table ops.base_sync_execucoes enable row level security;
alter table ops.base_alteracoes enable row level security;
revoke all on ops.base_sync_registros,ops.base_sync_execucoes,ops.base_alteracoes from public,anon,authenticated;
grant all on ops.base_sync_registros,ops.base_sync_execucoes,ops.base_alteracoes to service_role;

-- O antigo trigger emitia uma chamada remota sem acompanhar resultado e só
-- enviava o primeiro campo alterado. O espelho passa a receber leitura confirmada.
drop trigger if exists trg_sync_empresa_to_pipefy on ops.empresas;
create or replace function ops.sync_empresa_to_pipefy() returns trigger
language plpgsql security definer set search_path=ops,public,extensions as $$
declare known jsonb; proposed jsonb; k text;
begin
 if new.pipefy_record_id is null or current_setting('planning.pipefy_ingest',true)='on' then return new; end if;
 select campos into known from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=new.pipefy_record_id and status in ('ok','pendente');
 if known is null then return new; end if;
 proposed:=to_jsonb(new);
 -- Outros produtores podem atualizar seus campos, mas não mudar silenciosamente
 -- os campos compartilhados de um registro que já foi confirmado no Pipefy.
 for k in select jsonb_object_keys(known) loop
  if proposed->k is distinct from to_jsonb(old)->k then
   raise exception 'Campo % pertence ao Pipefy. Use a fila de correção e aguarde confirmação.',k;
  end if;
 end loop;
 new:=jsonb_populate_record(new,proposed);
 return new;
end $$;
create trigger trg_sync_empresa_to_pipefy before update on ops.empresas
 for each row when(new.pipefy_record_id is not null) execute function ops.sync_empresa_to_pipefy();

create or replace function ops.base_ingest_pipefy(
 _fonte text,_registro_id text,_fonte_at timestamptz,_lido_em timestamptz,_campos jsonb,_vinculos jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=ops,public,extensions as $$
declare s ops.base_sync_registros; e ops.empresas; c ops.contatos; eid integer; cid bigint;
 matches integer[]; refs text[]; un integer; schema_keys text[]; mapped jsonb; effective jsonb:=_campos; pending jsonb:='{}'; col text; old_value jsonb; previous jsonb;
begin
 if _fonte not in ('pipefy_empresa','pipefy_contato') or nullif(_registro_id,'') is null then raise exception 'Fonte ou registro inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_fonte||':'||_registro_id,0));
 select * into s from ops.base_sync_registros where fonte=_fonte and registro_id=_registro_id for update;
 if s.registro_id is not null and ((s.fonte_at is not null and _fonte_at is not null and s.fonte_at>_fonte_at) or (s.fonte_at is not distinct from _fonte_at and s.lido_em>_lido_em)) then
  return jsonb_build_object('status','stale','empresa_id',s.empresa_id,'contato_id',s.contato_id);
 end if;
 if _fonte='pipefy_empresa' then
  schema_keys:=array['titulo','razao_social','cnpj','segmento','unidade','regime_tributario','email_fiscal','telefone','erp','origem_da_base','pipedrive_id','origem_venda'];
  if exists(select 1 from jsonb_object_keys(_campos) k where not(k=any(schema_keys))) then raise exception 'Campo de empresa fora do contrato'; end if;
  select * into e from ops.empresas where pipefy_record_id=_registro_id for update;
  if e.id is null and coalesce((_vinculos->>'cnpj_valido')::boolean,false) and length(regexp_replace(coalesce(_campos->>'cnpj',''),'\D','','g'))=14 then
   select array_agg(id) into matches from ops.empresas where pipefy_record_id is null and regexp_replace(coalesce(cnpj,''),'\D','','g')=regexp_replace(_campos->>'cnpj','\D','','g');
   if cardinality(matches)=1 then select * into e from ops.empresas where id=matches[1] for update; end if;
  end if;
  if _vinculos->>'unidade_id' ~ '^\d+$' then
   select id into un from ops.unidades where id=(_vinculos->>'unidade_id')::integer;
  end if;
  -- Primeiro espelhamento: não apaga dado enriquecido nem troca documento/vínculo
  -- sem revisão. O valor remoto fica no snapshot; a divergência é explícita.
  if e.id is not null then
   for col in select jsonb_object_keys(_campos) loop
    old_value:=to_jsonb(e)->col;
    if old_value is distinct from _campos->col and old_value not in ('null'::jsonb,'""'::jsonb)
     and ((s.registro_id is null and (coalesce(_campos->col,'null')='null'::jsonb or col in ('cnpj','pipedrive_id')))
       or (s.vinculos->'pendencias' ? col and s.campos->col is not distinct from _campos->col)) then
     effective:=jsonb_set(effective,array[col],old_value);
     pending:=pending||jsonb_build_object(col,jsonb_build_object('anterior',old_value,'pipefy',_campos->col));
    end if;
   end loop;
  end if;
  _vinculos:=_vinculos||jsonb_build_object('pendencias',pending);
  mapped:=effective||jsonb_build_object('pipefy_record_id',_registro_id,'unidade_id',un,'pipefy_sincronizado_em',_lido_em,'pipefy_atualizado_em',_fonte_at,'pipefy_situacao',case when pending='{}' then 'ok' else 'pendente' end);
  perform set_config('planning.pipefy_ingest','on',true);
  if e.id is null then
   e:=jsonb_populate_record(null::ops.empresas,mapped);
   insert into ops.empresas(pipefy_record_id,titulo,razao_social,cnpj,segmento,unidade,unidade_id,regime_tributario,email_fiscal,telefone,erp,origem_da_base,pipedrive_id,origem_venda,fonte_cadastro,tipo_unidade,pipefy_sincronizado_em,pipefy_atualizado_em,pipefy_situacao)
    values(_registro_id,e.titulo,e.razao_social,e.cnpj,e.segmento,e.unidade,un,e.regime_tributario,e.email_fiscal,e.telefone,e.erp,e.origem_da_base,e.pipedrive_id,e.origem_venda,'Pipefy',case when exists(select 1 from ops.unidades where id=un and tipo='regional') then 'franquia' else null end,_lido_em,_fonte_at,'ok') returning id into eid;
  else
   e:=jsonb_populate_record(e,mapped);
   update ops.empresas set pipefy_record_id=_registro_id,titulo=e.titulo,razao_social=e.razao_social,cnpj=e.cnpj,segmento=e.segmento,unidade=e.unidade,unidade_id=un,regime_tributario=e.regime_tributario,email_fiscal=e.email_fiscal,telefone=e.telefone,erp=e.erp,origem_da_base=e.origem_da_base,pipedrive_id=e.pipedrive_id,origem_venda=e.origem_venda,pipefy_sincronizado_em=_lido_em,pipefy_atualizado_em=_fonte_at,pipefy_situacao=case when pending='{}' then 'ok' else 'pendente' end where id=e.id returning id into eid;
  end if;
  perform set_config('planning.pipefy_ingest','off',true);
 else
  schema_keys:=array['nome_completo','cpf','email','whatsapp','cargo'];
  if exists(select 1 from jsonb_object_keys(_campos) k where not(k=any(schema_keys))) then raise exception 'Campo de contato fora do contrato'; end if;
  select * into c from ops.contatos where pipefy_record_id=_registro_id for update;
  select array_agg(value) into refs from jsonb_array_elements_text(coalesce(_vinculos->'empresas','[]')) v(value);
  if cardinality(refs)=1 then select id into eid from ops.empresas where pipefy_record_id=refs[1]; end if;
  if c.id is not null then
   for col in select jsonb_object_keys(_campos) loop
    old_value:=to_jsonb(c)->col;
    if old_value is distinct from _campos->col and old_value not in ('null'::jsonb,'""'::jsonb)
      and ((s.registro_id is null and coalesce(_campos->col,'null')='null'::jsonb)
        or (s.vinculos->'pendencias' ? col and s.campos->col is not distinct from _campos->col)) then
     effective:=jsonb_set(effective,array[col],old_value);pending:=pending||jsonb_build_object(col,jsonb_build_object('anterior',old_value,'pipefy',_campos->col));
    end if;
   end loop;
  end if;
  _vinculos:=_vinculos||jsonb_build_object('pendencias',pending);
  c:=jsonb_populate_record(c,effective);
  if c.id is null then
   insert into ops.contatos(pipefy_record_id,nome_completo,cpf,email,whatsapp,cargo,empresa_pipefy_record_id,empresa_id,synced_at)
    values(_registro_id,c.nome_completo,c.cpf,c.email,c.whatsapp,c.cargo,case when cardinality(refs)=1 then refs[1] else null end,eid,_lido_em) returning id into cid;
  else
   update ops.contatos set nome_completo=c.nome_completo,cpf=c.cpf,email=c.email,whatsapp=c.whatsapp,cargo=c.cargo,empresa_pipefy_record_id=case when cardinality(refs)=1 then refs[1] else null end,empresa_id=eid,synced_at=_lido_em,updated_at=now() where id=c.id returning id into cid;
  end if;
 end if;
 insert into ops.base_sync_registros(fonte,registro_id,empresa_id,contato_id,fonte_at,lido_em,campos,vinculos,status)
  values(_fonte,_registro_id,eid,cid,_fonte_at,_lido_em,_campos,_vinculos,case when pending='{}' then 'ok' else 'pendente' end)
 on conflict(fonte,registro_id) do update set empresa_id=excluded.empresa_id,contato_id=excluded.contato_id,fonte_at=excluded.fonte_at,lido_em=excluded.lido_em,campos=excluded.campos,vinculos=excluded.vinculos,status=excluded.status;
 update ops.monetizacao_sync set catalog_at=now() where id;
 return jsonb_build_object('status',case when pending='{}' then 'ok' else 'pending' end,'pending_fields',(select coalesce(jsonb_agg(k),'[]') from jsonb_object_keys(pending) k),'empresa_id',eid,'contato_id',cid);
end $$;
revoke all on function ops.base_ingest_pipefy(text,text,timestamptz,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function ops.base_ingest_pipefy(text,text,timestamptz,timestamptz,jsonb,jsonb) to service_role;

-- Leitura de alterações restrita ao mesmo escopo da empresa. Escrita remota é
-- feita pelo worker após confirmar valor anterior e reler o Pipefy.
create or replace function ops.base_propor_alteracao(_empresa integer,_campo text,_valor jsonb,_motivo text)
returns uuid language plpgsql security definer set search_path=ops,public,extensions as $$
declare e ops.empresas; ident uuid; col text; previous jsonb;
begin
 if auth.uid() is null or not ops.can('view.clientes') or not ops.has_role(auth.uid(),'admin'::ops.app_role) then raise exception 'Sem permissão para corrigir cadastro'; end if;
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
revoke all on function ops.base_propor_alteracao(integer,text,jsonb,text) from public,anon;
grant execute on function ops.base_propor_alteracao(integer,text,jsonb,text) to authenticated;


-- Lotes pequenos são atômicos; nenhum sucesso parcial é registrado como completo.
create or replace function ops.base_ingest_lote(_registros jsonb) returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare r jsonb; results jsonb:='[]';
begin
 if jsonb_array_length(_registros)>100 then raise exception 'Lote excede 100 registros'; end if;
 for r in select value from jsonb_array_elements(_registros) loop
  results:=results||jsonb_build_array(ops.base_ingest_pipefy(r->>'fonte',r->>'registro_id',(r->>'fonte_at')::timestamptz,(r->>'lido_em')::timestamptz,r->'campos',r->'vinculos'));
 end loop;
 return results;
end $$;
revoke all on function ops.base_ingest_lote(jsonb) from public,anon,authenticated;
grant execute on function ops.base_ingest_lote(jsonb) to service_role;

create or replace function ops.base_claim_alteracao() returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare a ops.base_alteracoes; e ops.empresas;
begin
 update ops.base_alteracoes set status='error',erro='Tentativas interrompidas; conferir a fonte antes de propor nova alteração.' where status='sending' and tentativas>=5 and tentativa_em<now()-interval '5 minutes';
 select * into a from ops.base_alteracoes where tentativas<5 and (status='pending' or (status in ('sending','error') and tentativa_em<now()-interval '5 minutes')) order by criado_em for update skip locked limit 1;
 if a.id is null then return null; end if;
 select * into e from ops.empresas where id=a.empresa_id;
 update ops.base_alteracoes set status='sending',tentativas=tentativas+1,tentativa_em=now() where id=a.id;
 return to_jsonb(a)||jsonb_build_object('pipefy_id',e.pipefy_record_id);
end $$;
revoke all on function ops.base_claim_alteracao() from public,anon,authenticated;
grant execute on function ops.base_claim_alteracao() to service_role;

-- Exclusão remota preserva os vínculos históricos e sinaliza indisponibilidade.
create or replace function ops.base_pipefy_ausente(_fonte text,_registro text,_at timestamptz) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
begin
 update ops.base_sync_registros set status='ausente',lido_em=_at where fonte=_fonte and registro_id=_registro and lido_em<=_at;
 if _fonte='pipefy_empresa' then
  update ops.empresas set pipefy_situacao='ausente',pipefy_sincronizado_em=_at where pipefy_record_id=_registro and coalesce(pipefy_sincronizado_em,'-infinity')<=_at;
 end if;
end $$;
revoke all on function ops.base_pipefy_ausente(text,text,timestamptz) from public,anon,authenticated;
grant execute on function ops.base_pipefy_ausente(text,text,timestamptz) to service_role;


create table if not exists ops.base_sync_jobs (
 kind text primary key check(kind in ('companies','contacts')), cursor text, run uuid references ops.base_sync_execucoes(id),
 lease uuid, lease_until timestamptz, due_at timestamptz not null default now()
);
alter table ops.base_sync_jobs enable row level security;
revoke all on ops.base_sync_jobs from public,anon,authenticated;
grant all on ops.base_sync_jobs to service_role;
insert into ops.base_sync_jobs(kind) values('companies'),('contacts') on conflict do nothing;
create or replace function ops.base_sync_claim() returns jsonb language plpgsql security definer set search_path=ops,public,extensions as $$
declare j ops.base_sync_jobs; rid uuid; lid uuid:=gen_random_uuid();
begin
 select * into j from ops.base_sync_jobs where due_at<=now() and coalesce(lease_until,'-infinity')<now() order by due_at,kind for update skip locked limit 1;
 if j.kind is null then return null; end if;
 rid:=j.run;
 if rid is null then insert into ops.base_sync_execucoes(fonte) values('reconcile:'||j.kind) returning id into rid; end if;
 update ops.base_sync_jobs set lease=lid,lease_until=now()+interval '3 minutes',run=rid where kind=j.kind;
 return jsonb_build_object('kind',j.kind,'cursor',j.cursor,'lease',lid);
end $$;
create or replace function ops.base_sync_progress(_kind text,_lease uuid,_cursor text,_recebidos integer,_gravados integer,_complete boolean,_erro text) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
declare j ops.base_sync_jobs;
begin
 select * into j from ops.base_sync_jobs where kind=_kind for update;
 if j.lease is distinct from _lease then raise exception 'Lease vencido'; end if;
 update ops.base_sync_execucoes set recebidos=recebidos+_recebidos,gravados=gravados+_gravados,erro=_erro,status=case when _erro is not null then 'error' when _complete and exists(select 1 from ops.base_sync_registros where fonte=case when _kind='companies' then 'pipefy_empresa' else 'pipefy_contato' end and status='pendente') then 'partial' when _complete then 'ok' else 'running' end,fim=case when _erro is not null or _complete then now() else null end where id=j.run;
 update ops.base_sync_jobs set cursor=_cursor,run=case when _complete then null else j.run end,lease=null,lease_until=null,due_at=now()+case when _complete then interval '15 minutes' when _erro is not null then interval '5 minutes' else interval '1 minute' end where kind=_kind;
end $$;
revoke all on function ops.base_sync_claim(),ops.base_sync_progress(text,uuid,text,integer,integer,boolean,text) from public,anon,authenticated;
grant execute on function ops.base_sync_claim(),ops.base_sync_progress(text,uuid,text,integer,integer,boolean,text) to service_role;


-- Uma edição de tela com dois campos não pode enfileirar apenas metade.
create or replace function ops.base_propor_alteracoes(_empresa integer,_campos jsonb,_motivo text) returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare field text; ids jsonb:='[]';
begin
 if jsonb_typeof(_campos)<>'object' or (select count(*) from jsonb_object_keys(_campos)) not between 1 and 5 then raise exception 'Campos inválidos';end if;
 for field in select jsonb_object_keys(_campos) loop
  ids:=ids||jsonb_build_array(ops.base_propor_alteracao(_empresa,field,_campos->field,_motivo));
 end loop;
 return ids;
end $$;
revoke all on function ops.base_propor_alteracoes(integer,jsonb,text) from public,anon;
grant execute on function ops.base_propor_alteracoes(integer,jsonb,text) to authenticated;

notify pgrst,'reload schema';
commit;
