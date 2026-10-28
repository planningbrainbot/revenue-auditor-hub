-- Portal de Faturamento · mudanças da call de 27/10/2026 (Daniel, Ana Carvalhais, Ana Paula, Ludmilla, Victor, Pedro).
--
-- No teste ao vivo do Novo pedido, o Daniel pediu que o formulário trabalhe com o cadastro que já existe, sem a pessoa
-- redigitar: o cliente escolhido numa lista com busca ("uma lista suspensa aqui que ele vai poder pesquisar pelo nome e
-- tal, CNPJ") e o projeto também ("um cadastro padrão de projeto também com um drop-down"). E disse que o card do
-- Pipefy "a gente pode tirar daqui": o portal já guarda a situação de cada pedido. O Pedro confirmou em 28/10 ("Tirar o
-- Pipefy").
--
-- O que muda no banco:
--   1. ops.fat_clientes_busca(p_emissora, p_texto): os clientes da empresa que fatura, por nome ou CNPJ/CPF, para a lista
--      do campo "Cliente". Fontes, nesta ordem: o cadastro do Omie da empresa (financeiro.omie_contraparte, casada com a
--      emissora pelo CNPJ), os clientes de pedidos anteriores da empresa no portal e a base de clientes (ops.empresas, só
--      PJ). Mínimo de 3 caracteres, até 20 itens. Pessoa física só para quem tem papel na empresa (o mesmo cuidado do
--      fat_tomador). Escolhido o cliente, a tela segue pelo ops.fat_tomador como antes (Receita, bloqueio, e-mails,
--      contrato em outra empresa).
--   2. ops.fat_projetos(p_emissora): os projetos já usados pela empresa, para a lista do campo "Projeto": o campo projeto
--      dos lançamentos do Omie da empresa (financeiro.lancamentos) e os pedidos do portal. A pessoa ainda pode digitar um
--      projeto novo. Mesma chave da Ana: aparado, espaços juntados, comparado em maiúsculas.
--   3. receita.fat_transicao: o envio do Pipefy só é montado quando a empresa tem o Pipefy ligado (pipefy_sync). Hoje
--      nenhuma tem: o pedido deixa de criar a linha "card montado e guardado" a cada mudança.
--
-- As duas funções leem tabelas do Financeiro que ainda vivem no banco único (cópia do Financial Brain). Se uma delas sair,
-- a função devolve a lista sem aquela fonte e diz isso em `fontes`, em vez de quebrar o formulário.
-- Departamento: nada muda no banco. A coluna fica (nula nos pedidos novos) e nenhuma função a exige.
-- Ensaio (begin … rollback): supabase/gates/20261028_portal_faturamento_call_27_10.sql
-- Rollback: supabase/rollback/20261028170000_portal_faturamento_call_27_10_rollback.sql

begin;

-- =================================================================================================================
-- 1. Busca de clientes da empresa
-- =================================================================================================================
create or replace function ops.fat_clientes_busca(p_emissora uuid, p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  _e receita.fat_escopo_t;
  _txt text := btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  _por_doc boolean;
  _dig text;
  _palavras text[];
  _ve_pf boolean;
  _cnpj_emissora text;
  _omie jsonb := '[]';
  _portal jsonb := '[]';
  _base jsonb := '[]';
  _omie_fonte jsonb;
  _omie_lido timestamptz;
  _itens jsonb;
  _n int;
  _limite constant int := 20;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is null or not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  -- Nome e documento de pessoa física só para quem tem papel na empresa (como no fat_tomador).
  _ve_pf := p_emissora = any (_e.papel);
  select regexp_replace(g.cnpj, '\D', '', 'g') into _cnpj_emissora from organizacao.empresas_grupo g where g.id = p_emissora;

  if char_length(_txt) < 3 then
    return jsonb_build_object('itens', '[]'::jsonb, 'curto', true, 'mais', false, 'limite', _limite, 'fontes', null);
  end if;
  -- Só dígitos e pontuação de documento: busca pelo CNPJ/CPF (começo do número); senão, pelo nome, palavra a palavra.
  _por_doc := _txt ~ '^[0-9./ -]+$' and char_length(regexp_replace(_txt, '\D', '', 'g')) >= 3;
  _dig := regexp_replace(_txt, '\D', '', 'g');
  _palavras := array(select w from unnest(string_to_array(lower(extensions.unaccent(_txt)), ' ')) w where w <> '');

  -- Omie da empresa. A tabela é a cópia do Financial Brain no banco único: sem ela, segue sem esta fonte.
  begin
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'), max(s.sync_at) into _omie, _omie_lido
      from (select c.doc_digitos as documento, btrim(c.razao_social) as nome,
                   nullif(btrim(c.nome_fantasia), '') as fantasia, 'omie' as fonte, 1 as prio, c.sync_at
              from financeiro.empresas f
              join financeiro.omie_contraparte c on c.empresa_id = f.id
             where regexp_replace(f.cnpj, '\D', '', 'g') = _cnpj_emissora
               and char_length(coalesce(c.doc_digitos, '')) in (11, 14)
               and (_ve_pf or char_length(c.doc_digitos) = 14)
               and case when _por_doc then c.doc_digitos like _dig || '%'
                        else not exists (select 1 from unnest(_palavras) w
                                          where position(w in lower(extensions.unaccent(
                                                  coalesce(c.razao_social, '') || ' ' || coalesce(c.nome_fantasia, '')))) = 0)
                   end
             order by btrim(c.razao_social)
             limit 60) s;
    _omie_fonte := jsonb_build_object('omie', jsonb_array_length(_omie) > 0 or exists (
                     select 1 from financeiro.empresas f join financeiro.omie_contraparte c on c.empresa_id = f.id
                      where regexp_replace(f.cnpj, '\D', '', 'g') = _cnpj_emissora),
                     'omie_lido_em', _omie_lido);
  exception when undefined_table or undefined_column then
    _omie := '[]';
    _omie_fonte := jsonb_build_object('omie', false, 'omie_lido_em', null);
  end;

  -- Clientes de pedidos anteriores da empresa no portal (fora rascunhos de outras pessoas).
  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into _portal
    from (select p.tomador_documento as documento,
                 (array_agg(btrim(p.tomador_nome) order by p.created_at desc))[1] as nome,
                 null::text as fantasia, 'portal' as fonte, 2 as prio
            from receita.fat_pedidos p
           where p.emissora_id = p_emissora
             and char_length(coalesce(p.tomador_documento, '')) in (11, 14)
             and (_ve_pf or char_length(p.tomador_documento) = 14)
             and (p.status <> 'rascunho' or p.solicitante_id = _e.uid)
             and nullif(btrim(p.tomador_nome), '') is not null
             and case when _por_doc then p.tomador_documento like _dig || '%'
                      else not exists (select 1 from unnest(_palavras) w
                                        where position(w in lower(extensions.unaccent(p.tomador_nome))) = 0)
                 end
           group by p.tomador_documento
           limit 60) s;

  -- Base de clientes do grupo (só PJ).
  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into _base
    from (select receita.fat_documento_normalizar(x.cnpj) as documento, btrim(x.razao_social) as nome,
                 nullif(btrim(x.titulo), '') as fantasia, 'base' as fonte, 3 as prio
            from ops.empresas x
           where char_length(coalesce(receita.fat_documento_normalizar(x.cnpj), '')) = 14
             and nullif(btrim(x.razao_social), '') is not null
             and case when _por_doc then regexp_replace(x.cnpj, '\D', '', 'g') like _dig || '%'
                      else not exists (select 1 from unnest(_palavras) w
                                        where position(w in lower(extensions.unaccent(
                                                coalesce(x.razao_social, '') || ' ' || coalesce(x.titulo, '')))) = 0)
                 end
           order by btrim(x.razao_social)
           limit 60) s;

  -- Um item por documento (o Omie da empresa primeiro); o número exato e o nome que começa com o texto vêm antes.
  with todos as (
    select distinct on (i ->> 'documento') i
      from jsonb_array_elements(_omie || _portal || _base) i
     order by i ->> 'documento', (i ->> 'prio')::int
  ), ordenados as (
    select i, row_number() over (
             order by (i ->> 'documento') = _dig desc,
                      lower(extensions.unaccent(i ->> 'nome')) like (coalesce(_palavras[1], '') || '%') desc,
                      i ->> 'nome') as ordem,
           count(*) over () as total
      from todos
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'documento', i ->> 'documento',
           'tipo', case when char_length(i ->> 'documento') = 11 then 'pf' else 'pj' end,
           'nome', i ->> 'nome',
           'fantasia', case when lower(i ->> 'fantasia') <> lower(i ->> 'nome') then i ->> 'fantasia' end,
           'fonte', i ->> 'fonte') order by ordem) filter (where ordem <= _limite), '[]'),
         coalesce(max(total), 0)
    into _itens, _n
    from ordenados;

  return jsonb_build_object('itens', _itens, 'curto', false, 'mais', _n > _limite, 'limite', _limite,
                            'fontes', _omie_fonte);
end $$;

comment on function ops.fat_clientes_busca(uuid, text) is
  'Portal de Faturamento: clientes da empresa que fatura por nome ou CNPJ/CPF (lista do campo Cliente do Novo pedido, '
  'call de 27/10/2026). Omie da empresa, pedidos anteriores do portal e base de clientes (PJ). Mínimo 3 caracteres, até '
  '20 itens. PF só para quem tem papel na empresa.';

revoke all on function ops.fat_clientes_busca(uuid, text) from public, anon;
grant execute on function ops.fat_clientes_busca(uuid, text) to authenticated;

-- =================================================================================================================
-- 2. Projetos já usados pela empresa
-- =================================================================================================================
create or replace function ops.fat_projetos(p_emissora uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  _e receita.fat_escopo_t;
  _cnpj_emissora text;
  _omie jsonb := '[]';
  _portal jsonb := '[]';
  _tem_omie boolean := true;
  _itens jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is null or not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  select regexp_replace(g.cnpj, '\D', '', 'g') into _cnpj_emissora from organizacao.empresas_grupo g where g.id = p_emissora;

  -- O campo projeto dos lançamentos do Omie da empresa (cópia do Financial Brain; sem ela, segue sem esta fonte).
  begin
    select coalesce(jsonb_agg(to_jsonb(s)), '[]') into _omie
      from (select upper(regexp_replace(btrim(l.projeto), '\s+', ' ', 'g')) as chave,
                   mode() within group (order by regexp_replace(btrim(l.projeto), '\s+', ' ', 'g')) as projeto,
                   count(*) as usos, max(l.competencia) as ultimo
              from financeiro.empresas f
              join financeiro.lancamentos l on l.empresa_id = f.id
             where regexp_replace(f.cnpj, '\D', '', 'g') = _cnpj_emissora
               and nullif(btrim(l.projeto), '') is not null
               and upper(btrim(l.projeto)) not in ('N/D', 'ND', 'N/A', '-', 'SEM PROJETO')
             group by 1) s;
  exception when undefined_table or undefined_column then
    _omie := '[]';
    _tem_omie := false;
  end;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into _portal
    from (select upper(p.projeto) as chave,
                 mode() within group (order by p.projeto) as projeto,
                 count(*) as usos, max(p.created_at)::date as ultimo
            from receita.fat_pedidos p
           where p.emissora_id = p_emissora and nullif(btrim(p.projeto), '') is not null and p.status <> 'cancelado'
           group by 1) s;

  -- Uma linha por projeto (pela chave em maiúsculas): o nome mais usado, os usos somados, o uso mais recente.
  select coalesce(jsonb_agg(jsonb_build_object('projeto', projeto, 'usos', usos, 'ultimo', ultimo)
                            order by ultimo desc nulls last, usos desc, projeto), '[]')
    into _itens
    from (select (array_agg(i ->> 'projeto' order by (i ->> 'usos')::int desc))[1] as projeto,
                 sum((i ->> 'usos')::int) as usos, max((i ->> 'ultimo')::date) as ultimo
            from jsonb_array_elements(_omie || _portal) i
           group by i ->> 'chave'
           order by max((i ->> 'ultimo')::date) desc nulls last
           limit 500) x;

  return jsonb_build_object('itens', _itens, 'fontes', jsonb_build_object('omie', _tem_omie));
end $$;

comment on function ops.fat_projetos(uuid) is
  'Portal de Faturamento: projetos já usados pela empresa (lista do campo Projeto do Novo pedido, call de 27/10/2026): '
  'lançamentos do Omie da empresa e pedidos do portal, pela chave em maiúsculas. Até 500, os mais recentes primeiro.';

revoke all on function ops.fat_projetos(uuid) from public, anon;
grant execute on function ops.fat_projetos(uuid) to authenticated;

-- =================================================================================================================
-- 3. Pipefy só com a empresa ligada
-- =================================================================================================================
create or replace function receita.fat_transicao(p_pedido uuid, p_para text, p_motivo text DEFAULT NULL::text, p_evento text DEFAULT NULL::text, p_diff jsonb DEFAULT '{}'::jsonb)
 RETURNS receita.fat_pedidos
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _p receita.fat_pedidos;
  _n receita.fat_pedidos;
  _motivo text := nullif(btrim(p_motivo), '');
  _pipefy boolean;
begin
  select * into _p from receita.fat_pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_transicao_permitida(_p.status, p_para) then
    raise exception 'Pedido % está em %: não vai para %.', _p.numero, receita.fat_status_rotulo(_p.status),
      receita.fat_status_rotulo(p_para) using errcode = '55000';
  end if;
  if p_para in ('devolvido', 'cancelamento_pedido') and _motivo is null then
    perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo.'));
  end if;

  perform set_config('receita.fat_transicao', p_pedido::text, true);
  update receita.fat_pedidos
     set status = p_para,
         motivo_status = case when p_para = 'cancelado' then coalesce(_motivo, motivo_status) else _motivo end,
         status_em = now(),
         na_fila_em = case when p_para = 'na_fila_omie' and _p.status <> 'erro_omie' then now() else na_fila_em end,
         faturado_em = case when p_para = 'faturado' and faturado_em is null then now() else faturado_em end,
         conferido_por = case when p_para = 'em_conferencia' then auth.uid()
                              when p_para = 'devolvido' or (p_para = 'na_fila_omie' and _p.status <> 'erro_omie') then null
                              else conferido_por end
   where id = p_pedido
  returning * into _n;
  perform set_config('receita.fat_transicao', '', true);

  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _n.id, _n.emissora_id, coalesce(p_evento, p_para), _p.status, p_para,
          coalesce(p_diff, '{}'::jsonb)
            || case when _motivo is not null then jsonb_build_object('motivo', _motivo) else '{}'::jsonb end,
          auth.uid());

  -- Pedido cancelado: o que ainda esperava a fila não sai mais (Omie, Pipefy e e-mail). O envio em curso termina e o
  -- resultado vira omie_resultado_ignorado.
  if p_para = 'cancelado' then
    update integracoes.omie_envios set status = 'cancelado', erro_legivel = 'Pedido cancelado antes do envio.'
     where origem = 'fat_pedido' and origem_id = _n.id and status in ('pendente', 'bloqueado');
    update integracoes.pipefy_envios set status = 'cancelado', erro_legivel = 'Pedido cancelado antes do envio.'
     where origem = 'fat_pedido' and origem_id = _n.id and status in ('pendente', 'erro', 'bloqueado');
    update integracoes.notificacoes set status = 'cancelado', erro_legivel = 'Pedido cancelado antes do envio.'
     where pedido_id = _n.id and status = 'pendente';
  end if;

  -- Pipefy: só com a empresa ligada (pipefy_sync). Desde a call de 27/10/2026 o portal não usa o Pipefy (Daniel: "o
  -- portal já faz isso"; Pedro, 28/10): com a empresa desligada, nenhum envio é montado nem guardado. Ligada, o card
  -- nasce na primeira chegada à fila e anda a cada mudança depois disso, como na decisão 4.
  _pipefy := coalesce((select g.pipefy_sync from organizacao.empresas_grupo g where g.id = _n.emissora_id), false);
  if _pipefy and p_para = 'na_fila_omie'
     and not exists (select 1 from integracoes.pipefy_envios x
                      where x.origem = 'fat_pedido' and x.origem_id = _n.id and x.operacao = 'criar_card') then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'criar_card',
            receita.fat_snapshot(_n.id) || jsonb_build_object(
              'status', p_para,
              'solicitante', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', u.email)
                                from public.profiles u where u.user_id = _n.solicitante_id),
              'dono', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', u.email)
                         from public.profiles u where u.user_id = _n.dono_id)));
  elsif _pipefy and _n.na_fila_em is not null
        and (p_para <> 'cancelado'
             or exists (select 1 from integracoes.pipefy_envios x
                         where x.origem = 'fat_pedido' and x.origem_id = _n.id and x.operacao = 'criar_card'
                           and x.status in ('ok', 'simulado'))) then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'mover_fase', jsonb_build_object(
      'versao', 1, 'de', _p.status, 'para', p_para, 'evento', coalesce(p_evento, p_para), 'motivo', _motivo,
      'pedido', jsonb_build_object('id', _n.id, 'numero', _n.numero, 'omie_os_codigo', _n.omie_os_codigo,
                                   'omie_nf_numero', _n.omie_nf_numero, 'omie_nf_link', _n.omie_nf_link,
                                   'omie_nf_emitida_em', _n.omie_nf_emitida_em)));
  end if;
  return _n;
end $function$;

commit;
