-- Fatias 1 a 3 do PRD wiki/prds/2026-10-minha-unidade-atualizacao-da-base.md.
-- O sócio regional propõe mudanças na Base (contatos, contato do NPS, churn, não reconheço, cliente novo);
-- o CS decide; o base-clientes-sync grava no Pipefy o que foi aprovado. O card de churn é a exceção: nasce
-- na abertura, em Contatar ASAP, pela server function (R-12).
--
-- 1. Espelho: contatos.contato_nps e contatos.ativo (campos novos "Contato do NPS" e "Situação do contato"
--    do Stakeholder), empresas.situacao_cadastro (campo novo "Situação do cadastro" de Empresas).
-- 2. ops.base_pedidos, sem grant a authenticated: tudo por função SECURITY DEFINER.
-- 3. Chaves edit.base_unidade (área minha_unidade) e manage.base_pedidos (área clientes; decidir exige
--    ainda o papel cs, diretor ou admin, porque a área clientes também é de head, auditor e hunter).
-- 4. Regra da Base: empresa com "Situação do cadastro = Não é cliente" em todos os cadastros da conta
--    sai como não cliente (P-07).
-- 5. "Ver como" é só leitura (decisão de 22/09): abrir, cancelar e decidir recusam com a simulação ligada.

-- ============ 1. Espelho ============
alter table ops.contatos
  add column if not exists contato_nps boolean not null default false,
  add column if not exists ativo boolean not null default true;
grant select (contato_nps, ativo) on ops.contatos to authenticated;
alter table ops.empresas add column if not exists situacao_cadastro text;

-- WhatsApp pela R-07: só dígitos com DDI 55, DDD que existe, fixo de 8 dígitos começando de 2 a 8 ou
-- celular de 9 começando com 9. Devolve nulo quando não serve.
create or replace function ops.base_whatsapp(_v text)
 returns text language sql immutable parallel safe set search_path to 'ops', 'public'
as $$
 with d as (select regexp_replace(coalesce(_v,''),'\D','','g') x),
 l as (select case when x like '55%' and length(x) in (12,13) then substr(x,3)
                   when x like '0%' then substr(x,2) else x end y from d)
 select case when length(y) in (10,11)
   and substr(y,1,2)::integer = any(array[11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,
     41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,
     87,88,89,91,92,93,94,95,96,97,98,99])
   and ((length(y)=10 and substr(y,3,1) between '2' and '8') or (length(y)=11 and substr(y,3,1)='9'))
   and substr(y,3) !~ '^(\d)\1+$'
  then '55'||y end from l
$$;

-- Ingest do Pipefy: aceita os campos novos. O resto da função é o de antes.
create or replace function ops.base_ingest_pipefy(_fonte text, _registro_id text, _fonte_at timestamp with time zone, _lido_em timestamp with time zone, _campos jsonb, _vinculos jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops', 'public', 'extensions'
as $function$
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
  schema_keys:=array['titulo','razao_social','cnpj','segmento','unidade','regime_tributario','email_fiscal','telefone','erp','origem_da_base','pipedrive_id','origem_venda','situacao_cadastro'];
  if exists(select 1 from jsonb_object_keys(_campos) k where not(k=any(schema_keys))) then raise exception 'Campo de empresa fora do contrato'; end if;
  select * into e from ops.empresas where pipefy_record_id=_registro_id for update;
  if e.id is null and coalesce((_vinculos->>'cnpj_valido')::boolean,false) and length(regexp_replace(coalesce(_campos->>'cnpj',''),'\D','','g'))=14 then
   select array_agg(id) into matches from ops.empresas where pipefy_record_id is null and regexp_replace(coalesce(cnpj,''),'\D','','g')=regexp_replace(_campos->>'cnpj','\D','','g');
   if cardinality(matches)=1 then select * into e from ops.empresas where id=matches[1] for update; end if;
  end if;
  -- Empresa que o sync do Pipedrive criou no dia do ganho, antes de o cadastro chegar ao Pipefy: o
  -- cadastro do Pipefy traz o mesmo deal em pipedrive_id e adota a linha em vez de colidir na chave única.
  if e.id is null and nullif(trim(coalesce(_campos->>'pipedrive_id','')),'') is not null then
   select * into e from ops.empresas where pipefy_record_id is null and pipedrive_id=trim(_campos->>'pipedrive_id') for update;
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
  -- Um negócio pode estar repetido em cadastros da fonte. A tabela legada
  -- exige unicidade; manter o vínculo existente e registrar a colisão sem
  -- interromper a página inteira nem fundir empresas diferentes.
  if nullif(effective->>'pipedrive_id','') is not null and exists(
   select 1 from ops.empresas other where other.pipedrive_id=effective->>'pipedrive_id' and other.id is distinct from e.id
  ) then
   pending:=pending||jsonb_build_object('pipedrive_id',jsonb_build_object('anterior',e.pipedrive_id,'pipefy',_campos->'pipedrive_id','motivo','vinculo_ja_usado_por_outro_cadastro'));
   effective:=jsonb_set(effective,'{pipedrive_id}',coalesce(to_jsonb(e.pipedrive_id),'null'));
  end if;
  _vinculos:=_vinculos||jsonb_build_object('pendencias',pending);
  mapped:=effective||jsonb_build_object('pipefy_record_id',_registro_id,'unidade_id',un,'pipefy_sincronizado_em',_lido_em,'pipefy_atualizado_em',_fonte_at,'pipefy_situacao',case when pending='{}' then 'ok' else 'pendente' end);
  perform set_config('planning.pipefy_ingest','on',true);
  if e.id is null then
   e:=jsonb_populate_record(null::ops.empresas,mapped);
   insert into ops.empresas(pipefy_record_id,titulo,razao_social,cnpj,segmento,unidade,unidade_id,regime_tributario,email_fiscal,telefone,erp,origem_da_base,pipedrive_id,origem_venda,situacao_cadastro,fonte_cadastro,tipo_unidade,pipefy_sincronizado_em,pipefy_atualizado_em,pipefy_situacao)
    values(_registro_id,e.titulo,e.razao_social,e.cnpj,e.segmento,e.unidade,un,e.regime_tributario,e.email_fiscal,e.telefone,e.erp,e.origem_da_base,e.pipedrive_id,e.origem_venda,e.situacao_cadastro,'Pipefy',case when exists(select 1 from ops.unidades where id=un and tipo='regional') then 'franquia' else null end,_lido_em,_fonte_at,'ok') returning id into eid;
  else
   e:=jsonb_populate_record(e,mapped);
   update ops.empresas set pipefy_record_id=_registro_id,titulo=e.titulo,razao_social=e.razao_social,cnpj=e.cnpj,segmento=e.segmento,unidade=e.unidade,unidade_id=un,regime_tributario=e.regime_tributario,email_fiscal=e.email_fiscal,telefone=e.telefone,erp=e.erp,origem_da_base=e.origem_da_base,pipedrive_id=e.pipedrive_id,origem_venda=e.origem_venda,situacao_cadastro=e.situacao_cadastro,pipefy_sincronizado_em=_lido_em,pipefy_atualizado_em=_fonte_at,pipefy_situacao=case when pending='{}' then 'ok' else 'pendente' end where id=e.id returning id into eid;
  end if;
  perform set_config('planning.pipefy_ingest','off',true);
 else
  schema_keys:=array['nome_completo','cpf','email','whatsapp','cargo','contato_nps','ativo'];
  if exists(select 1 from jsonb_object_keys(_campos) k where not(k=any(schema_keys))) then raise exception 'Campo de contato fora do contrato'; end if;
  select * into c from ops.contatos where pipefy_record_id=_registro_id for update;
  select array_agg(value) into refs from jsonb_array_elements_text(coalesce(_vinculos->'empresas','[]')) v(value);
  if cardinality(refs)=1 then select id into eid from ops.empresas where pipefy_record_id=refs[1]; end if;
  if c.id is not null then
   for col in select jsonb_object_keys(_campos) loop
    -- As marcas novas (contato do NPS, situação) seguem o Pipefy sempre: não há dado local a proteger.
    continue when col in ('contato_nps','ativo');
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
   insert into ops.contatos(pipefy_record_id,nome_completo,cpf,email,whatsapp,cargo,contato_nps,ativo,empresa_pipefy_record_id,empresa_id,synced_at)
    values(_registro_id,c.nome_completo,c.cpf,c.email,c.whatsapp,c.cargo,coalesce(c.contato_nps,false),coalesce(c.ativo,true),case when cardinality(refs)=1 then refs[1] else null end,eid,_lido_em) returning id into cid;
  else
   update ops.contatos set nome_completo=c.nome_completo,cpf=c.cpf,email=c.email,whatsapp=c.whatsapp,cargo=c.cargo,contato_nps=coalesce(c.contato_nps,false),ativo=coalesce(c.ativo,true),empresa_pipefy_record_id=case when cardinality(refs)=1 then refs[1] else null end,empresa_id=eid,synced_at=_lido_em,updated_at=now() where id=c.id returning id into cid;
  end if;
 end if;
 insert into ops.base_sync_registros(fonte,registro_id,empresa_id,contato_id,fonte_at,lido_em,campos,vinculos,status)
  values(_fonte,_registro_id,eid,cid,_fonte_at,_lido_em,_campos,_vinculos,case when pending='{}' then 'ok' else 'pendente' end)
 on conflict(fonte,registro_id) do update set empresa_id=excluded.empresa_id,contato_id=excluded.contato_id,fonte_at=excluded.fonte_at,lido_em=excluded.lido_em,campos=excluded.campos,vinculos=excluded.vinculos,status=excluded.status;
 update ops.monetizacao_sync set catalog_at=now() where id;
 return jsonb_build_object('status',case when pending='{}' then 'ok' else 'pending' end,'pending_fields',(select coalesce(jsonb_agg(k),'[]') from jsonb_object_keys(pending) k),'empresa_id',eid,'contato_id',cid);
end $function$;

-- Contatos da Base (Confiança > Contatos): contato inativo some (R-11).
create or replace function ops.base_contatos()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'ops', 'public', 'extensions'
as $function$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select c.id,c.nome_completo name,c.email,c.whatsapp phone,c.cargo role,array_agg(distinct a.key) accounts
 from ops.contatos c join ops.monetizacao_contas a on c.empresa_id=any(a.empresa_ids)
 left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where auth.uid() is not null and c.ativo and ops.monetizacao_can('view.contatos') and (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario')) and ops.monetizacao_scope(a.unidade_ids) and s.status is distinct from 'ausente'
   and ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(a.key))
 group by c.id,c.nome_completo,c.email,c.whatsapp,c.cargo
 ) x
