-- Ensaio do recorrente do Portal de Faturamento (E2) e do rollback dele:
--   20261029180000_portal_faturamento_recorrente.sql
--
-- Uma transação que termina em ROLLBACK: nada sobrevive. Cada teste levanta exceção quando falha (FALHOU Xn). Como
-- rodar, de PM Work/execution/portal-faturamento-prd-20261013/e1/:
--   python3 -I ensaio.py <este arquivo> --migration <M> --rollback <R>
-- Depois de aplicar, com --vazio (os blocos que dependem da migration rodam contra o banco como está).
-- Dados: três contratos de teste da PAC (códigos 9000000001 a 9000000004, que não existem no Omie) e notas de outubro
-- e novembro inventadas. O Pedro (super admin) faz o papel de tesouraria; o Daniel é dono e gestor da PAC; o Hugo
-- só da DOC e da NEO.

begin;

-- @@MIGRATION@@

-- E1. Calendário: 15/11 (domingo e feriado) corta em 13/11; 22/11 (domingo, com o 20 feriado e o 21 sábado) em 19/11.
do $e1$
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;  -- só o rollback
  if receita.fat_dia_util_ate('2026-11-15') <> '2026-11-13' then raise exception 'FALHOU E1: corte do dia 15'; end if;
  if receita.fat_dia_util_ate('2026-11-22') <> '2026-11-19' then raise exception 'FALHOU E1: corte do dia 22'; end if;
  if receita.fat_dia_util_ate('2026-11-18') <> '2026-11-18' then raise exception 'FALHOU E1: dia útil mudou'; end if;
  if receita.fat_dia_util_antes('2026-11-13') <> '2026-11-12' then raise exception 'FALHOU E1: véspera do corte'; end if;
  if receita.fat_dia_util_ate('2026-11-01') <> '2026-10-30' then raise exception 'FALHOU E1: dia 1 de novembro'; end if;
end $e1$;

