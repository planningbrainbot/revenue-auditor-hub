-- Ensaio das respostas da Ana de 21/10/2026 e dos rollbacks delas:
--   20261021120000_portal_faturamento_contas_correntes.sql   (conta corrente padrão por empresa)
--   20261021121000_portal_faturamento_cnpj_nao_encontrado.sql (CNPJ que a Receita não acha bloqueia o envio)
--   20261021122000_portal_faturamento_prazos_tesouraria.sql   (higiene da fila: vence em até 2 dias)
--
-- Uma transação que termina em ROLLBACK: nada sobrevive (consultas de teste, papel, pedidos, envios, eventos). Cada teste
-- levanta exceção quando falha (FALHOU Xn). Como rodar, de PM Work/execution/portal-faturamento-prd-20261013/e1/:
--   python3 -I ensaio.py <este arquivo> --migration <M1> --migration <M2> --migration <M3> \
--     --rollback <R3> --rollback <R2> --rollback <R1>
-- Depois de aplicar, com --vazio (o bloco R só confere quando os rollbacks entraram).
-- CNPJs de teste (dígito certo, sem linha em lugar nenhum do banco em 21/10; a CNPJá respondeu 404 "not registered"
-- para o primeiro): 98.765.432/0009-45 (consultado e não encontrado) e 98.765.432/0010-89 (sem consulta). Os pedidos
-- de teste têm número explícito (FAT-1999-…): não gastam a numeração. O Pedro é dono na PRJ só dentro da transação.

begin;

-- @@MIGRATION@@

-- A1. Conta corrente padrão: as 16 inequívocas com o código lido do Omie; PARTNERS e as inativas nulas; um evento de
-- configuração por empresa, com a procedência.
do $a1$
declare
  _faltas text;
  _n int;
begin
  select string_agg(format('%s=%s (esperado %s)', e.apelido, e.conta_corrente_padrao, v.conta), ', ') into _faltas
    from (values
      ('PMC', 11505716373::bigint), ('MAROX', 2406503925::bigint), ('PAC', 9575010825::bigint),
      ('PAC SP', 11336517902::bigint), ('PRJ', 6964018974::bigint), ('DOC', 7037113322::bigint),
      ('PIS', 1808802208::bigint), ('PAT', 6718045126::bigint), ('PGE', 7400610229::bigint),
      ('PCC', 2769990301::bigint), ('BPO', 1808796467::bigint), ('PNE', 6039556786::bigint),
      ('NEO', 2114130305::bigint), ('ASCENDIA', 5520442101::bigint), ('CONCILIADOR', 4122845330::bigint),
      ('FINANCE', 4617488632::bigint)) v(apelido, conta)
    left join organizacao.empresas_grupo e on e.apelido = v.apelido
   where e.conta_corrente_padrao is distinct from v.conta;
  if _faltas is not null then raise exception 'FALHOU A1: conta corrente fora do esperado: %', _faltas; end if;
  if exists (select 1 from organizacao.empresas_grupo
              where (apelido = 'PARTNERS' or not ativa) and conta_corrente_padrao is not null) then
    raise exception 'FALHOU A1: PARTNERS (ambígua) ou empresa inativa ganhou conta corrente';
  end if;
  select count(distinct e.entidade_id) into _n from receita.fat_eventos e
   where e.entidade = 'emissora' and e.evento = 'configurado' and e.diff ? 'conta_corrente_padrao'
     and e.diff ->> 'procedencia' like 'Ana (controladoria), 21/10/2026%';
  if _n <> 16 then raise exception 'FALHOU A1: % empresas com o evento de configuração (esperado 16)', _n; end if;
  -- A conta chega ao pedido: a foto do envio usa a conta da empresa quando o serviço não tem outra.
  if not exists (select 1 from organizacao.empresas_grupo g where g.apelido = 'DOC' and g.conta_corrente_padrao = 7037113322) then
    raise exception 'FALHOU A1: DOC sem a conta Itaú';
  end if;
end $a1$;

-- B1. Gravar "não encontrado" (service_role): só fonte e data ficam; encontrado precisa ser booleano.
set local role service_role;
do $b1$
declare
  r jsonb;
  rc integracoes.receita_cnpj;
