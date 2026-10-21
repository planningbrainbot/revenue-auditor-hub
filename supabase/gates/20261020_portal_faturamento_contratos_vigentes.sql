-- Ensaio de 20261020230000_portal_faturamento_contratos_vigentes.sql (CA-04, 20/10/2026) e do rollback dela.
--
-- Uma transação que termina em ROLLBACK: nada sobrevive (contratos de teste, papel, pedido, envios). Cada teste levanta
-- exceção quando falha (FALHOU Kn). Como rodar: python3 -I e1/ensaio.py <este arquivo> --migration <migration>
-- --rollback <rollback>; depois de aplicar, com --vazio (o bloco R só confere quando o rollback entrou).
-- O caso literal do CA-04: CNPJ 11.222.333/0001-81 (de teste) com contrato vigente na PAC, pedido pela PRJ → aviso e
-- "confirmo a empresa" obrigatório. O pedido de teste tem número explícito (FAT-1999-…): não gasta a numeração. O
-- Pedro é o autor e dono na PRJ só dentro da transação.

begin;

select set_config('ensaio.jobs', (
  select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
    from cron.job where jobname <> 'faturamento-omie-contratos'), true);

-- @@MIGRATION@@

-- K1. Aplicar (service_role): substitui o conjunto da emissora; documento inválido é ignorado.
set local role service_role;
do $k1$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  r jsonb;
begin
  r := ops.fat_conector_contratos_aplicar(_pac, jsonb_build_array(
    jsonb_build_object('codigo_contrato', 990001, 'numero', 'ENSAIO-1', 'documento', '11.222.333/0001-81', 'situacao', '10',
                       'vigencia_inicial', '2026-01-01', 'vigencia_final', null, 'valor_mensal', 2500),
    jsonb_build_object('codigo_contrato', 990002, 'documento', '11222333000181', 'situacao', '10',
                       'vigencia_inicial', '2025-01-01', 'vigencia_final', '2025-12-31', 'valor_mensal', 100),
    jsonb_build_object('codigo_contrato', 990003, 'documento', '11.111.111/1111-11', 'situacao', '10')));
  if (r ->> 'gravados')::int <> 2 or (r ->> 'ignorados')::int <> 1 then
    raise exception 'FALHOU K1: aplicar devolveu %', r;
  end if;
  r := ops.fat_conector_contratos_aplicar(_pac, jsonb_build_array(
    jsonb_build_object('codigo_contrato', 990001, 'documento', '11222333000181', 'situacao', '10', 'vigencia_inicial', '2026-01-01')));
  if (r ->> 'removidos')::int < 1 or exists (select 1 from integracoes.omie_contratos_vigentes where codigo_contrato = 990002) then
    raise exception 'FALHOU K1: o conjunto da emissora não foi substituído: %', r;
  end if;
  begin
    perform ops.fat_conector_contratos_aplicar(_pac, '{}'::jsonb);
    raise exception 'FALHOU K1: aceitou p_contratos que não é lista';
  exception when sqlstate '22023' then null;
  end;
end $k1$;
reset role;

-- K2. O navegador não lê a tabela nem aplica.
set local role authenticated;
do $k2$
begin
  begin
    perform ops.fat_conector_contratos_aplicar('8cdf5de7-683f-4d8e-a194-f303677ac6ea', '[]'::jsonb);
    raise exception 'FALHOU K2: authenticated aplicou contratos';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from integracoes.omie_contratos_vigentes limit 1;
    raise exception 'FALHOU K2: authenticated leu a tabela';
  exception when insufficient_privilege then null;
  end;
end $k2$;
reset role;

-- K3. CA-04, o caso literal: contrato vigente na PAC, pedido pela PRJ.
do $k3$
declare
  _pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  _prj constant uuid := 'f85b9ff8-d04f-4cf3-b045-86c177c82237';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _claims constant text := '{"sub":"5c4d0e46-fc33-4132-bcca-47c05ad001c7","role":"authenticated"}';
  _srv uuid;
  _id uuid;
  r jsonb;
  _det text;
  _ok boolean := false;