-- E2. O conector grava os campos novos dos contratos e as notas, e só o service_role chama.
do $e2$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  r jsonb;
  _recusou boolean := false;
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;
  perform set_config('role', 'authenticated', true);
  begin
    perform ops.fat_conector_notas_aplicar(_pac, '2026-10-01', '2026-10-31', '[]'::jsonb);
  exception when insufficient_privilege then _recusou := true;
  end;
  if not _recusou then raise exception 'FALHOU E2: authenticated aplicou notas'; end if;
  perform set_config('role', 'service_role', true);
  -- Contratos de teste: só os 4 novos entram por cima; o conjunto real da PAC fica (o aplicar substitui tudo, então
  -- a lista leva os reais + os de teste).
  r := ops.fat_conector_contratos_aplicar(_pac, (
    select jsonb_agg(jsonb_build_object(
             'codigo_contrato', c.codigo_contrato, 'numero', c.numero, 'documento', c.documento,
             'codigo_cliente_omie', c.codigo_cliente_omie, 'situacao', c.situacao, 'vigencia_inicial', c.vigencia_inicial,
             'vigencia_final', c.vigencia_final, 'valor_mensal', c.valor_mensal))
      from integracoes.omie_contratos_vigentes c where c.emissora_id = _pac)
    || jsonb_build_array(
      jsonb_build_object('codigo_contrato', 9000000001, 'numero', 'T-001', 'documento', '11222333000181',
        'codigo_cliente_omie', 1, 'situacao', '10', 'vigencia_inicial', '2025-01-01', 'vigencia_final', null,
        'valor_mensal', 1000, 'dia_faturamento', 15, 'tipo_faturamento', '01', 'dia_vencimento', 20,
        'codigo_projeto', 77, 'projeto', 'GRUPO TESTE', 'cliente_nome', 'CLIENTE TESTE UM',
        'itens', jsonb_build_array(jsonb_build_object('servico', 'Honorários contábeis', 'quantidade', 1, 'valor_total', 1000))),
      jsonb_build_object('codigo_contrato', 9000000002, 'numero', 'T-002', 'documento', '11222333000181',
        'codigo_cliente_omie', 1, 'situacao', '10', 'vigencia_inicial', '2025-01-01', 'vigencia_final', '2026-11-30',
        'valor_mensal', 2000, 'dia_faturamento', 15, 'projeto', 'GRUPO TESTE', 'cliente_nome', 'CLIENTE TESTE UM'),
      jsonb_build_object('codigo_contrato', 9000000003, 'numero', 'T-003', 'documento', '11444777000161',
        'codigo_cliente_omie', 2, 'situacao', '10', 'vigencia_inicial', '2025-01-01', 'vigencia_final', '2026-10-31',
        'valor_mensal', 3000, 'dia_faturamento', 15, 'projeto', 'GRUPO TESTE', 'cliente_nome', 'CLIENTE TESTE DOIS'),
      jsonb_build_object('codigo_contrato', 9000000004, 'numero', 'T-004', 'documento', '11444777000161',
        'codigo_cliente_omie', 2, 'situacao', '10', 'vigencia_inicial', '2025-01-01', 'vigencia_final', null,
        'valor_mensal', 4000, 'dia_faturamento', 5, 'cliente_nome', 'CLIENTE TESTE DOIS')));
  if (select dia_faturamento from integracoes.omie_contratos_vigentes where emissora_id = _pac and codigo_contrato = 9000000001) <> 15
     or (select projeto from integracoes.omie_contratos_vigentes where emissora_id = _pac and codigo_contrato = 9000000001) <> 'GRUPO TESTE'
     or (select jsonb_array_length(itens) from integracoes.omie_contratos_vigentes where emissora_id = _pac and codigo_contrato = 9000000001) <> 1 then
    raise exception 'FALHOU E2: campos novos do contrato: %', r;
  end if;
  -- Outubro: T-001 faturou 1.000 (igual), T-002 faturou 1.800 (diferente), T-003 faturou 3.000 (venceu em 31/10),
  -- T-004 faturou 4.000. Um recibo pelo número do contrato do mesmo cliente; um com número de outro cliente fica fora.
  r := ops.fat_conector_notas_aplicar(_pac, '2026-10-01', '2026-10-31', jsonb_build_array(
    jsonb_build_object('chave', 'nfse:1', 'codigo_contrato', 9000000001, 'numero', '501', 'emitida_em', '2026-10-15', 'valor', 1000),
    jsonb_build_object('chave', 'nfse:2', 'codigo_contrato', 9000000002, 'numero', '502', 'emitida_em', '2026-10-15', 'valor', 1800),
    jsonb_build_object('chave', 'recibo:3', 'numero_contrato', 'T-003', 'codigo_cliente_omie', 2, 'numero', 'R3', 'emitida_em', '2026-10-15', 'valor', 3000),
    jsonb_build_object('chave', 'recibo:9', 'numero_contrato', 'T-003', 'codigo_cliente_omie', 1, 'numero', 'R9', 'emitida_em', '2026-10-15', 'valor', 50),
    jsonb_build_object('chave', 'nfse:4', 'codigo_contrato', 9000000004, 'numero', '504', 'emitida_em', '2026-10-05', 'valor', 4000),
    jsonb_build_object('chave', 'nfse:5', 'codigo_contrato', 9000000002, 'numero', '505', 'emitida_em', '2026-10-20', 'valor', 999, 'cancelada', true)));
  if (r ->> 'gravadas')::int <> 5 or (r ->> 'ignoradas')::int <> 1 then raise exception 'FALHOU E2: notas aplicadas: %', r; end if;
  if (select codigo_contrato from integracoes.omie_notas_contrato where emissora_id = _pac and chave = 'recibo:3') <> 9000000003 then
    raise exception 'FALHOU E2: recibo não ligou pelo número do contrato';
  end if;
  perform set_config('role', 'postgres', true);
end $e2$;