$function$;

-- ============ 4. Regra da Base: "não é cliente" confirmado pelo CS ============
create or replace function ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 returns table(key text, unidade_ids integer[], ficha jsonb)
 language sql
 stable security definer
 set search_path to 'ops', 'public', 'extensions'
as $function$
 -- Regra de cliente (15/10): a ficha leva a situação (cliente, a confirmar, não é cliente, ex-cliente, fornecedor, grupo)
 -- e o grau de confiança de quem é cliente, calculados sobre a própria ficha.
 select f.key, f.unidade_ids, f.ficha || jsonb_build_object('situacao', ops.base_conta_situacao(f.ficha, f.perfil))
 from (
   select a.key, a.unidade_ids, a.perfil, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
     'distrato',s.distrato,'consultoria',s.consultoria,'omie',om.omie,'prova',pv.prova,
     -- P-07 (28/10): todos os cadastros da conta em Empresas com "Situação do cadastro = Não é cliente".
     'nao_cliente_confirmado', cardinality(a.empresa_ids)>0 and not exists(
        select 1 from ops.empresas e where e.id=any(a.empresa_ids) and e.situacao_cadastro is distinct from 'Não é cliente')) ficha
   from ops.base_conta_estado a
   left join ops.base_conta_sinais(_keys) s on s.key = a.key
   left join lateral ops.base_conta_omie_tags(a.cnpjs) om on true  -- tags do cadastro do Omie
   left join lateral (select ops.base_conta_prova(a.cnpjs, a.empresa_ids, a.ecd_registros, a.perfil, om.omie) prova) pv on true  -- prova de cliente (01/10)
   where _keys is null or a.key=any(_keys)
 ) f
$function$;

create or replace function ops.base_conta_situacao(_ficha jsonb, _perfil jsonb)
 returns jsonb
 language plpgsql
 stable parallel safe
 set search_path to 'ops', 'public', 'extensions'
as $function$
declare
  pv jsonb := coalesce(_ficha->'prova', '{}'::jsonb);
  nivel text := pv->>'nivel';
  provas jsonb := coalesce(pv->'provas', '[]'::jsonb);
  classe text := _ficha->'omie'->>'classe';
  so_matriz boolean := _ficha->'omie'->>'classe' = 'cliente'
    and coalesce(_ficha->'omie'->'cliente_em', '[]'::jsonb) = '["Planning Partners (Matriz)"]'::jsonb;
  criterios text[] := '{}';
  receita text := lower(coalesce(_perfil->>'situacao_receita', ''));
  recente boolean;
  grau integer;
