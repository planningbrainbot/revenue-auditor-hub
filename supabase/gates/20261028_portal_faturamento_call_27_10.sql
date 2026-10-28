-- Ensaio das mudanças da call de 27/10/2026 no Portal de Faturamento e do rollback delas:
--   20261028170000_portal_faturamento_call_27_10.sql (busca de clientes, lista de projetos, Pipefy só com a empresa ligada)
--
-- Uma transação que termina em ROLLBACK: nada sobrevive (papéis, pedidos, envios, eventos). Cada teste levanta exceção
-- quando falha (FALHOU Xn). Como rodar, de PM Work/execution/portal-faturamento-prd-20261013/e1/:
--   python3 -I ensaio.py <este arquivo> --migration <M> --rollback <R>
-- Depois de aplicar, com --vazio (o bloco R só confere quando o rollback entrou).
-- Dados de referência lidos em 28/10: na DOC, o cliente do Omie PHARMAMED LOGISTICA E ARMAZENAMENTO LTDA
-- (36.901.046/0001-29), a pessoa física CICERO RIBEIRO DINIZ e o projeto TERRAL nos lançamentos. O pedido de teste tem
-- número explícito (FAT-1999-…): não gasta a numeração. O Pedro é dono na DOC e na PRJ só dentro da transação.

begin;

-- @@MIGRATION@@

-- C1. Busca de clientes: nome, começo do CNPJ, texto curto, PF só para quem tem papel, recusa sem papel.
do $c1$
declare
  _doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _aguiar uuid := (select id from auth.users where email = 'ana.aguiar@planning.com.br');
  _daniel uuid := (select id from auth.users where email = 'daniel.faria@planning.com.br');
  _fora uuid;
  r jsonb;
  _recusou boolean := false;
begin
  insert into receita.fat_donos (emissora_id, user_id, papel, ativo) values (_doc, _pedro, 'dono', true)
  on conflict (emissora_id, user_id, papel) do update set ativo = true;
  -- Uma empresa ativa em que o Daniel não tem papel (ele não é tesouraria nem controladoria).
  select g.id into _fora from organizacao.empresas_grupo g
   where g.ativa and not exists (select 1 from receita.fat_donos d where d.emissora_id = g.id and d.user_id = _daniel and d.ativo)
   order by g.apelido limit 1;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _pedro), true);
  r := ops.fat_clientes_busca(_doc, 'pharmamed log');
  if not exists (select 1 from jsonb_array_elements(r -> 'itens') i
                  where i ->> 'documento' = '36901046000129' and i ->> 'fonte' = 'omie' and i ->> 'tipo' = 'pj') then
    raise exception 'FALHOU C1: nome não achou o cliente do Omie: %', r;
  end if;
  if not (r #>> '{fontes,omie}')::boolean then raise exception 'FALHOU C1: fontes.omie falso na DOC: %', r -> 'fontes'; end if;
  r := ops.fat_clientes_busca(_doc, '36.901.046');
  if (r -> 'itens' -> 0 ->> 'documento') is distinct from '36901046000129' then
    raise exception 'FALHOU C1: começo do CNPJ não achou: %', r;
  end if;
  r := ops.fat_clientes_busca(_doc, 'ph');
  if not (r ->> 'curto')::boolean or jsonb_array_length(r -> 'itens') <> 0 then
    raise exception 'FALHOU C1: texto curto devolveu itens: %', r;
  end if;
  r := ops.fat_clientes_busca(_doc, 'ltda');
  if jsonb_array_length(r -> 'itens') > 20 or not (r ->> 'mais')::boolean then
    raise exception 'FALHOU C1: limite de 20 / mais: % itens, mais=%', jsonb_array_length(r -> 'itens'), r ->> 'mais';
  end if;
  r := ops.fat_clientes_busca(_doc, 'cicero ribeiro');
  if not exists (select 1 from jsonb_array_elements(r -> 'itens') i where i ->> 'tipo' = 'pf') then
    raise exception 'FALHOU C1: dono não achou a pessoa física: %', r;
  end if;

  -- A tesouraria sem papel na DOC busca, mas sem pessoa física.
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _aguiar), true);
  r := ops.fat_clientes_busca(_doc, 'cicero ribeiro');
  if exists (select 1 from jsonb_array_elements(r -> 'itens') i where i ->> 'tipo' = 'pf') then
    raise exception 'FALHOU C1: pessoa física para quem não tem papel: %', r;
  end if;

  -- Sem papel nem tesouraria na empresa: recusa.
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _daniel), true);
  begin
    perform ops.fat_clientes_busca(_fora, 'ltda');
  exception when insufficient_privilege then _recusou := true;
  end;
  if not _recusou then raise exception 'FALHOU C1: busca sem papel na empresa passou'; end if;
  _recusou := false;
  begin
    perform ops.fat_projetos(_fora);
  exception when insufficient_privilege then _recusou := true;
  end;
  if not _recusou then raise exception 'FALHOU P1: projetos sem papel na empresa passou'; end if;
  perform set_config('role', 'postgres', true);