-- E3. Geração de novembro: motivos, automação do primeiro ciclo, corte e prazo.
do $e3$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  r jsonb;
  c receita.fat_competencias;
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;
  r := receita.fat_competencias_gerar('2026-11-01');
  select * into c from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000001 and competencia = '2026-11-01';
  if c.motivos <> '{}' or c.data_corte <> '2026-11-13' or c.automacao or c.valor_mes_anterior <> 1000 then
    raise exception 'FALHOU E3: T-001 sem mudança: % % % %', c.motivos, c.data_corte, c.automacao, c.valor_mes_anterior;
  end if;
  if (c.responder_ate at time zone 'America/Sao_Paulo') <> '2026-11-12 23:59:59' then
    raise exception 'FALHOU E3: prazo do T-001: %', c.responder_ate;
  end if;
  select * into c from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000002 and competencia = '2026-11-01';
  if c.motivos <> array['valor', 'vence'] or c.valor_mes_anterior <> 1800 then
    raise exception 'FALHOU E3: T-002 valor e vence (nota cancelada fora): % %', c.motivos, c.valor_mes_anterior;
  end if;
  select * into c from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000003 and competencia = '2026-11-01';
  if c.motivos <> array['sumiu'] or c.data_corte <> '2026-11-13' then raise exception 'FALHOU E3: T-003 sumiu: % %', c.motivos, c.data_corte; end if;
  select * into c from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000004 and competencia = '2026-11-01';
  if not c.automacao or c.data_corte <> '2026-11-05' then raise exception 'FALHOU E3: T-004 automação do Omie: % %', c.automacao, c.data_corte; end if;
  -- Idempotente.
  r := receita.fat_competencias_gerar('2026-11-01');
  if (select count(*) from receita.fat_competencias where emissora_id = _pac and codigo_contrato between 9000000001 and 9000000004) <> 4 then
    raise exception 'FALHOU E3: gerar de novo duplicou';
  end if;
end $e3$;

-- E4. Tela do dono: o Daniel vê e responde a PAC; o Hugo não vê a PAC.
do $e4$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  _daniel uuid := (select id from auth.users where email = 'daniel.faria@planning.com.br');
  _hugo uuid := (select id from auth.users where email = 'hugo.araujo@planning.com.br');
  _t1 uuid; _t2 uuid; _t3 uuid; _t4 uuid;
  r jsonb;
  _recusou boolean;
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;
  select id into _t1 from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000001;
  select id into _t2 from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000002;
  select id into _t3 from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000003;
  select id into _t4 from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000004;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _hugo), true);
  r := ops.fat_contratos_mes('2026-11-01', _pac);
  if jsonb_array_length(r -> 'linhas') <> 0 then raise exception 'FALHOU E4: Hugo vê a PAC'; end if;
  _recusou := false;
  begin perform ops.fat_contrato_responder(_t1, 'confirmar', '{}'); exception when insufficient_privilege then _recusou := true; end;
  if not _recusou then raise exception 'FALHOU E4: Hugo respondeu contrato da PAC'; end if;

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _daniel), true);
  r := ops.fat_contratos_mes('2026-11-01', _pac);
  if not exists (select 1 from jsonb_array_elements(r -> 'linhas') l
                  where (l ->> 'id')::uuid = _t1 and l ->> 'situacao' = 'fatura_sozinho' and (l ->> 'pode_responder')::boolean) then
    raise exception 'FALHOU E4: T-001 para o Daniel: %', (select l from jsonb_array_elements(r -> 'linhas') l where (l ->> 'id')::uuid = _t1);
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'linhas') l where (l ->> 'id')::uuid = _t4 and l ->> 'situacao' = 'automacao_omie'
                    and not (l ->> 'pode_responder')::boolean) then
    raise exception 'FALHOU E4: T-004 na automação';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'empresas') e where e ->> 'apelido' = 'PAC' and (e ->> 'precisa_resposta')::int >= 2) then
    raise exception 'FALHOU E4: contagem da PAC: %', r -> 'empresas';
  end if;

  -- Ajustar sem motivo é recusado; com motivo vira Valor ajustado.
  _recusou := false;
  begin perform ops.fat_contrato_responder(_t2, 'ajustar', '{"valor": 1800}'); exception when sqlstate '22023' then _recusou := true; end;
  if not _recusou then raise exception 'FALHOU E4: ajuste sem motivo passou'; end if;
  r := ops.fat_contrato_responder(_t2, 'ajustar', '{"valor": 1800, "motivo": "renegociado com o cliente", "permanente": true}');
  if r ->> 'situacao' <> 'ajustado' or (r ->> 'valor_faturar')::numeric <> 1800 or r ->> 'acao_contrato' <> 'mudar_valor' then
    raise exception 'FALHOU E4: ajuste: %', r;
  end if;
  -- Contrato que sumiu não se confirma; fatura com valor e motivo.
  _recusou := false;
  begin perform ops.fat_contrato_responder(_t3, 'confirmar', '{}'); exception when sqlstate '22023' then _recusou := true; end;
  if not _recusou then raise exception 'FALHOU E4: confirmou contrato que sumiu'; end if;
  r := ops.fat_contratos_confirmar(array[_t3, _t1]);
  if (r ->> 'confirmados')::int <> 1 or jsonb_array_length(r -> 'recusados') <> 1 then raise exception 'FALHOU E4: lote: %', r; end if;
  r := ops.fat_contrato_responder(_t3, 'faturar_mes', '{"valor": 3000, "motivo": "renovado, falta mudar no Omie", "vigencia": "2027-10-31"}');
  if r ->> 'situacao' <> 'ajustado' or r ->> 'acao_contrato' <> 'renovar' then raise exception 'FALHOU E4: faturar o que sumiu: %', r; end if;
  -- Automação não se responde.
  _recusou := false;
  begin perform ops.fat_contrato_responder(_t4, 'nao_faturar', '{"motivo": "x"}'); exception when sqlstate '55000' then _recusou := true; end;
  if not _recusou then raise exception 'FALHOU E4: respondeu contrato da automação'; end if;
  -- Detalhe com notas e histórico.
  r := ops.fat_contrato_detalhe(_t2);
  if jsonb_array_length(r -> 'notas') <> 2 or jsonb_array_length(r -> 'historico') <> 1 then
    raise exception 'FALHOU E4: detalhe: notas % histórico %', r -> 'notas', r -> 'historico';
  end if;
  -- Repasse para quem não tem acesso ao Faturamento é recusado; para o Hugo, que tem, passa e ele passa a ver.
  r := ops.fat_contrato_repassar(_t1, _hugo);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _hugo), true);
  r := ops.fat_contratos_mes('2026-11-01', _pac);
  if jsonb_array_length(r -> 'linhas') <> 1 or not (r -> 'linhas' -> 0 ->> 'pode_responder')::boolean then
    raise exception 'FALHOU E4: repasse ao Hugo: %', r -> 'linhas';
  end if;
  perform set_config('role', 'postgres', true);