begin
  if _ficha->'distrato'->>'estado' = 'concluido' then
    return jsonb_build_object('estado', 'ex_cliente', 'grau', null, 'rotulo', 'Ex-cliente', 'cita', 'nao',
      'motivo', 'Ex-cliente: distrato concluído na Central de Tratativas.');
  end if;
  -- "Nunca foi cliente" aprovado pelo CS (PRD da atualização da base, R-16 e P-07, 28/10/2026).
  if coalesce((_ficha->>'nao_cliente_confirmado')::boolean, false) then
    return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
      'motivo', 'Não é cliente: a unidade informou que nunca atendeu a empresa e o CS confirmou (Situação do cadastro em Empresas).');
  end if;
  if nivel = 'grupo' then
    return jsonb_build_object('estado', 'grupo', 'grau', null, 'rotulo', 'Empresa do grupo', 'cita', 'nao',
      'motivo', coalesce(pv->>'motivo', 'Empresa do grupo Planning.'));
  end if;
  if nivel = 'fornecedor' or classe in ('fornecedor', 'cliente_e_fornecedor') then
    return jsonb_build_object('estado', 'fornecedor', 'grau', null, 'rotulo', 'Fornecedor', 'cita', 'nao',
      'motivo', case
        when classe = 'cliente_e_fornecedor' then 'Fornecedor: tem as tags Cliente e Fornecedor no Omie, e qualquer tag Fornecedor tira da Base.'
        when classe = 'fornecedor' then 'Fornecedor: tag Fornecedor no Omie.'
        else coalesce(pv->>'motivo', 'Fornecedor.') end);
  end if;
  -- Contrato cancelado no Omie (Pedro, 27/10): quem só tem contrato cancelado e não pagou nos últimos 90 dias é
  -- ex-cliente, com a vigência final como data de saída. Vem depois de grupo e fornecedor, como o distrato vem antes.
  if coalesce((pv->>'contrato_cancelado')::boolean, false)
     and not coalesce((pv->>'recebido_em')::date >= current_date - 90, false)
     and not coalesce((pv->>'faturado_grupo_em')::date >= date_trunc('month', current_date - 90)::date, false) then
    return jsonb_build_object('estado', 'ex_cliente', 'grau', null, 'rotulo', 'Ex-cliente', 'cita', 'nao',
      'saida_em', pv->>'contrato_fim',
      'motivo', 'Ex-cliente: contrato cancelado no Omie' ||
        coalesce(' (fim em ' || to_char((pv->>'contrato_fim')::date, 'MM/YYYY') || ')', '') ||
        ' e sem pagamento nos últimos 90 dias.');
  end if;
  if provas ? 'ganho_pipedrive' then criterios := array_append(criterios, 'negócio ganho no Pipedrive'); end if;
  if provas ?| array['contrato', 'receber', 'faturado_grupo'] then
    criterios := array_append(criterios, 'contrato ou recebimento no Omie');
  end if;
  if jsonb_array_length(coalesce(_ficha->'empresa_ids', '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(_ficha->'pipefy_ids', '[]'::jsonb)) > 0 then
    criterios := array_append(criterios, 'base de clientes do Pipefy');
  end if;
  if classe = 'cliente' and not so_matriz then criterios := array_append(criterios, 'tag Cliente no Omie da unidade'); end if;
  if cardinality(criterios) > 0 then
    recente := coalesce((pv->>'contrato_ativo')::boolean, false)
      or coalesce((pv->>'recebido_em')::date >= current_date - 90, false)
      or coalesce((pv->>'faturado_grupo_em')::date >= date_trunc('month', current_date - 90)::date, false);
    grau := case when recente then 4 when nivel = 'comprovado' then 3 when _ficha->>'origin' = 'antiga' then 2 else 1 end;
    return jsonb_build_object('estado', 'cliente', 'grau', grau, 'cita', 'sim', 'criterios', to_jsonb(criterios),
      'rotulo', case grau when 4 then 'Pagamento visto' when 3 then 'Prova de cliente' when 2 then 'Base Antiga sem prova'
                          else 'Base Nova sem prova' end,
      'motivo', 'Cliente pela regra: ' || array_to_string(criterios, ', ') || '.');
  end if;
  if so_matriz then
    if receita in ('baixada', 'inapta', 'suspensa', 'nula') then
      return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
        'motivo', 'Não é cliente: só a tag Cliente do Omie da Matriz, com CNPJ ' || receita || ' na Receita.');
    end if;
    -- Lote da Matriz com CNPJ ativo (Pedro, 15/10 à tarde): conta como cliente, no grau mais baixo. Continua fora das
    -- ofertas (soTagDaMatriz, 06/10) até o sócio de Goiânia confirmar.
    return jsonb_build_object('estado', 'cliente', 'grau', case when _ficha->>'origin' = 'antiga' then 2 else 1 end,
      'cita', 'sim', 'criterios', to_jsonb(array['tag Cliente no Omie da Matriz']),
      'rotulo', case when _ficha->>'origin' = 'antiga' then 'Base Antiga sem prova' else 'Base Nova sem prova' end,
      'motivo', 'Cliente pela regra: tag Cliente no Omie da Matriz (lote de mar/2025), sem faturamento do grupo em 2026. O sócio de Goiânia confirma.');
  end if;
  return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
    'motivo', 'Não é cliente: sem negócio ganho, base do Pipefy, tag Cliente, contrato nem recebimento' ||
      case when provas ? 'ecd' then ' (só a ECD na Planning)' else '' end || '.');
end $function$;

-- ============ 2. Pedidos ============
create table if not exists ops.base_pedidos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('contato_incluir','contato_editar','contato_desativar','contato_nps','churn','nao_reconheco','cliente_incluir')),
  unidade_id integer references ops.unidades(id),
  conta_key text,
  conta_nome text,
  empresa_id integer,
  contato_id bigint,
  pedido_pai uuid references ops.base_pedidos(id),
  chave_unica text not null,
  proposto jsonb not null default '{}',
  foto jsonb,
  situacao text not null default 'aberto' check (situacao in ('aberto','aprovado','enviando','concluido','erro','recusado','cancelado')),
  motivo_recusa text,
  pipefy_ref text,
  erro text,
  tentativas integer not null default 0,
  tentativa_em timestamptz,
  resultado jsonb,
  criado_por uuid not null,
  criado_em timestamptz not null default now(),
  decidido_por uuid,
  decidido_em timestamptz,
  concluido_em timestamptz
);
-- R-03: um pedido em andamento por chave. `erro` com tentativas sobrando também segura a chave, conferido na abertura.
create unique index if not exists base_pedidos_chave_em_andamento on ops.base_pedidos(chave_unica)
  where situacao in ('aberto','aprovado','enviando');
create index if not exists base_pedidos_unidade on ops.base_pedidos(unidade_id, criado_em desc);
create index if not exists base_pedidos_situacao on ops.base_pedidos(situacao, criado_em);
alter table ops.base_pedidos enable row level security;
revoke all on ops.base_pedidos from anon, authenticated;

-- Consultas de CNPJ na BrasilAPI por pessoa (R-17: 30 por hora).
create table if not exists ops.base_cnpj_consultas (
  id bigserial primary key,
  user_id uuid not null,
  cnpj text not null,
  em timestamptz not null default now()
);
create index if not exists base_cnpj_consultas_user on ops.base_cnpj_consultas(user_id, em desc);
alter table ops.base_cnpj_consultas enable row level security;
revoke all on ops.base_cnpj_consultas from anon, authenticated;

-- ============ 3. Chaves ============
insert into ops.area_chaves(area, permission_key) values
  ('minha_unidade','edit.base_unidade'),
  ('clientes','manage.base_pedidos')