begin
  r := ops.fat_receita_cnpj_gravar('98.765.432/0009-45', jsonb_build_object(
         'fonte', 'CNPJá aberta', 'encontrado', false, 'situacao', 'ATIVA', 'razao_social', 'NÃO DEVE FICAR',
         'uf', 'PR', 'emails', jsonb_build_array('x@exemplo.com.br')));
  if (r ->> 'encontrado')::boolean is distinct from false or r ->> 'situacao' is not null then
    raise exception 'FALHOU B1: retorno da gravação: %', r;
  end if;
  select * into rc from integracoes.receita_cnpj where cnpj = '98765432000945';
  if rc.encontrado or rc.situacao is not null or rc.razao_social is not null or rc.uf is not null
     or cardinality(rc.emails) <> 0 or rc.fonte <> 'CNPJá aberta' then
    raise exception 'FALHOU B1: a linha do não encontrado guardou mais que fonte e data';
  end if;
  begin
    perform ops.fat_receita_cnpj_gravar('98765432000945', '{"fonte": "CNPJá aberta", "encontrado": "nao"}'::jsonb);
    raise exception 'FALHOU B1: aceitou encontrado que não é booleano';
  exception when sqlstate '22023' then null;
  end;
end $b1$;
reset role;

do $b1b$
begin
  if receita.fat_bloqueio('98765432000945') is distinct from
     'CNPJ não encontrado na Receita Federal: envio bloqueado. Confira o número.' then
    raise exception 'FALHOU B1: fat_bloqueio devolveu %', receita.fat_bloqueio('98765432000945');
  end if;
  if receita.fat_bloqueio('98765432001089') is not null then
    raise exception 'FALHOU B1: CNPJ sem consulta ganhou bloqueio';
  end if;
end $b1b$;

-- B2. O navegador não grava a consulta.
set local role authenticated;
do $b2$
begin
  perform set_config('request.jwt.claims', '{"sub":"5c4d0e46-fc33-4132-bcca-47c05ad001c7","role":"authenticated"}', true);
  begin
    perform ops.fat_receita_cnpj_gravar('98765432000945', '{"fonte": "tela", "encontrado": true, "situacao": "ATIVA"}'::jsonb);
    raise exception 'FALHOU B2: authenticated gravou a consulta da Receita';
  exception when insufficient_privilege then null;
  end;
end $b2$;
reset role;

-- B3. fat_tomador, o envio bloqueado (não encontrado) e o envio que passa (sem consulta = situação não conferida).
do $b3$
declare
  _prj constant uuid := 'f85b9ff8-d04f-4cf3-b045-86c177c82237';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _claims constant text := '{"sub":"5c4d0e46-fc33-4132-bcca-47c05ad001c7","role":"authenticated"}';
  _frase constant text := 'CNPJ não encontrado na Receita Federal: envio bloqueado. Confira o número.';
  _srv uuid;
  _bloq uuid;
  _livre uuid;
  r jsonb;
  _det text;
  _msg text;
  _ok boolean := false;