end $e4$;

-- E5. Prazo vencido: Precisa de resposta vira Sem resposta, e responder é recusado.
do $e5$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  _daniel uuid := (select id from auth.users where email = 'daniel.faria@planning.com.br');
  _t uuid;
  l record;
  _recusou boolean := false;
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;
  insert into receita.fat_competencias (emissora_id, codigo_contrato, competencia, cliente_nome, data_faturamento,
    data_corte, responder_ate, valor_contrato, motivos)
  values (_pac, 9000000009, '2026-11-01', 'CLIENTE PRAZO', '2026-11-15', '2026-11-13', now() - interval '1 minute', 500, array['novo'])
  returning id into _t;
  select * into l from receita.fat_comp_linhas('2026-11-01') x where x.id = _t;
  if l.situacao <> 'sem_resposta' or l.instrucao <> 'nao_faturar' then raise exception 'FALHOU E5: % %', l.situacao, l.instrucao; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _daniel), true);
  begin perform ops.fat_contrato_responder(_t, 'confirmar', '{}'); exception when sqlstate '55000' then _recusou := true; end;
  if not _recusou then raise exception 'FALHOU E5: respondeu fora do prazo'; end if;
  perform set_config('role', 'postgres', true);
end $e5$;

-- E6. Lista do corte de 13/11 (o Pedro, super admin, como tesouraria) e o depois do corte.
do $e6$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _daniel uuid := (select id from auth.users where email = 'daniel.faria@planning.com.br');
  r jsonb;
  _t2 uuid;
  _recusou boolean := false;
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;
  select id into _t2 from receita.fat_competencias where emissora_id = _pac and codigo_contrato = 9000000002;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _daniel), true);
  begin perform ops.fat_corte('2026-11-13', _pac); exception when insufficient_privilege then _recusou := true; end;
  if not _recusou then raise exception 'FALHOU E6: dono abriu a lista do corte'; end if;

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _pedro), true);
  r := ops.fat_corte('2026-11-13', _pac);
  if not (r ->> 'lista_aberta')::boolean then raise exception 'FALHOU E6: lista de 13/11 deveria estar aberta'; end if;
  if (select l ->> 'instrucao' from jsonb_array_elements(r -> 'linhas') l where (l ->> 'codigo_contrato')::bigint = 9000000002) <> 'outro_valor'
     or (select l ->> 'instrucao' from jsonb_array_elements(r -> 'linhas') l where (l ->> 'codigo_contrato')::bigint = 9000000001) <> 'como_esta'
     or exists (select 1 from jsonb_array_elements(r -> 'linhas') l where (l ->> 'codigo_contrato')::bigint = 9000000004) then
    raise exception 'FALHOU E6: instruções do corte: %', (select jsonb_agg(l) from jsonb_array_elements(r -> 'linhas') l
                                                          where (l ->> 'codigo_contrato')::bigint between 9000000001 and 9000000009);
  end if;
  r := ops.fat_corte_feito(_t2, true);
  if r -> 'feito_omie' is null then raise exception 'FALHOU E6: feito no Omie: %', r; end if;
  perform set_config('role', 'service_role', true);
  -- Novembro: T-001 faturou certo, T-002 faturou 2.000 em vez de 1.800.
  r := ops.fat_conector_notas_aplicar(_pac, '2026-11-01', '2026-11-30', jsonb_build_array(
    jsonb_build_object('chave', 'nfse:11', 'codigo_contrato', 9000000001, 'numero', '601', 'emitida_em', '2026-11-13', 'valor', 1000),
    jsonb_build_object('chave', 'nfse:12', 'codigo_contrato', 9000000002, 'numero', '602', 'emitida_em', '2026-11-13', 'valor', 2000)));
  perform set_config('role', 'postgres', true);
  if (select pos_corte from receita.fat_comp_linhas('2026-11-01') where emissora_id = _pac and codigo_contrato = 9000000001) <> 'faturado'
     or (select pos_corte from receita.fat_comp_linhas('2026-11-01') where emissora_id = _pac and codigo_contrato = 9000000002) <> 'faturado_diferente' then
    raise exception 'FALHOU E6: depois do corte';
  end if;