on conflict do nothing;
insert into ops.role_permissions(role, permission_key, allowed) values
  ('socio','edit.base_unidade',true), ('socio_regional','edit.base_unidade',true),
  ('cs','manage.base_pedidos',true), ('diretor','manage.base_pedidos',true), ('admin','manage.base_pedidos',true)
on conflict do nothing;

create or replace function ops.base_pedido_pode_abrir()
 returns boolean language sql stable security definer set search_path to 'ops', 'public'
as $$ select auth.uid() is not null and ops.monetizacao_can('edit.base_unidade') $$;

-- Decidir: a chave e um papel da matriz (cs, diretor, admin) ou ser admin da área Base de clientes.
create or replace function ops.base_pedido_pode_decidir()
 returns boolean language sql stable security definer set search_path to 'ops', 'public'
as $$
 select auth.uid() is not null and not ops.ver_como_ativa() and ops.monetizacao_can('manage.base_pedidos')
   and (exists(select 1 from ops.user_roles r where r.user_id=auth.uid() and r.role::text in ('cs','diretor','admin'))
        or exists(select 1 from ops.area_admins a where a.user_id=auth.uid() and a.area='clientes'))
$$;

create or replace function ops.base_pedido_permissoes()
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$
 select jsonb_build_object('abrir', ops.base_pedido_pode_abrir(), 'decidir', ops.base_pedido_pode_decidir(),
   'ver_como', ops.ver_como_ativa())
$$;

-- Unidade do pedido: a primeira unidade da conta que está no escopo de quem pede.
create or replace function ops.base_pedido_unidade(_ids integer[])
 returns integer language sql stable security definer set search_path to 'ops', 'public'
as $$
 select u from unnest(_ids) u
 where coalesce((select todas_unidades from ops.usuario_escopo where user_id=auth.uid()),false)
    or u in (select ops.minhas_unidades())
 order by u limit 1
$$;

create or replace function ops.base_pedido_abrir(_tipo text, _conta_key text, _contato_id bigint DEFAULT NULL, _proposto jsonb DEFAULT '{}'::jsonb, _pai uuid DEFAULT NULL)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops', 'public', 'extensions'
as $function$
declare
 conta ops.base_carteira; pai ops.base_pedidos; ct ops.contatos; p ops.base_pedidos;
 unidade integer; empresas integer[] := '{}'; chave text; prop jsonb := coalesce(_proposto,'{}'); foto jsonb;
 w text; nome text; email text; cnpj text; outro text; dados jsonb := '{}';
