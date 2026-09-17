do $$
declare result jsonb;
begin
 result:=ops.base_classificar_origem('{}',true,array['Belém'],'{}',false);
 if result->>'status'<>'nova' then raise exception 'Pipedrive não ganho fora de Curitiba deve ser Nova';end if;
 result:=ops.base_classificar_origem(array['Curitiba'],true,array['Curitiba'],array['2025-03-31'::date],true);
 if result->>'status'<>'antiga' then raise exception 'Curitiba pré abril deve ser Antiga mesmo com Pipedrive';end if;
 result:=ops.base_classificar_origem(array['Curitiba'],true,array['Curitiba'],array['2025-05-01'::date],true);
 if result->>'status'<>'nova' then raise exception 'Curitiba pós abril deve ser Nova';end if;
 result:=ops.base_classificar_origem(array['Curitiba'],true,array['Curitiba'],array['2025-04-01'::date],true);
 if result->>'status'<>'confirmar' then raise exception 'Abril não foi definido';end if;
 result:=ops.base_classificar_origem(array['Curitiba'],true,array['Curitiba'],array['2024-01-01'::date,'2026-01-01'::date],true);
 if result->>'status'<>'confirmar' then raise exception 'CNPJs com coortes mistas não podem ser aprovados';end if;
 result:=ops.base_classificar_origem(array['Curitiba'],false,array['Curitiba'],array['2024-01-01'::date],false);
 if result->>'status'<>'confirmar' then raise exception 'Cobertura parcial não determina origem';end if;
 result:=ops.base_classificar_origem('{}',true,'{}','{}',false);
 if result->>'status'<>'confirmar' then raise exception 'Unidade desconhecida pode ser Curitiba';end if;
 result:=ops.base_classificar_origem(array['Curitiba','Matriz'],false,array['Curitiba','Matriz'],array['2024-01-01'::date],true);
 if result->>'status'<>'confirmar' then raise exception 'Unidade conflitante exige revisão';end if;
 if has_table_privilege('authenticated','ops.base_omie_contratos','select') or has_table_privilege('anon','ops.base_enriquecimento_cnpj','select') then raise exception 'Evidências acessíveis fora de RPC com escopo';end if;
end $$;