end $e6$;

-- E7. Acesso: o navegador não lê as tabelas nem chama as funções internas.
do $e7$
begin
  if to_regclass('receita.fat_competencias') is null then return; end if;
  if has_table_privilege('authenticated', 'receita.fat_competencias', 'select')
     or has_table_privilege('authenticated', 'integracoes.omie_notas_contrato', 'select')
     or has_function_privilege('authenticated', 'receita.fat_competencias_gerar(date)', 'execute')
     or not has_function_privilege('authenticated', 'ops.fat_contratos_mes(date, uuid)', 'execute')
     or has_function_privilege('anon', 'ops.fat_contratos_mes(date, uuid)', 'execute') then
    raise exception 'FALHOU E7: acessos';
  end if;
end $e7$;

-- @@ROLLBACK@@

-- R. Com o rollback dentro da transação: tabelas e funções do recorrente saem; o aviso de contrato continua.
do $r$
begin
  if to_regclass('receita.fat_competencias') is not null then return; end if;
  if to_regclass('integracoes.omie_notas_contrato') is not null or to_regprocedure('ops.fat_corte(date, uuid)') is not null then
    raise exception 'FALHOU R: sobrou parte do recorrente';
  end if;
  if to_regprocedure('receita.fat_contratos_vigentes(text)') is null then raise exception 'FALHOU R: aviso de contrato sumiu'; end if;
  if exists (select 1 from cron.job where jobname in ('faturamento-omie-notas', 'faturamento-omie-notas-dia', 'faturamento-competencias')) then
    raise exception 'FALHOU R: job do recorrente sobrou';
  end if;
end $r$;

rollback;