begin
 if auth.uid() is null or not ops.base_pedido_pode_abrir() then raise exception 'Seu acesso não permite pedir mudanças na base.'; end if;
 if ops.ver_como_ativa() then raise exception 'No modo "ver como" a tela é só leitura: nenhum pedido é aberto.'; end if;
 if _tipo not in ('contato_incluir','contato_editar','contato_desativar','contato_nps','churn','nao_reconheco','cliente_incluir') then
  raise exception 'Tipo de pedido inválido.';
 end if;

 -- De qual cliente é o pedido
 if _pai is not null then
  if _tipo <> 'contato_incluir' then raise exception 'Cliente declarado só aceita inclusão de contato antes da aprovação.'; end if;
  select * into pai from ops.base_pedidos where id=_pai;
  if pai.id is null or pai.tipo <> 'cliente_incluir' or pai.situacao <> 'aberto' then raise exception 'O cliente declarado não está mais aberto para contatos.'; end if;
  if not ops.monetizacao_scope(array[pai.unidade_id]) then raise exception 'Cliente fora da sua unidade.'; end if;
  unidade := pai.unidade_id;
  foto := jsonb_build_object('cliente', pai.conta_nome);
 elsif _tipo <> 'cliente_incluir' then
  select * into conta from ops.base_carteira where key=_conta_key;
  if conta.key is null or not ops.monetizacao_scope(conta.unidade_ids) then raise exception 'Cliente fora da sua unidade.'; end if;
  if coalesce(conta.base->'situacao'->>'estado','') <> 'cliente' then raise exception 'Só dá para pedir sobre quem é cliente pela regra da Base.'; end if;
  unidade := ops.base_pedido_unidade(conta.unidade_ids);
  select coalesce(m.empresa_ids,'{}') into empresas from ops.monetizacao_contas m where m.key=conta.key;
  foto := jsonb_build_object('cliente', conta.perfil->>'name', 'situacao', conta.base->'situacao'->>'rotulo');
 end if;

 if _tipo like 'contato_%' then
  if _tipo <> 'contato_incluir' then
   select * into ct from ops.contatos where id=_contato_id;
   if ct.id is null or not ct.ativo or not (ct.empresa_id = any(empresas)) then raise exception 'Este contato não é deste cliente.'; end if;
   foto := foto || jsonb_build_object('contato', jsonb_build_object('nome',ct.nome_completo,'cargo',ct.cargo,'whatsapp',ct.whatsapp,'email',ct.email,'contato_nps',ct.contato_nps));
  end if;
  if _tipo in ('contato_incluir','contato_editar') then
   nome := trim(coalesce(prop->>'nome',''));
   if length(nome) < 3 then raise exception 'Informe o nome do contato (3 letras ou mais).'; end if;
   w := ops.base_whatsapp(prop->>'whatsapp');
   if w is null then raise exception 'WhatsApp inválido: informe DDD e número (fixo com 8 dígitos ou celular com 9, começando com 9).'; end if;
   email := nullif(trim(coalesce(prop->>'email','')),'');
   if email is not null and email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'E-mail inválido.'; end if;
   select c.nome_completo into outro from ops.contatos c
    where c.ativo and c.empresa_id = any(empresas) and ops.base_whatsapp(c.whatsapp) = w and c.id is distinct from _contato_id limit 1;
   if outro is not null then raise exception 'Esse WhatsApp já é de % neste cliente.', outro; end if;
   if _pai is not null and exists(select 1 from ops.base_pedidos x where x.pedido_pai=_pai and x.situacao='aberto' and x.proposto->>'whatsapp'=w) then
    raise exception 'Esse WhatsApp já foi incluído neste cliente declarado.';
   end if;
   -- O contato é pendurado no cadastro de Empresas; sem cadastro, o envio cria um pelo CNPJ da conta.
   if _tipo='contato_incluir' and _pai is null and jsonb_array_length(coalesce(conta.base->'cnpjs','[]'))=0
      and not exists(select 1 from ops.empresas e where e.id=any(empresas) and e.pipefy_record_id is not null) then
    raise exception 'Este cliente está sem CNPJ e sem cadastro em Empresas: fale com o CS para corrigir o cadastro antes.';
   end if;
   prop := jsonb_build_object('nome',nome,'cargo',nullif(trim(coalesce(prop->>'cargo','')),''),'whatsapp',w,'email',email,
     'contato_nps',coalesce((prop->>'contato_nps')::boolean,false));
   chave := case when _tipo='contato_incluir' then 'contato_incluir:'||coalesce(_conta_key,_pai::text)||':'||w else 'contato_editar:'||_contato_id end;
  elsif _tipo = 'contato_nps' then
   if ops.base_whatsapp(ct.whatsapp) is null then raise exception 'O contato do NPS precisa ter WhatsApp válido. Edite o contato antes.'; end if;
   if ct.contato_nps then raise exception 'Este já é o contato do NPS.'; end if;
   prop := jsonb_build_object('nome',ct.nome_completo); chave := 'contato_nps:'||_conta_key;
  else
   if coalesce(prop->>'motivo','') not in ('Saiu da empresa','Não é mais o responsável','Contato errado') then raise exception 'Escolha o motivo.'; end if;
   prop := jsonb_build_object('nome',ct.nome_completo,'motivo',prop->>'motivo'); chave := 'contato_desativar:'||_contato_id;
  end if;
 elsif _tipo = 'churn' then
  if coalesce(prop->>'data','') !~ '^\d{4}-\d{2}-\d{2}$' or (prop->>'data')::date > current_date then raise exception 'Informe a data do churn (hoje ou antes).'; end if;
  if coalesce(prop->>'categoria','') not in ('Inadimplência','Insatisfação com o serviço','Encerramento das atividades','Trocou de fornecedor/concorrente','Motivo financeiro do cliente','Outro') then
   raise exception 'Escolha a categoria do churn.';
  end if;
  if length(trim(coalesce(prop->>'relato',''))) < 10 then raise exception 'Conte o que aconteceu (10 letras ou mais).'; end if;
  prop := jsonb_build_object('data',prop->>'data','categoria',prop->>'categoria','relato',trim(prop->>'relato'));
  chave := 'churn:'||_conta_key;
  -- O que o card leva (R-12): unidade, MRR da cascata, deal do Pipedrive e o cadastro em Empresas.
  select jsonb_build_object(
    'unidade', (select nome_da_praca from ops.unidades where id=unidade),
    'mrr', (select coalesce(sum(v.mrr_mensal),0) from ops.v_cliente_mrr v where v.empresa_id = any(empresas)),
    'deal', (select e.pipedrive_id from ops.empresas e where e.id = any(empresas) and nullif(e.pipedrive_id,'') is not null order by e.id limit 1),
    'empresa_pipefy', (select e.pipefy_record_id from ops.empresas e where e.id = any(empresas) and e.pipefy_record_id is not null order by e.id limit 1),
    'nome', conta.perfil->>'name', 'cnpjs', conta.base->'cnpjs') into dados;
 elsif _tipo = 'nao_reconheco' then
  if coalesce(prop->>'motivo','') not in ('nunca','outra_unidade','mesma_empresa') then raise exception 'Escolha uma das opções.'; end if;
  if prop->>'motivo' = 'outra_unidade' then
   if coalesce(prop->>'unidade_id','') !~ '^\d+$' or not exists(select 1 from ops.unidades u where u.id=(prop->>'unidade_id')::integer and u.tipo='regional' and u.id <> unidade) then
    raise exception 'Diga qual é a outra unidade.';
   end if;
   prop := prop || jsonb_build_object('unidade_nome',(select nome_da_praca from ops.unidades where id=(prop->>'unidade_id')::integer));
  elsif prop->>'motivo' = 'mesma_empresa' then
   if not exists(select 1 from ops.base_carteira o where o.key=prop->>'conta_key' and o.key<>_conta_key and ops.monetizacao_scope(o.unidade_ids)) then
    raise exception 'Diga qual é a outra linha da base.';
   end if;
   prop := prop || jsonb_build_object('conta_nome',(select perfil->>'name' from ops.base_carteira where key=prop->>'conta_key'));
  end if;
  prop := jsonb_strip_nulls(jsonb_build_object('motivo',prop->>'motivo','unidade_id',prop->'unidade_id','unidade_nome',prop->'unidade_nome',
    'conta_key',prop->'conta_key','conta_nome',prop->'conta_nome','obs',nullif(trim(coalesce(prop->>'obs','')),'')));
  chave := 'nao_reconheco:'||_conta_key;
 else -- cliente_incluir
  cnpj := ops.base_cnpj(prop->>'cnpj');
  if cnpj is null then raise exception 'CNPJ inválido.'; end if;
  if exists(select 1 from ops.base_conta_estado a join ops.base_carteira c on c.key=a.key
            where cnpj = any(a.cnpjs) and c.base->'situacao'->>'estado' = 'cliente') then
   raise exception 'Esse CNPJ já está cadastrado na rede como cliente. Se o cliente é seu, fale com o CS.';
  end if;
  if length(trim(coalesce(prop->>'razao_social',''))) < 3 then raise exception 'Consulte o CNPJ antes de incluir.'; end if;
  unidade := coalesce(
    (select u from ops.minhas_unidades() u where coalesce(prop->>'unidade_id','') ~ '^\d+$' and u=(prop->>'unidade_id')::integer),
    (select u from ops.minhas_unidades() u order by u limit 1),
    case when ops.monetizacao_scope('{}') and coalesce(prop->>'unidade_id','') ~ '^\d+$' then (prop->>'unidade_id')::integer end);
  if unidade is null or not exists(select 1 from ops.unidades where id=unidade and tipo='regional') then raise exception 'Escolha a unidade do cliente.'; end if;
  prop := jsonb_strip_nulls(jsonb_build_object('cnpj',cnpj,'razao_social',trim(prop->>'razao_social'),'nome_fantasia',nullif(trim(coalesce(prop->>'nome_fantasia','')),''),
    'uf',prop->>'uf','cidade',prop->>'cidade','situacao_receita',prop->>'situacao_receita',
    'desde',case when coalesce(prop->>'desde','') ~ '^\d{4}-\d{2}$' then prop->>'desde' end));
  chave := 'cliente_incluir:'||cnpj;
  foto := jsonb_build_object('cliente', prop->>'razao_social');
 end if;

 -- R-03: o pedido com erro que ainda vai ser tentado de novo segura a chave.
 if exists(select 1 from ops.base_pedidos x where x.chave_unica=chave and x.situacao='erro' and x.tentativas<5 and x.tipo<>'churn') then
  raise exception 'Já existe um pedido em andamento para isso.';
 end if;
 begin
  insert into ops.base_pedidos(tipo,unidade_id,conta_key,conta_nome,empresa_id,contato_id,pedido_pai,chave_unica,proposto,foto,criado_por)
   values(_tipo,unidade,case when _tipo='cliente_incluir' or _pai is not null then null else _conta_key end,
     coalesce(conta.perfil->>'name', pai.conta_nome, prop->>'nome_fantasia', prop->>'razao_social'),
     ct.empresa_id,_contato_id,_pai,chave,prop,foto,auth.uid())
   returning * into p;
 exception when unique_violation then
  raise exception '%', case when _tipo='cliente_incluir' then 'Já existe um pedido para este CNPJ.' else 'Já existe um pedido em andamento para isso.' end;
 end;
 return to_jsonb(p) || jsonb_build_object('card', dados);