begin
  insert into receita.fat_donos (emissora_id, user_id, papel, ativo) values (_prj, _pedro, 'dono', true)
  on conflict (emissora_id, user_id, papel) do update set ativo = true;
  select s.id into _srv from receita.fat_servicos s
   where s.emissora_id = _prj and s.ativo and s.tem_tributacao and coalesce(s.no_omie, true) order by s.codigo limit 1;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', _claims, true);
  r := ops.fat_tomador('98.765.432/0009-45', _prj);
  if (r ->> 'receita_encontrado')::boolean is distinct from false or r #>> '{bloqueio,motivo}' is distinct from _frase
     or (r ->> 'consultar_receita')::boolean or r ->> 'situacao' is not null or r ->> 'situacao_fonte' <> 'CNPJá aberta' then
    raise exception 'FALHOU B3: fat_tomador do não encontrado: %', r;
  end if;
  r := ops.fat_tomador('98765432001089', _prj);
  if r -> 'receita_encontrado' <> 'null'::jsonb or r -> 'bloqueio' <> 'null'::jsonb
     or not (r ->> 'consultar_receita')::boolean then
    raise exception 'FALHOU B3: fat_tomador sem consulta: %', r;
  end if;
  r := ops.fat_tomador('529.982.247-25', _prj);
  if r -> 'receita_encontrado' <> 'null'::jsonb then raise exception 'FALHOU B3: CPF com receita_encontrado: %', r; end if;
  perform set_config('role', 'postgres', true);

  -- Não encontrado há mais de 1 dia: pede consulta nova, e o bloqueio continua enquanto ela não acha.
  update integracoes.receita_cnpj set consultado_em = now() - interval '2 days' where cnpj = '98765432000945';
  perform set_config('role', 'authenticated', true);
  r := ops.fat_tomador('98765432000945', _prj);
  if not (r ->> 'consultar_receita')::boolean or r #>> '{bloqueio,motivo}' is distinct from _frase then
    raise exception 'FALHOU B3: não encontrado antigo não pediu consulta nova (ou perdeu o bloqueio): %', r;
  end if;
  perform set_config('role', 'postgres', true);

  insert into receita.fat_pedidos (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, emails_envio,
                                   projeto, servico_id, descricao_nf, valor, forma, parcelas, primeiro_vencimento,
                                   documento, meio, observacoes, dono_id, solicitante_id, status)
  values ('FAT-1999-000921', _prj, 'pj', '98765432000945', 'CLIENTE DO ENSAIO NÃO ENCONTRADO', array['ensaio@exemplo.com.br'],
          'Ensaio Ana 21/10', _srv, 'Ensaio Ana 21/10', 100, 'avulso', 1, receita.fat_hoje() + 30, 'nf', 'boleto',
          'Ensaio do gate de 21/10', _pedro, _pedro, 'rascunho')
  returning id into _bloq;
  insert into receita.fat_pedidos (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, emails_envio,
                                   projeto, servico_id, descricao_nf, valor, forma, parcelas, primeiro_vencimento,
                                   documento, meio, observacoes, dono_id, solicitante_id, status)
  values ('FAT-1999-000922', _prj, 'pj', '98765432001089', 'CLIENTE DO ENSAIO SEM CONSULTA', array['ensaio@exemplo.com.br'],
          'Ensaio Ana 21/10', _srv, 'Ensaio Ana 21/10', 100, 'avulso', 1, receita.fat_hoje() + 2, 'nf', 'boleto',
          'Ensaio do gate de 21/10', _pedro, _pedro, 'rascunho')
  returning id into _livre;

  perform set_config('role', 'authenticated', true);
  -- O salvar aponta a pendência (rascunho continua salvando).
  r := ops.fat_pedido_salvar(_bloq, '{"observacoes": "Ensaio do gate de 21/10 (salvo de novo)"}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(r -> 'pendencias') x
                  where x ->> 'campo' = 'tomador_documento' and x ->> 'mensagem' = _frase) then
    raise exception 'FALHOU B3: o salvar não apontou o bloqueio: %', r -> 'pendencias';
  end if;
  begin
    perform ops.fat_pedido_enviar(_bloq);
  exception when sqlstate '22023' then
    get stacked diagnostics _det = pg_exception_detail, _msg = message_text;
    _ok := _det like '%tomador_documento%' and (_det like '%' || _frase || '%' or _msg = _frase);
  end;
  if not _ok then raise exception 'FALHOU B3: o envio do CNPJ não encontrado não foi bloqueado (detalhe: %)', _det; end if;

  r := ops.fat_pedido_enviar(_livre);
  if r ->> 'status' <> 'na_fila_omie' then
    raise exception 'FALHOU B3: CNPJ sem consulta não foi para a fila: %', r;
  end if;
  perform set_config('role', 'postgres', true);
  if (select tomador_situacao from receita.fat_pedidos where id = _livre) is not null then
    raise exception 'FALHOU B3: o pedido sem consulta não ficou como situação não conferida';
  end if;

  -- Consulta nova que acha: o bloqueio sai.
  perform set_config('role', 'service_role', true);
  perform ops.fat_receita_cnpj_gravar('98765432000945', jsonb_build_object('fonte', 'CNPJá aberta', 'situacao', 'ATIVA',
                                       'razao_social', 'CLIENTE ACHADO', 'uf', 'PR'));
  perform set_config('role', 'postgres', true);
  if receita.fat_bloqueio('98765432000945') is not null
     or not (select encontrado from integracoes.receita_cnpj where cnpj = '98765432000945') then
    raise exception 'FALHOU B3: a consulta que achou não tirou o bloqueio';
  end if;
end $b3$;

-- C1. Higiene da fila: vence em até 2 dias corridos (vence_2d), com vence_3d como sinônimo até o app novo.
do $c1$
declare
  _prj constant uuid := 'f85b9ff8-d04f-4cf3-b045-86c177c82237';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _srv uuid;
  _tres uuid;
  r2 jsonb;
  r3 jsonb;
  t jsonb;