end $c1$;

-- C2. anon não executa as funções novas.
do $c2$
begin
  if has_function_privilege('anon', 'ops.fat_clientes_busca(uuid, text)', 'execute')
     or has_function_privilege('anon', 'ops.fat_projetos(uuid)', 'execute') then
    raise exception 'FALHOU C2: anon executa as funções novas';
  end if;
  if not has_function_privilege('authenticated', 'ops.fat_clientes_busca(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'ops.fat_projetos(uuid)', 'execute') then
    raise exception 'FALHOU C2: authenticated não executa as funções novas';
  end if;
end $c2$;

-- P1. Projetos da DOC: TERRAL vem dos lançamentos, N/D não entra, sem repetição pela chave.
do $p1$
declare
  _doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  r jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _pedro), true);
  r := ops.fat_projetos(_doc);
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from jsonb_array_elements(r -> 'itens') i where upper(i ->> 'projeto') = 'TERRAL') then
    raise exception 'FALHOU P1: TERRAL fora da lista: %', left(r::text, 400);
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'itens') i where upper(i ->> 'projeto') in ('N/D', 'ND')) then
    raise exception 'FALHOU P1: N/D na lista';
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'itens') i)
     <> (select count(distinct upper(i ->> 'projeto')) from jsonb_array_elements(r -> 'itens') i) then
    raise exception 'FALHOU P1: projeto repetido na lista';
  end if;
end $p1$;

-- T1. Pipefy desligado: o pedido vai à fila sem envio do Pipefy; sem departamento, o envio passa.
do $t1$
declare
  _prj constant uuid := 'f85b9ff8-d04f-4cf3-b045-86c177c82237';
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _srv uuid;
  _id uuid;
  r jsonb;
begin
  if (select pipefy_sync from organizacao.empresas_grupo where id = _prj) then
    raise exception 'FALHOU T1: a PRJ está com o Pipefy ligado (o ensaio supõe desligado)';
  end if;
  insert into receita.fat_donos (emissora_id, user_id, papel, ativo) values (_prj, _pedro, 'dono', true)
  on conflict (emissora_id, user_id, papel) do update set ativo = true;
  select s.id into _srv from receita.fat_servicos s
   where s.emissora_id = _prj and s.ativo and s.tem_tributacao and coalesce(s.no_omie, true) order by s.codigo limit 1;
  insert into receita.fat_pedidos (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, emails_envio,
                                   projeto, servico_id, descricao_nf, valor, forma, parcelas, primeiro_vencimento,
                                   documento, meio, observacoes, dono_id, solicitante_id, status, departamento)
  values ('FAT-1999-000931', _prj, 'pj', '36901046000129', 'CLIENTE DO ENSAIO 28/10', array['ensaio@exemplo.com.br'],
          'Ensaio call 27/10', _srv, 'Ensaio call 27/10', 100, 'avulso', 1, receita.fat_hoje() + 10, 'nf', 'boleto',
          'Ensaio do gate de 28/10', _pedro, _pedro, 'rascunho', null)
  returning id into _id;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', _pedro), true);
  r := ops.fat_pedido_enviar(_id);
  perform set_config('role', 'postgres', true);
  if r ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU T1: sem departamento não foi para a fila: %', r; end if;
  if exists (select 1 from integracoes.pipefy_envios x where x.origem = 'fat_pedido' and x.origem_id = _id) then
    raise exception 'FALHOU T1: montou envio do Pipefy com a empresa desligada';
  end if;
  -- Mais uma mudança (pedir cancelamento) também não monta nada.
  perform receita.fat_transicao(_id, 'cancelamento_pedido', 'Ensaio do gate de 28/10');
  if exists (select 1 from integracoes.pipefy_envios x where x.origem = 'fat_pedido' and x.origem_id = _id) then
    raise exception 'FALHOU T1: mover_fase do Pipefy com a empresa desligada';
  end if;
end $t1$;

-- @@ROLLBACK@@

-- R. Com o rollback dentro da transação: as funções novas saem e o fat_transicao volta a montar o Pipefy sempre.
do $r$
begin
  if to_regprocedure('ops.fat_clientes_busca(uuid, text)') is not null then
    if to_regprocedure('ops.fat_projetos(uuid)') is null then raise exception 'FALHOU R: só uma função saiu'; end if;
    return; -- sem rollback (ensaio da migration sozinha ou --vazio depois de aplicar)
  end if;
  if position('_pipefy' in pg_get_functiondef('receita.fat_transicao(uuid,text,text,text,jsonb)'::regprocedure)) > 0 then
    raise exception 'FALHOU R: o rollback não devolveu o fat_transicao anterior';
  end if;
end $r$;

rollback;