end $function$;

-- O card de churn é criado pela server function com o token do servidor (R-12); ela devolve o card aqui.
create or replace function ops.base_pedido_churn_card(_id uuid, _card text, _erro text DEFAULT NULL)
 returns void language plpgsql security definer set search_path to 'ops', 'public'
as $function$
begin
 if _card is not null then
  update ops.base_pedidos set pipefy_ref=_card
   where id=_id and tipo='churn' and criado_por=auth.uid() and situacao='aberto' and pipefy_ref is null;
 else
  update ops.base_pedidos set situacao='erro', erro=left(coalesce(_erro,'Falha ao criar o card no Pipefy.'),500), tentativas=5
   where id=_id and tipo='churn' and criado_por=auth.uid() and situacao='aberto' and pipefy_ref is null;
 end if;
 if not found then raise exception 'Pedido de churn não encontrado.'; end if;
end $function$;

create or replace function ops.base_pedido_cancelar(_id uuid)
 returns void language plpgsql security definer set search_path to 'ops', 'public'
as $function$
declare p ops.base_pedidos;
begin
 if auth.uid() is null then raise exception 'Sessão expirada.'; end if;
 if ops.ver_como_ativa() then raise exception 'No modo "ver como" a tela é só leitura.'; end if;
 select * into p from ops.base_pedidos where id=_id;
 if p.id is null or p.criado_por <> auth.uid() then raise exception 'Só quem abriu o pedido pode cancelar.'; end if;
 if p.tipo='churn' and p.pipefy_ref is not null then raise exception 'O churn já está com o CS na tratativa: fale com o CS para encerrar.'; end if;
 update ops.base_pedidos set situacao='cancelado', decidido_em=now() where id=_id and situacao='aberto';
 if not found then raise exception 'O pedido já foi decidido.'; end if;
 update ops.base_pedidos set situacao='cancelado', decidido_em=now() where pedido_pai=_id and situacao='aberto';
end $function$;

-- Linha de pedido para as telas: o que muda, quem pediu, e o "agora" do contato para a R-05.
create or replace function ops.base_pedido_json(p ops.base_pedidos)
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$
 select (to_jsonb(p) - 'chave_unica') || jsonb_build_object(
  'unidade_nome', (select nome_da_praca from ops.unidades where id=p.unidade_id),
  'autor', (select coalesce(nullif(pr.nome,''), pr.email) from public.profiles pr where pr.user_id=p.criado_por),
  'decisor', (select coalesce(nullif(pr.nome,''), pr.email) from public.profiles pr where pr.user_id=p.decidido_por),
  'agora', (select jsonb_build_object('nome',c.nome_completo,'cargo',c.cargo,'whatsapp',c.whatsapp,'email',c.email,'contato_nps',c.contato_nps,'ativo',c.ativo)
            from ops.contatos c where c.id=p.contato_id),
  'filhos', (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'situacao',f.situacao,'proposto',f.proposto) order by f.criado_em),'[]')
             from ops.base_pedidos f where f.pedido_pai=p.id))
$$;

-- Meus pedidos: os pedidos das unidades de quem pede (o sócio vê também os do outro sócio da mesma unidade).
create or replace function ops.base_pedidos_meus()
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$
 select coalesce(jsonb_agg(ops.base_pedido_json(p) order by p.criado_em desc),'[]')
 from (select * from ops.base_pedidos p
       where auth.uid() is not null and ops.base_pedido_pode_abrir() and p.pedido_pai is null
         and (p.criado_por=auth.uid() or p.unidade_id in (select ops.minhas_unidades()))
       order by p.criado_em desc limit 300) p
$$;

-- Fila do CS. `_situacao`: 'abertos' (para decidir), 'andamento' (aprovados ainda indo ao Pipefy e churn com o CS)
-- ou 'decididos'.
create or replace function ops.base_pedidos_fila(_situacao text DEFAULT 'abertos')
 returns jsonb language plpgsql stable security definer set search_path to 'ops', 'public'
as $$
begin
 if not ops.base_pedido_pode_decidir() then raise exception 'Seu acesso não permite decidir pedidos das unidades.'; end if;
 return (select coalesce(jsonb_agg(ops.base_pedido_json(p) order by p.criado_em),'[]')
  from (select * from ops.base_pedidos p where p.pedido_pai is null and case _situacao
         when 'abertos' then p.situacao='aberto' and p.tipo<>'churn'
         when 'andamento' then p.situacao in ('aprovado','enviando','erro') or (p.tipo='churn' and p.situacao='aberto')
         else p.situacao in ('concluido','recusado','cancelado') and p.criado_em > now()-interval '90 days' end
        order by p.criado_em desc limit 500) p);
end $$;

create or replace function ops.base_pedido_decidir(_id uuid, _aprovar boolean, _motivo text DEFAULT NULL, _corrigido jsonb DEFAULT NULL)
 returns jsonb language plpgsql security definer set search_path to 'ops', 'public'
as $function$
declare p ops.base_pedidos; prop jsonb; w text; mesma boolean;
begin
 if not ops.base_pedido_pode_decidir() then raise exception 'Seu acesso não permite decidir pedidos das unidades.'; end if;
 select * into p from ops.base_pedidos where id=_id;
 if p.id is null then raise exception 'Pedido não encontrado.'; end if;
 if p.tipo='churn' then raise exception 'Churn segue pela tratativa no Pipefy, não pela fila.'; end if;
 if p.pedido_pai is not null then raise exception 'Este contato é decidido junto com o cliente declarado.'; end if;
 if not _aprovar then
  if length(trim(coalesce(_motivo,''))) < 10 then raise exception 'Escreva o motivo da recusa (10 letras ou mais). A unidade vê este texto.'; end if;
  update ops.base_pedidos set situacao='recusado', motivo_recusa=trim(_motivo), decidido_por=auth.uid(), decidido_em=now()
   where id=_id and situacao='aberto' returning * into p;
  if not found then raise exception 'Pedido já decidido.'; end if;
  update ops.base_pedidos set situacao='recusado', motivo_recusa=trim(_motivo), decidido_por=auth.uid(), decidido_em=now()
   where pedido_pai=_id and situacao='aberto';
  return to_jsonb(p);
 end if;
 prop := p.proposto;
 -- O CS pode corrigir o dado antes de aprovar; a correção passa pelas mesmas regras.
 if _corrigido is not null and p.tipo in ('contato_incluir','contato_editar') then
  w := ops.base_whatsapp(coalesce(_corrigido->>'whatsapp', prop->>'whatsapp'));
  if w is null then raise exception 'WhatsApp inválido.'; end if;
  if length(trim(coalesce(_corrigido->>'nome', prop->>'nome'))) < 3 then raise exception 'Nome inválido.'; end if;
  if nullif(trim(coalesce(_corrigido->>'email','')),'') is not null and trim(_corrigido->>'email') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'E-mail inválido.'; end if;
  prop := prop || jsonb_build_object('nome',trim(coalesce(_corrigido->>'nome', prop->>'nome')),
    'cargo',coalesce(nullif(trim(_corrigido->>'cargo'),''), prop->>'cargo'),
    'email',case when _corrigido ? 'email' then nullif(trim(_corrigido->>'email'),'') else prop->>'email' end,
    'whatsapp',w);
 end if;
 -- "Mesma empresa de outra linha" segue o fluxo de dedup da matriz: aprovar só registra.
 mesma := p.tipo='nao_reconheco' and prop->>'motivo'='mesma_empresa';
 update ops.base_pedidos set situacao=case when mesma then 'concluido' else 'aprovado' end,
   proposto=prop, decidido_por=auth.uid(), decidido_em=now(), concluido_em=case when mesma then now() end,
   resultado=case when mesma then jsonb_build_object('nota','Segue o fluxo de dedup da matriz.') end
  where id=_id and situacao='aberto' returning * into p;
 if not found then raise exception 'Pedido já decidido.'; end if;
 update ops.base_pedidos set situacao='aprovado', decidido_por=auth.uid(), decidido_em=now() where pedido_pai=_id and situacao='aberto';
 return to_jsonb(p);