begin
  select s.id into _srv from receita.fat_servicos s
   where s.emissora_id = _prj and s.ativo and s.tem_tributacao and coalesce(s.no_omie, true) order by s.codigo limit 1;
  insert into receita.fat_pedidos (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, emails_envio,
                                   projeto, servico_id, descricao_nf, valor, forma, parcelas, primeiro_vencimento,
                                   documento, meio, observacoes, dono_id, solicitante_id, status)
  values ('FAT-1999-000923', _prj, 'pj', '98765432001089', 'CLIENTE DO ENSAIO SEM CONSULTA', array['ensaio@exemplo.com.br'],
          'Ensaio Ana 21/10', _srv, 'Ensaio Ana 21/10', 100, 'avulso', 1, receita.fat_hoje() + 3, 'nf', 'boleto',
          'Ensaio do gate de 21/10', _pedro, _pedro, 'rascunho')
  returning id into _tres;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5c4d0e46-fc33-4132-bcca-47c05ad001c7","role":"authenticated"}', true);
  perform ops.fat_pedido_enviar(_tres);

  r2 := ops.fat_fila_tesouraria(_prj, '{"higiene": "vence_2d", "busca": "FAT-1999-00092"}'::jsonb);
  r3 := ops.fat_fila_tesouraria(_prj, '{"higiene": "vence_3d", "busca": "FAT-1999-00092"}'::jsonb);
  t := ops.fat_fila_tesouraria(_prj, '{"busca": "FAT-1999-00092"}'::jsonb);
  perform set_config('role', 'postgres', true);

  if jsonb_path_query_array(r2, '$.itens[*].numero') <> '["FAT-1999-000922"]'::jsonb then
    raise exception 'FALHOU C1: vence_2d devolveu % (esperado só o de hoje + 2)', jsonb_path_query_array(r2, '$.itens[*].numero');
  end if;
  if jsonb_path_query_array(r3, '$.itens[*].numero') <> jsonb_path_query_array(r2, '$.itens[*].numero') then
    raise exception 'FALHOU C1: o sinônimo vence_3d não devolve o mesmo que vence_2d';
  end if;
  if (t #>> '{higiene,vence_2d}')::int is distinct from (t #>> '{higiene,vence_3d}')::int
     or (t #>> '{higiene,vence_2d}')::int < 1 then
    raise exception 'FALHOU C1: contadores de higiene: %', t -> 'higiene';
  end if;
  if exists (select 1 from jsonb_array_elements(t -> 'itens') i
              where (i #>> '{higiene,vence_2d}')::boolean <> (i ->> 'numero' = 'FAT-1999-000922')
                 or i #> '{higiene,vence_3d}' <> i #> '{higiene,vence_2d}') then
    raise exception 'FALHOU C1: higiene por item: %', jsonb_path_query_array(t, '$.itens[*].higiene');
  end if;
  begin
    perform set_config('role', 'authenticated', true);
    perform ops.fat_fila_tesouraria(_prj, '{"higiene": "vence_5d"}'::jsonb);
    raise exception 'FALHOU C1: aceitou higiene desconhecida';
  exception when sqlstate '22023' then perform set_config('role', 'postgres', true);
  end;
end $c1$;

select set_config('ensaio.coluna_antes_do_rollback',
  (exists (select 1 from information_schema.columns where table_schema = 'integracoes' and table_name = 'receita_cnpj'
             and column_name = 'encontrado'))::text, true);

-- @@ROLLBACK@@

do $r$
begin
  if (exists (select 1 from information_schema.columns where table_schema = 'integracoes' and table_name = 'receita_cnpj'
                and column_name = 'encontrado'))::text = current_setting('ensaio.coluna_antes_do_rollback') then
    return;  -- --vazio: os rollbacks não entraram
  end if;
  if pg_get_functiondef('receita.fat_bloqueio(text)'::regprocedure) like '%encontrado%'
     or pg_get_functiondef('ops.fat_tomador(text,uuid)'::regprocedure) like '%receita_encontrado%' then
    raise exception 'FALHOU R1: bloqueio ou fat_tomador não voltaram';
  end if;
  if pg_get_functiondef('ops.fat_fila_tesouraria(uuid,jsonb)'::regprocedure) not like '%_hoje + 3 as vence_3d%'
     or pg_get_functiondef('ops.fat_fila_tesouraria(uuid,jsonb)'::regprocedure) like '%vence_2d%' then
    raise exception 'FALHOU R1: a fila não voltou aos 3 dias';
  end if;
  if exists (select 1 from organizacao.empresas_grupo where conta_corrente_padrao is not null) then
    raise exception 'FALHOU R1: conta corrente sobrou depois do rollback';
  end if;
end $r$;

rollback;