begin
  if not exists (select 1 from receita.fat_contratos_vigentes('11222333000181') v where v.emissora_id = _pac) then
    raise exception 'FALHOU K3: o contrato da PAC não aparece em receita.fat_contratos_vigentes';
  end if;
  -- O Pedro pede pela PRJ (dono só nesta transação).
  insert into receita.fat_donos (emissora_id, user_id, papel, ativo) values (_prj, _pedro, 'dono', true)
  on conflict (emissora_id, user_id, papel) do update set ativo = true;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', _claims, true);
  r := ops.fat_tomador('11.222.333/0001-81', _prj);
  if jsonb_array_length(r -> 'contratos_outra_emissora') <> 1
     or r #>> '{contratos_outra_emissora,0,emissora,apelido}' <> 'PAC'
     or r #> '{contratos_outra_emissora,0,numero}' <> 'null'::jsonb
     or r #> '{contratos_outra_emissora,0,valor_mensal}' <> 'null'::jsonb then
    raise exception 'FALHOU K3: fat_tomador pela PRJ não avisou do contrato da PAC (ou mostrou número/valor): %', r -> 'contratos_outra_emissora';
  end if;
  -- Pela própria PAC: não há outra empresa.
  r := ops.fat_tomador('11222333000181', _pac);
  if jsonb_array_length(r -> 'contratos_outra_emissora') <> 0 then
    raise exception 'FALHOU K3: pela PAC avisou de contrato em outra empresa: %', r -> 'contratos_outra_emissora';
  end if;
  perform set_config('role', 'postgres', true);

  -- O pedido (rascunho completo, sem confirmar a empresa) pela PRJ.
  select s.id into _srv from receita.fat_servicos s
   where s.emissora_id = _prj and s.ativo and s.tem_tributacao and coalesce(s.no_omie, true) order by s.codigo limit 1;
  insert into receita.fat_pedidos (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, emails_envio,
                                   projeto, servico_id, descricao_nf, valor, forma, parcelas, primeiro_vencimento,
                                   documento, meio, observacoes, dono_id, solicitante_id, status, confirmou_emissora)
  values ('FAT-1999-000904', _prj, 'pj', '11222333000181', 'CLIENTE DO ENSAIO CA-04', array['ensaio@exemplo.com.br'],
          'Ensaio CA-04', _srv, 'Ensaio CA-04', 100, 'avulso', 1, receita.fat_hoje() + 30, 'nf', 'boleto',
          'Ensaio do gate CA-04', _pedro, _pedro, 'rascunho', false)
  returning id into _id;

  perform set_config('role', 'authenticated', true);
  begin
    perform ops.fat_pedido_enviar(_id);
  exception when sqlstate '22023' then
    get stacked diagnostics _det = pg_exception_detail;
    _ok := _det like '%confirmou_emissora%';
  end;
  if not _ok then raise exception 'FALHOU K3: enviar sem "confirmo a empresa" não foi recusado pelo campo (detalhe: %)', _det; end if;
  perform set_config('role', 'postgres', true);
  update receita.fat_pedidos set confirmou_emissora = true where id = _id;
  perform set_config('role', 'authenticated', true);
  r := ops.fat_pedido_enviar(_id);
  if r ->> 'status' <> 'na_fila_omie' then
    raise exception 'FALHOU K3: com "confirmo a empresa" o envio não foi para a fila: %', r;
  end if;
  perform set_config('role', 'postgres', true);
end $k3$;

-- K4. Fila: uma leitura por emissora ativa com Omie, sem duplicar; o cron diário existe; os outros jobs não mudaram.
do $k4$
declare
  n int;
  m int;
begin
  n := (integracoes.fat_contratos_enfileirar() ->> 'enfileirados')::int;
  select count(*) into m from organizacao.empresas_grupo where ativa and omie_credencial_ref is not null;
  if (select count(*) from integracoes.omie_envios where operacao = 'sincronizar_contratos' and status in ('pendente', 'processando')) < m
     or n > m then
    raise exception 'FALHOU K4: enfileirou % (emissoras ativas com Omie: %)', n, m;
  end if;
  if (integracoes.fat_contratos_enfileirar() ->> 'enfileirados')::int <> 0 then
    raise exception 'FALHOU K4: enfileirar de novo duplicou';
  end if;
  if not integracoes.fat_tem_trabalho() then raise exception 'FALHOU K4: a fila de contratos não acorda o cron'; end if;
  if not exists (select 1 from cron.job where jobname = 'faturamento-omie-contratos' and schedule = '0 9 * * *' and active
                  and command like '%integracoes.fat_contratos_enfileirar()%') then
    raise exception 'FALHOU K4: job diário das 6h ausente';
  end if;
  if (select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
        from cron.job where jobname <> 'faturamento-omie-contratos') <> current_setting('ensaio.jobs') then
    raise exception 'FALHOU K4: outro job do pg_cron mudou';
  end if;
end $k4$;

select set_config('ensaio.tabela_antes_do_rollback', (to_regclass('integracoes.omie_contratos_vigentes') is not null)::text, true);

-- @@ROLLBACK@@

do $r$
begin
  if (to_regclass('integracoes.omie_contratos_vigentes') is not null)::text = current_setting('ensaio.tabela_antes_do_rollback') then
    return;  -- --vazio: o rollback não entrou
  end if;
  if exists (select 1 from cron.job where jobname = 'faturamento-omie-contratos') then raise exception 'FALHOU R1: job sobrou'; end if;
  if pg_get_functiondef('receita.fat_contratos_vigentes(text)'::regprocedure) like '%omie_contratos_vigentes%' then
    raise exception 'FALHOU R1: receita.fat_contratos_vigentes não voltou';
  end if;
end $r$;

rollback;