end $function$;

-- Consulta de CNPJ antes de declarar cliente (R-17): limite por hora e a resposta sem a unidade de outro.
create or replace function ops.base_cnpj_checar(_cnpj text)
 returns jsonb language plpgsql security definer set search_path to 'ops', 'public'
as $function$
declare n text := ops.base_cnpj(_cnpj); nome text;
begin
 if not ops.base_pedido_pode_abrir() then raise exception 'Seu acesso não permite incluir cliente.'; end if;
 if n is null then raise exception 'CNPJ inválido.'; end if;
 if (select count(*) from ops.base_cnpj_consultas where user_id=auth.uid() and em > now()-interval '1 hour') >= 30 then
  raise exception 'Limite de 30 consultas de CNPJ por hora. Tente de novo mais tarde.';
 end if;
 insert into ops.base_cnpj_consultas(user_id,cnpj) values(auth.uid(),n);
 select c.perfil->>'name' into nome from ops.base_conta_estado a join ops.base_carteira c on c.key=a.key
  where n = any(a.cnpjs) and c.base->'situacao'->>'estado'='cliente' and ops.monetizacao_scope(c.unidade_ids) limit 1;
 if nome is not null then return jsonb_build_object('estado','na_sua_base','nome',nome); end if;
 if exists(select 1 from ops.base_conta_estado a join ops.base_carteira c on c.key=a.key
           where n = any(a.cnpjs) and c.base->'situacao'->>'estado'='cliente') then
  return jsonb_build_object('estado','cliente_rede');
 end if;
 if exists(select 1 from ops.base_pedidos where chave_unica='cliente_incluir:'||n and situacao in ('aberto','aprovado','enviando')) then
  return jsonb_build_object('estado','pedido');
 end if;
 return jsonb_build_object('estado','livre','cnpj',n);
end $function$;

-- Contatos por conta para a lista do sócio: quantos, quem é o contato do NPS e o que está com o CS.
create or replace function ops.base_contatos_resumo()
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$
 with contas as (
  select c.key, m.empresa_ids from ops.base_carteira c join ops.monetizacao_contas m on m.key=c.key
  where auth.uid() is not null and ops.monetizacao_can('view.clientes') and ops.monetizacao_scope(c.unidade_ids)
    and c.base->'situacao'->>'estado'='cliente'
 ), ct as (
  select k.key, count(*) n,
   (array_agg(jsonb_build_object('id',x.id,'nome',x.nome_completo,'whatsapp',x.whatsapp) order by x.id)
     filter (where x.contato_nps and ops.base_whatsapp(x.whatsapp) is not null))[1] nps
  from contas k join ops.contatos x on x.empresa_id=any(k.empresa_ids) and x.ativo
  group by k.key
 ), pd as (
  select p.conta_key key, count(*) n, array_agg(distinct p.tipo) tipos
  from ops.base_pedidos p where p.situacao in ('aberto','aprovado','enviando') and p.conta_key in (select key from contas)
  group by p.conta_key
 )
 select jsonb_build_object(
  'contas', coalesce((select jsonb_object_agg(k.key, jsonb_build_object('contatos',coalesce(ct.n,0),'nps',ct.nps,
     'pedidos',coalesce(pd.n,0),'tipos',coalesce(to_jsonb(pd.tipos),'[]')))
   from contas k left join ct on ct.key=k.key left join pd on pd.key=k.key
   where ct.key is not null or pd.key is not null),'{}'),
  'declarados', coalesce((select jsonb_agg(ops.base_pedido_json(p) order by p.criado_em desc) from ops.base_pedidos p
   where p.tipo='cliente_incluir' and p.situacao in ('aberto','aprovado','enviando','erro')
     and auth.uid() is not null and ops.monetizacao_can('view.clientes') and ops.monetizacao_scope(array[p.unidade_id])),'[]'))
$$;

-- Contatos de uma conta (ou de um cliente declarado) para o painel lateral, sem CPF.
create or replace function ops.base_conta_contatos(_key text, _pai uuid DEFAULT NULL)
 returns jsonb language plpgsql stable security definer set search_path to 'ops', 'public'
as $function$
declare conta ops.base_carteira; empresas integer[];
begin
 if auth.uid() is null or not ops.monetizacao_can('view.clientes') then raise exception 'Sem acesso à base de clientes.'; end if;
 if _pai is not null then
  if not exists(select 1 from ops.base_pedidos p where p.id=_pai and p.tipo='cliente_incluir' and ops.monetizacao_scope(array[p.unidade_id])) then
   raise exception 'Cliente fora da sua unidade.';
  end if;
  return jsonb_build_object('contatos','[]'::jsonb, 'tem_cadastro', true, 'tem_cnpj', true,
   'pedidos',(select coalesce(jsonb_agg(ops.base_pedido_json(p) order by p.criado_em),'[]') from ops.base_pedidos p
              where p.pedido_pai=_pai and p.situacao in ('aberto','aprovado','enviando','erro')));
 end if;
 select * into conta from ops.base_carteira where key=_key;
 if conta.key is null or not ops.monetizacao_scope(conta.unidade_ids) then raise exception 'Cliente fora da sua unidade.'; end if;
 select coalesce(m.empresa_ids,'{}') into empresas from ops.monetizacao_contas m where m.key=_key;
 return jsonb_build_object(
  'contatos', (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome_completo,'cargo',c.cargo,'whatsapp',c.whatsapp,
      'whatsapp_valido',ops.base_whatsapp(c.whatsapp) is not null,'email',c.email,'contato_nps',c.contato_nps) order by c.contato_nps desc, c.nome_completo),'[]')
    from ops.contatos c where c.empresa_id=any(empresas) and c.ativo and ops.monetizacao_can('view.contatos')),
  'pedidos', (select coalesce(jsonb_agg(ops.base_pedido_json(p) order by p.criado_em),'[]') from ops.base_pedidos p
    where p.conta_key=_key and p.situacao in ('aberto','aprovado','enviando','erro') and p.tipo like 'contato_%'),
  'tem_cadastro', exists(select 1 from ops.empresas e where e.id=any(empresas) and e.pipefy_record_id is not null),
  'tem_cnpj', jsonb_array_length(coalesce(conta.base->'cnpjs','[]'))>0);
