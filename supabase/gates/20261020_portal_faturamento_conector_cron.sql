-- Ensaio da agenda do conector do Omie (T2, 20/10/2026): migration 20261020160000_portal_faturamento_conector_cron.sql
-- e o rollback dela.
--
-- Roda tudo numa transação que termina em ROLLBACK: nada sobrevive. Cada teste levanta exceção quando falha, então a
-- Management API responde [] só se TODOS passarem; uma falha volta como HTTP 400 com o código do teste (FALHOU Cn).
-- Como rodar: python3 -I e1/ensaio.py <este arquivo> --migration <migration> --rollback <rollback>
-- (troca a linha MIGRATION e a linha ROLLBACK pelos arquivos sem begin;/commit;). Depois de aplicar, rode com --vazio:
-- os testes C valem nos dois modos, e o bloco R só confere quando o rollback entrou (o rollback tem a própria
-- conferência e levanta exceção se sobrar job).
--
-- Os comandos agendados não são executados aqui (net.http_post enfileiraria uma chamada real); o teste C3 só faz
-- EXPLAIN de cada um, o que confere sintaxe e os objetos que eles leem.

begin;

-- O segredo do cron precisa existir para a migration passar; se ainda não existir, nasce aqui e some no rollback.
do $segredo$
begin
  if not exists (select 1 from vault.secrets where name = 'faturamento_cron_secret') then
    perform vault.create_secret(md5(random()::text) || md5(random()::text), 'faturamento_cron_secret', 'ensaio T2');
  end if;
  perform set_config('ensaio.outros_jobs', (
    select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
      from cron.job where jobname not like 'faturamento-omie%'), true);
end $segredo$;

-- @@MIGRATION@@

do $c$
declare
  j record;
  n int;
begin
  -- C1. Os dois jobs, com a agenda pedida.
  select count(*) into n from cron.job where jobname = 'faturamento-omie-fila' and schedule = '*/2 * * * *' and active;
  if n <> 1 then raise exception 'FALHOU C1: job da fila (a cada 2 minutos) ausente ou diferente'; end if;
  select count(*) into n from cron.job where jobname = 'faturamento-omie-status' and schedule = '0 11,15,19 * * 1-5' and active;
  if n <> 1 then raise exception 'FALHOU C1: job do status (8h, 12h e 16h de São Paulo, seg–sex) ausente ou diferente'; end if;

  -- C2. Cada comando chama a edge certa, com o segredo do Vault, a ação certa e a guarda de fila vazia.
  for j in select jobname, command from cron.job where jobname like 'faturamento-omie%' loop
    if j.command not like '%https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie''%' then
      raise exception 'FALHOU C2: % não chama a edge faturamento-omie do banco único', j.jobname;
    end if;
    if j.command not like '%vault.decrypted_secrets where name = ''faturamento_cron_secret''%'
       or j.command not like '%x-faturamento-cron%' or j.command ilike '%bearer%' or j.command ilike '%service_role%' then
      raise exception 'FALHOU C2: % sem o cabeçalho do cron com o segredo do Vault (ou com outra chave)', j.jobname;
    end if;
    if j.command not like '%where exists%' then
      raise exception 'FALHOU C2: % chama a edge mesmo sem trabalho', j.jobname;
    end if;
  end loop;
  if (select command from cron.job where jobname = 'faturamento-omie-fila') not like '%"acao":"processar"%'
     or (select command from cron.job where jobname = 'faturamento-omie-status') not like '%"acao":"enfileirar_status"%' then
    raise exception 'FALHOU C2: ação errada no corpo da chamada';
  end if;

  -- C3. Os comandos compilam e acham o que leem (EXPLAIN não executa).
  for j in select jobname, command from cron.job where jobname like 'faturamento-omie%' loop
    begin
      execute 'explain ' || regexp_replace(btrim(j.command), ';\s*$', '');
    exception when others then
      raise exception 'FALHOU C3: comando de % não compila: %', j.jobname, sqlerrm;
    end;
  end loop;

  -- C4. Nenhum outro job mudou.
  if (select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
        from cron.job where jobname not like 'faturamento-omie%') <> current_setting('ensaio.outros_jobs') then
    raise exception 'FALHOU C4: a migration mexeu em outro job do pg_cron';
  end if;
end $c$;

select set_config('ensaio.jobs_antes_do_rollback',
  (select count(*)::text from cron.job where jobname like 'faturamento-omie%'), true);

-- @@ROLLBACK@@

do $r$
begin
  -- R1. O rollback tira os dois jobs e não mexe nos outros. Sem rollback (--vazio), os jobs continuam e não há o que conferir.
  if (select count(*) from cron.job where jobname like 'faturamento-omie%')::text = current_setting('ensaio.jobs_antes_do_rollback') then
    return;
  end if;
  if exists (select 1 from cron.job where jobname like 'faturamento-omie%') then
    raise exception 'FALHOU R1: job do conector sobrou depois do rollback';
  end if;
  if (select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
        from cron.job where jobname not like 'faturamento-omie%') <> current_setting('ensaio.outros_jobs') then
    raise exception 'FALHOU R1: o rollback mexeu em outro job do pg_cron';
  end if;
end $r$;

rollback;
