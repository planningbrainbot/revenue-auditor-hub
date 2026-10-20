-- Ensaio de 20261020190000_portal_faturamento_conector_pipefy.sql (T2/T3, 20/10/2026) e do rollback dela.
--
-- Uma transação que termina em ROLLBACK: nada sobrevive. Cada teste levanta exceção quando falha (FALHOU Pn); a
-- Management API devolve sem erro só se todos passarem.
-- Como rodar: python3 -I e1/ensaio.py <este arquivo> --migration <migration> --rollback <rollback>. Depois de aplicar,
-- rode com --vazio: os blocos P valem nos dois modos e o bloco R só confere quando o rollback entrou.
-- O CNPJ de teste é o da própria DOC (49726267000150), gravado no cache e desfeito no rollback da transação.
-- Os testes de acesso trocam para service_role e authenticated com `set local role` e voltam a postgres no fim.

begin;

select set_config('ensaio.outros_jobs', (
  select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
    from cron.job where jobname <> 'faturamento-omie-fila'), true);

-- @@MIGRATION@@

-- P1. Gravação e leitura do endereço pelo conector (service_role).
set local role service_role;
select ops.fat_receita_cnpj_gravar('49.726.267/0001-50', jsonb_build_object(
  'fonte', 'ensaio T3', 'razao_social', 'PLANNING DOC ASSESSORIA PARALEGAL LTDA', 'situacao', 'ativa',
  'logradouro', 'Rua de Ensaio', 'numero', '100', 'complemento', 'Sala 1', 'bairro', 'Centro', 'cep', '80.010-000',
  'municipio', 'Curitiba', 'uf', 'pr'));
do $p1$
declare r jsonb;
begin
  r := ops.fat_conector_receita_cnpj('49726267000150');
  if r is null or r ->> 'logradouro' <> 'Rua de Ensaio' or r ->> 'numero' <> '100' or r ->> 'bairro' <> 'Centro'
     or r ->> 'cep' <> '80010000' or r ->> 'uf' <> 'PR' or r ->> 'complemento' <> 'Sala 1' then
    raise exception 'FALHOU P1: endereço gravado/lido errado: %', r;
  end if;
  if ops.fat_conector_receita_cnpj('11222333000181') is not null then
    raise exception 'FALHOU P1: CNPJ sem consulta devolveu dado';
  end if;
  begin
    perform ops.fat_receita_cnpj_gravar('49726267000150', '{"fonte":"ensaio","cep":"123"}'::jsonb);
    raise exception 'FALHOU P1: CEP com 3 dígitos foi aceito';
  exception when sqlstate '22023' then null;
  end;
end $p1$;

-- P2. Contexto do card: o conector lê; o pedido mais antigo serve de amostra (se houver).
do $p2$
declare
  _id uuid;
  r jsonb;
begin
  select id into _id from receita.fat_pedidos order by created_at limit 1;
  if _id is not null then
    r := ops.fat_conector_pipefy_contexto(_id);
    if r #>> '{pedido,id}' <> _id::text or not (r ? 'solicitante') or not (r ? 'responsavel_ticket') or not (r ? 'card_id') then
      raise exception 'FALHOU P2: contexto incompleto: %', r;
    end if;
  end if;
  begin
    perform ops.fat_conector_pipefy_contexto('00000000-0000-0000-0000-000000000000');
    raise exception 'FALHOU P2: pedido inexistente não levantou P0002';
  exception when sqlstate 'P0002' then null;
  end;
end $p2$;
reset role;

-- P3. Ninguém além do service_role chama as funções novas.
set local role authenticated;
do $p3$
begin
  begin
    perform ops.fat_conector_receita_cnpj('49726267000150');
    raise exception 'FALHOU P3: authenticated leu o cache da Receita';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops.fat_conector_pipefy_contexto('00000000-0000-0000-0000-000000000000');
    raise exception 'FALHOU P3: authenticated leu o contexto do Pipefy';
  exception when insufficient_privilege then null;
  end;
end $p3$;
reset role;

-- P4. O job da fila olha as duas filas e os outros jobs não mudaram.
do $p4$
declare c text;
begin
  select command into c from cron.job where jobname = 'faturamento-omie-fila' and active and schedule = '*/2 * * * *';
  if c is null or c not like '%integracoes.omie_envios%' or c not like '%integracoes.pipefy_envios%'
     or c not like '%faturamento_cron_secret%' or c not like '%"acao":"processar"%' then
    raise exception 'FALHOU P4: job da fila errado';
  end if;
  begin
    execute 'explain ' || regexp_replace(btrim(c), ';\s*$', '');
  exception when others then
    raise exception 'FALHOU P4: comando do job não compila: %', sqlerrm;
  end;
  if (select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
        from cron.job where jobname <> 'faturamento-omie-fila') <> current_setting('ensaio.outros_jobs') then
    raise exception 'FALHOU P4: outro job do pg_cron mudou';
  end if;
end $p4$;

select set_config('ensaio.colunas_antes_do_rollback', (
  select count(*)::text from information_schema.columns
   where table_schema = 'integracoes' and table_name = 'receita_cnpj' and column_name = 'cep'), true);

-- @@ROLLBACK@@

do $r$
begin
  -- R1. Com o rollback: sem colunas, sem funções novas, job da fila sem o Pipefy, gravação da Receita de pé.
  if (select count(*)::text from information_schema.columns
        where table_schema = 'integracoes' and table_name = 'receita_cnpj' and column_name = 'cep')
     = current_setting('ensaio.colunas_antes_do_rollback') then
    return;  -- --vazio: o rollback não entrou
  end if;
  if exists (select 1 from pg_proc where proname in ('fat_conector_receita_cnpj', 'fat_conector_pipefy_contexto',
                                                     'fat_receita_cnpj', 'fat_pipefy_contexto')) then
    raise exception 'FALHOU R1: função nova sobrou';
  end if;
  if not exists (select 1 from cron.job where jobname = 'faturamento-omie-fila' and command not like '%pipefy_envios%') then
    raise exception 'FALHOU R1: job da fila não voltou ao comando de 20261020160000';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'integracoes' and p.proname = 'receita_cnpj_gravar'
                    and pg_get_functiondef(p.oid) not like '%logradouro%') then
    raise exception 'FALHOU R1: receita_cnpj_gravar não voltou ao corpo anterior';
  end if;
end $r$;

rollback;