end $function$;

-- ============ Envio (só service role) ============
create or replace function ops.base_pedido_claim()
 returns jsonb language plpgsql security definer set search_path to 'ops', 'public'
as $function$
declare p ops.base_pedidos; ctx jsonb; empresas integer[] := '{}';
begin
 update ops.base_pedidos set situacao='erro', erro=coalesce(erro,'Tentativas esgotadas; conferir no Pipefy.')
  where situacao='enviando' and tentativas>=5 and tentativa_em < now()-interval '5 minutes';
 select * into p from ops.base_pedidos
  where tipo<>'churn' and pedido_pai is null and tentativas<5
    and (situacao='aprovado' or (situacao in ('enviando','erro') and decidido_em is not null and tentativa_em < now()-interval '5 minutes'))
  order by decidido_em for update skip locked limit 1;
 if p.id is null then return null; end if;
 update ops.base_pedidos set situacao='enviando', tentativas=tentativas+1, tentativa_em=now() where id=p.id;
 select coalesce(m.empresa_ids,'{}') into empresas from ops.monetizacao_contas m where m.key=p.conta_key;
 empresas := coalesce(empresas,'{}');
 ctx := jsonb_build_object(
  'unidade', (select jsonb_build_object('id',u.id,'nome',u.nome_da_praca,'pipefy_id',u.pipefy_id) from ops.unidades u where u.id=p.unidade_id),
  'conta', (select jsonb_build_object('nome',c.perfil->>'name','cnpjs',c.base->'cnpjs') from ops.base_carteira c where c.key=p.conta_key),
  'empresas', (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'pipefy_id',e.pipefy_record_id,'cnpj',e.cnpj) order by e.id),'[]')
               from ops.empresas e where e.id=any(empresas)),
  'contato', (select jsonb_build_object('id',c.id,'pipefy_id',c.pipefy_record_id,'empresa_pipefy',c.empresa_pipefy_record_id) from ops.contatos c where c.id=p.contato_id),
  'contatos', (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'pipefy_id',c.pipefy_record_id,'whatsapp',ops.base_whatsapp(c.whatsapp),
                 'nome',c.nome_completo,'email',c.email,'contato_nps',c.contato_nps,'empresa_pipefy',c.empresa_pipefy_record_id)),'[]')
               from ops.contatos c where c.empresa_id=any(empresas) and c.ativo),
  'filhos', (select coalesce(jsonb_agg(to_jsonb(f) order by f.criado_em),'[]') from ops.base_pedidos f where f.pedido_pai=p.id and f.situacao in ('aprovado','enviando','erro')),
  'destino_unidade', (select jsonb_build_object('id',u.id,'nome',u.nome_da_praca,'pipefy_id',u.pipefy_id) from ops.unidades u
                      where coalesce(p.proposto->>'unidade_id','') ~ '^\d+$' and u.id=(p.proposto->>'unidade_id')::integer));
 return to_jsonb(p) || jsonb_build_object('tentativas',p.tentativas+1,'ctx',ctx);
end $function$;

-- Guarda o que o envio já criou (empresa ou contato) antes do próximo passo: repetir não duplica.
create or replace function ops.base_pedido_marcar(_id uuid, _resultado jsonb)
 returns void language sql security definer set search_path to 'ops', 'public'
as $$ update ops.base_pedidos set resultado=coalesce(resultado,'{}')||_resultado where id=_id $$;

create or replace function ops.base_pedido_resultado(_id uuid, _ok boolean, _erro text DEFAULT NULL, _resultado jsonb DEFAULT NULL)
 returns void language plpgsql security definer set search_path to 'ops', 'public'
as $function$
begin
 update ops.base_pedidos set situacao=case when _ok then 'concluido' else 'erro' end,
   erro=case when _ok then null else left(_erro,500) end, concluido_em=case when _ok then now() end,
   resultado=coalesce(resultado,'{}')||coalesce(_resultado,'{}')
  where id=_id and situacao='enviando';
 update ops.base_pedidos set situacao=case when _ok then 'concluido' else 'erro' end,
   erro=case when _ok then null else left(_erro,500) end, concluido_em=case when _ok then now() end
  where pedido_pai=_id and situacao in ('aprovado','enviando','erro');
end $function$;

-- Churn (R-13): os pedidos abertos com card, e a fase que o card alcançou.
create or replace function ops.base_pedidos_churn_abertos()
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$ select coalesce(jsonb_agg(jsonb_build_object('id',id,'card',pipefy_ref)),'[]') from ops.base_pedidos
      where tipo='churn' and situacao='aberto' and pipefy_ref is not null $$;

create or replace function ops.base_pedido_churn_fase(_id uuid, _concluido boolean, _motivo text)
 returns void language sql security definer set search_path to 'ops', 'public'
as $$
 update ops.base_pedidos set situacao=case when _concluido then 'concluido' else 'recusado' end,
   motivo_recusa=case when _concluido then null else _motivo end, concluido_em=case when _concluido then now() end,
   decidido_em=now()
 where id=_id and tipo='churn' and situacao='aberto'
$$;

-- Grants: o usuário logado só chama as funções de tela; as de envio são do service role.
revoke all on function ops.base_whatsapp(text) from public, anon;
grant execute on function ops.base_whatsapp(text) to authenticated, service_role;
revoke all on function ops.base_pedido_json(ops.base_pedidos) from public, anon, authenticated;
do $$
declare f text;
begin
 foreach f in array array[
  'ops.base_pedido_pode_abrir()','ops.base_pedido_pode_decidir()','ops.base_pedido_permissoes()','ops.base_pedido_unidade(integer[])',
  'ops.base_pedido_abrir(text,text,bigint,jsonb,uuid)','ops.base_pedido_churn_card(uuid,text,text)','ops.base_pedido_cancelar(uuid)',
  'ops.base_pedidos_meus()','ops.base_pedidos_fila(text)','ops.base_pedido_decidir(uuid,boolean,text,jsonb)','ops.base_cnpj_checar(text)',
  'ops.base_contatos_resumo()','ops.base_conta_contatos(text,uuid)'] loop
  execute format('revoke all on function %s from public, anon', f);
  execute format('grant execute on function %s to authenticated, service_role', f);
 end loop;
 foreach f in array array[
  'ops.base_pedido_claim()','ops.base_pedido_marcar(uuid,jsonb)','ops.base_pedido_resultado(uuid,boolean,text,jsonb)',
  'ops.base_pedidos_churn_abertos()','ops.base_pedido_churn_fase(uuid,boolean,text)'] loop
  execute format('revoke all on function %s from public, anon, authenticated', f);
  execute format('grant execute on function %s to service_role', f);
 end loop;
end $$;
