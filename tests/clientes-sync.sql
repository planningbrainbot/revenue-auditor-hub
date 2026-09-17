-- Executar apenas dentro da transação de teste que termina em ROLLBACK.
do $$
declare a jsonb; b jsonb; eid integer; cid bigint; n integer; prevented boolean:=false;
begin
 a:=ops.base_ingest_pipefy('pipefy_empresa','sdd-test-company','2026-09-16T10:00:00Z','2026-09-16T10:01:00Z','{"titulo":"Teste isolado SDD","razao_social":"Teste isolado SDD","segmento":"Serviços","origem_da_base":"Base Antiga","cnpj":null}', '{}');
 eid:=(a->>'empresa_id')::integer;
 if eid is null then raise exception 'FAIL: empresa não criada'; end if;
 perform ops.base_ingest_pipefy('pipefy_empresa','sdd-test-company','2026-09-16T10:00:00Z','2026-09-16T10:01:00Z','{"titulo":"Teste isolado SDD","razao_social":"Teste isolado SDD","segmento":"Serviços","origem_da_base":"Base Antiga","cnpj":null}','{}');
 select count(*) into n from ops.empresas where pipefy_record_id='sdd-test-company';
 if n<>1 then raise exception 'FAIL: evento duplicou cadastro'; end if;
 b:=ops.base_ingest_pipefy('pipefy_empresa','sdd-test-company','2026-09-15T10:00:00Z','2026-09-16T10:02:00Z','{"razao_social":"Obsoleto"}','{}');
 if b->>'status'<>'stale' then raise exception 'FAIL: evento antigo não recusado'; end if;
 update ops.empresas set erp='ERP teste' where id=eid;
 perform ops.base_ingest_pipefy('pipefy_empresa','sdd-test-company','2026-09-16T11:00:00Z','2026-09-16T11:01:00Z','{"titulo":"Teste isolado SDD","razao_social":"Teste isolado SDD","segmento":null,"origem_da_base":"Base Antiga","cnpj":null}','{}');
 if (select segmento is not null or erp<>'ERP teste' from ops.empresas where id=eid) then raise exception 'FAIL: limpeza/schema ausente'; end if;
 begin update ops.empresas set razao_social='Divergência local' where id=eid; exception when others then prevented:=true; end;
 if not prevented then raise exception 'FAIL: alteração local simulou sucesso'; end if;
 a:=ops.base_ingest_pipefy('pipefy_contato','sdd-test-contact','2026-09-16T12:00:00Z','2026-09-16T12:01:00Z','{"nome_completo":"Contato teste","email":"teste@example.invalid"}','{"empresas":["sdd-test-company"]}');
 cid:=(a->>'contato_id')::bigint;
 if (select empresa_id from ops.contatos where id=cid) is distinct from eid then raise exception 'FAIL: contato sem vínculo'; end if;
 perform ops.base_ingest_pipefy('pipefy_contato','sdd-test-contact','2026-09-16T13:00:00Z','2026-09-16T13:01:00Z','{"nome_completo":"Contato teste","email":null}','{"empresas":[]}');
 if (select empresa_id is not null or email is not null from ops.contatos where id=cid) then raise exception 'FAIL: contato manteve vínculo removido'; end if;

 -- Primeiro contato com a fonte não pode destruir enriquecimento histórico.
 insert into ops.empresas(pipefy_record_id,titulo,cnpj,pipedrive_id,origem_da_base) values('sdd-test-bootstrap','Teste bootstrap','11222333000181','12345','Base Antiga') returning id into eid;
 a:=ops.base_ingest_pipefy('pipefy_empresa','sdd-test-bootstrap','2026-09-16T14:00:00Z','2026-09-16T14:01:00Z','{"titulo":"Teste bootstrap","cnpj":null,"pipedrive_id":null,"origem_da_base":null}','{}');
 if a->>'status'<>'pending' or (select cnpj from ops.empresas where id=eid)<>'11222333000181' then raise exception 'FAIL: bootstrap apagou dado pré-existente';end if;
 if (select campos->>'cnpj' from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id='sdd-test-bootstrap') is not null then raise exception 'FAIL: snapshot remoto fabricou CNPJ';end if;
 perform ops.base_ingest_pipefy('pipefy_empresa','sdd-test-bootstrap','2026-09-16T14:00:00Z','2026-09-16T14:02:00Z','{"titulo":"Teste bootstrap","cnpj":null,"pipedrive_id":null,"origem_da_base":null}','{}');
 if (select cnpj from ops.empresas where id=eid)<>'11222333000181' then raise exception 'FAIL: repetição apagou pendência de bootstrap';end if;
 update ops.empresas set erp='Enriquecimento permitido' where id=eid;
 a:=ops.base_ingest_pipefy('pipefy_empresa','sdd-test-bootstrap','2026-09-16T15:00:00Z','2026-09-16T15:01:00Z','{"titulo":"Teste bootstrap","cnpj":"11222333000181","pipedrive_id":"12345","origem_da_base":"Base Antiga"}','{}');
 if a->>'status'<>'ok' then raise exception 'FAIL: confirmação da fonte não resolveu pendência';end if;
 if has_function_privilege('anon','ops.base_ingest_pipefy(text,text,timestamptz,timestamptz,jsonb,jsonb)','EXECUTE') or has_function_privilege('authenticated','ops.base_ingest_lote(jsonb)','EXECUTE') then raise exception 'FAIL: ingestão exposta'; end if;
 if has_table_privilege('authenticated','ops.base_alteracoes','SELECT') then raise exception 'FAIL: outbox exposta'; end if;
 prevented:=false;
 begin perform ops.base_propor_alteracao(eid,'origem_da_base','"Base Nova"','teste isolado'); exception when others then prevented:=true; end;
 if not prevented then raise exception 'FAIL: proposta sem autenticação'; end if;
end $$;
select 'passed' result, 'duplicate,stale,clear,preserve,guard,contact_link,contact_unlink,privileges,anonymous' checks;
