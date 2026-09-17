-- Aceite no schema instalado. Nenhuma mudança deste teste é persistida.
begin;
set local statement_timeout='50s';
set local lock_timeout='3s';
do $$
declare first_run jsonb; repeated jsonb; n integer; eid integer; result jsonb; operator uuid;
begin
 first_run:=ops.base_intake_omie();
 repeated:=ops.base_intake_omie();
 if (repeated->>'new')::integer<>0 or (repeated->>'updated')::integer<>0 then raise exception 'Omie não idempotente';end if;
 perform ops.base_refinar_ecd();
 if ops.base_refinar_ecd()<>0 then raise exception 'ECD não idempotente';end if;
 if exists(select 1 from ops.base_ecd_registros where ops.base_cnpj(cnpj) is null or ano>extract(year from current_date)) then raise exception 'Metadado ECD inválido';end if;
 if exists(select 1 from ops.base_conta_estado where omie_nova and not identity_conflict and origem<>'nova') then raise exception 'Origem não respeita Omie';end if;
 if ops.base_identity_conflict('[{"cnpj":{"anterior":"11.222.333/0001-81","pipefy":"11222333000181"}}]') then raise exception 'Formatação não é conflito de identidade';end if;
 if ops.base_identity_conflict('[{"cnpj":{"anterior":"11222333000181","pipefy":null}}]') then raise exception 'Lacuna não é documento contraditório';end if;
 if not ops.base_identity_conflict('[{"cnpj":{"anterior":"11222333000181","pipefy":"19131243000197"}}]') then raise exception 'Documentos diferentes não sinalizados';end if;
 insert into ops.empresas(titulo,pipedrive_id) values('Teste sintético de colisão','sdd-pd-duplicate') returning id into eid;
 result:=ops.base_ingest_pipefy('pipefy_empresa','sdd-conflict-test',now(),now(),'{"titulo":"Outra empresa sintética","pipedrive_id":"sdd-pd-duplicate"}','{}');
 if result->>'status'<>'pending' then raise exception 'Colisão não ficou pendente';end if;
 if (select pipedrive_id from ops.empresas where id=eid)<>'sdd-pd-duplicate' then raise exception 'Colisão mudou o dono existente';end if;
 if (select campos->>'pipedrive_id' from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id='sdd-conflict-test')<>'sdd-pd-duplicate' then raise exception 'Colisão alterou a evidência remota';end if;
 if ops.base_unica_catalogo()<>'[]'::jsonb or ops.base_contatos()<>'[]'::jsonb then raise exception 'Consulta anônima retornou dados';end if;

 select e.user_id into operator from ops.usuario_escopo e join public.profiles p on p.user_id=e.user_id and p.ativo
 where not e.todas_unidades and ops.can_user(e.user_id,'view.clientes')
 and exists(select 1 from public.produto_acesso a where a.user_id=e.user_id and a.produto='ops') limit 1;
 if operator is null then raise exception 'Falta operador de unidade para testar RLS';end if;
 perform set_config('request.jwt.claim.sub',operator::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from ops.monetizacao_contas where not ops.monetizacao_scope(unidade_ids)) then raise exception 'RLS expôs outra unidade';end if;
 if exists(select 1 from jsonb_array_elements(ops.base_unica_catalogo()) m where not exists(select 1 from ops.monetizacao_contas a where a.key=m->>'key')) then raise exception 'RPC ampliou escopo';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub','',true);
end $$;
select 'passed' result,'omie_idempotence,ecd_idempotence,origin,duplicate_deal,anonymous,rls,scoped_rpc' checks;
rollback;
