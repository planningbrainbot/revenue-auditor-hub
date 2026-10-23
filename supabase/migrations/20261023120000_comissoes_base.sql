-- Comissões do time comercial, fatia 1, no Ops (PRD wiki/prds/2026-10-comissoes-v1.md, revisão 2,
-- aprovada em 23/10/2026; contrato docs/design/contratos/comissoes.md).
--
-- Tabelas e regras no schema `comissoes`, fora dos schemas expostos, sem grant a ninguém. A tela chama
-- as funções `ops.comissoes_*` (seção 10), que tiram o ator de auth.uid() e conferem a chave por
-- ops.can_user. A regra é a mesma testada no sistema novo (planning-broker, branch feat/comissoes-fatia1).
--
-- O Ops é lido só de dentro das funções: ops.contratos, ops.unidades, ops.royalties_apuracao e
-- ops.royalties_itens. Fatia 2 (baixas no Omie, trava, estornos) fica de fora.
--
-- Substitui a tela Apuração de comissões (D-05): a chave view.comissoes deixa a área `receita`.
-- Reversão: supabase/rollback/20261023120000_comissoes_base.sql

do $$ begin
  if to_regclass('seguranca.schemas_fechados') is not null then
    insert into seguranca.schemas_fechados (nome) values ('comissoes') on conflict (nome) do nothing;
  end if;
end $$;
create schema if not exists comissoes;
revoke all on schema comissoes from public, anon, authenticated, service_role;
alter default privileges in schema comissoes revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema comissoes revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema comissoes revoke execute on functions from public;

-- 1. Áreas e chaves (D-01): concessão pessoa a pessoa, nenhum papel ------------------------------
-- Time comercial: ops.usuario_areas + ops.usuario_chaves (view.comissoes).
-- Líderes e financeiro: ops.area_admins da área deles, que libera todas as chaves da área
-- (o mesmo caminho da royalties_edicao; ops.usuario_chaves só aceita chave view.%).

insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa) values
  ('comissoes', 'Comissões', 'O que entra no próximo pagamento de comissão e o que fica para depois.', 'nenhum', 90, true),
  ('comissoes_revisao', 'Comissões: revisão', 'Revisar e liberar o pagamento de comissão do mês (líderes comerciais).', 'nenhum', 91, true),
  ('comissoes_fechamento', 'Comissões: fechamento', 'Fechar, pagar e exportar o mês de comissões (financeiro).', 'nenhum', 92, true)
on conflict (slug) do nothing;

delete from ops.area_chaves where area = 'receita' and permission_key = 'view.comissoes';

insert into ops.area_chaves (area, permission_key) values
  ('comissoes', 'view.comissoes'),
  ('comissoes_revisao', 'view.comissoes'),
  ('comissoes_revisao', 'manage.comissoes_revisao'),
  ('comissoes_fechamento', 'view.comissoes'),
  ('comissoes_fechamento', 'manage.comissoes_fechamento')
on conflict do nothing;

-- 2. Tabelas -------------------------------------------------------------------------------------

create table comissoes.config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

-- Regras do PRD que são número ou lista, num lugar só. Unidade é o nome como vem em
-- ops.contratos.unidade (o mesmo de ops.unidades.nome_da_praca).
insert into comissoes.config (chave, valor) values
  ('regras', '{
     "corte_regra_nova": "2026-10-01",
     "percentual_closer_padrao": 7,
     "percentual_sdr": 5,
     "dia_pagamento": 20,
     "dia_envio_dp": 11,
     "dia_prazo_revisao": 10,
     "unidades_sem_adiantamento": ["Recife"],
     "unidades_sem_cac": ["Matriz", "Goiânia", "BPO Financeiro"]
   }'::jsonb)
on conflict (chave) do nothing;

create table comissoes.feriados (
  dia date primary key,
  nome text not null
);
insert into comissoes.feriados (dia, nome) values
  ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'), ('2026-11-20', 'Consciência Negra'),
  ('2026-12-25', 'Natal'), ('2027-01-01', 'Confraternização Universal'), ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'), ('2027-03-26', 'Sexta-feira Santa'), ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'), ('2027-05-27', 'Corpus Christi'), ('2027-09-07', 'Independência'),
  ('2027-10-12', 'Nossa Senhora Aparecida'), ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Consciência Negra'), ('2027-12-25', 'Natal')
on conflict (dia) do nothing;

-- Pessoa como vem do Pipedrive (ops.contratos.closer e sdr guardam o nome). O vínculo com o login
-- é feito pelo líder (R-01, seção 7 do PRD).
create table comissoes.pessoas (
  id bigint generated always as identity primary key,
  nome text not null unique check (btrim(nome) <> ''),
  usuario_id uuid unique,
  criado_em timestamptz not null default now()
);

create table comissoes.meses (
  mes date primary key check (extract(day from mes) = 1),
  situacao text not null default 'previa' check (situacao in ('previa', 'liberado', 'pago')),
  liberado_por uuid,
  liberado_em timestamptz,
  pago_por uuid,
  pago_em timestamptz
);

-- Datas que o líder ou o financeiro registram onde não há CAC (R-06, R-07; P-03).
create table comissoes.marcos (
  contrato_id integer not null,
  tipo text not null check (tipo in ('assinatura', 'pagamento_cliente')),
  dia date not null,
  registrado_por uuid not null,
  registrado_em timestamptz not null default now(),
  primary key (contrato_id, tipo)
);

-- Metade escolhida pelo líder para item de CAC sem parcela (P-06): 1, 2 ou 3 (as duas).
create table comissoes.parcela_escolhida (
  item_id bigint primary key,
  parcela smallint not null check (parcela in (1, 2, 3)),
  escolhido_por uuid not null,
  escolhido_em timestamptz not null default now()
);

-- Dinheiro: só inclusão (guia, seção 5). Mudar valor é uma linha nova de ajuste; excluir é evento.
create table comissoes.linhas (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('comissao', 'ajuste', 'bonus')),
  origem_id bigint references comissoes.linhas (id),
  contrato_id integer,
  cliente text,
  unidade text,
  pessoa_id bigint not null references comissoes.pessoas (id),
  papel text check (papel in ('closer', 'sdr')),
  metade smallint check (metade in (1, 2)),
  base numeric(14, 2),
  percentual numeric(5, 2) check (percentual between 0 and 20),
  valor numeric(14, 2) not null,
  mes date not null references comissoes.meses (mes),
  fonte text not null check (fonte in ('cac', 'assinatura', 'pagamento_cliente', 'manual', 'bonus', 'ajuste')),
  apuracao_id integer,
  item_id bigint,
  mes_referencia date,
  motivo text,
  chave_idempotencia text unique check (chave_idempotencia is null or length(chave_idempotencia) between 8 and 100),
  criada_por uuid,
  criada_em timestamptz not null default now(),
  check (tipo <> 'comissao' or (contrato_id is not null and papel is not null and metade is not null and base is not null and percentual is not null)),
  check (tipo <> 'ajuste' or (origem_id is not null and nullif(btrim(motivo), '') is not null)),
  check (tipo <> 'bonus' or (nullif(btrim(motivo), '') is not null and valor > 0))
);
-- Uma linha por contrato, papel e metade: a mesma metade nunca é paga duas vezes (R-09).
create unique index linhas_metade_uk on comissoes.linhas (contrato_id, papel, metade) where tipo = 'comissao';
create index linhas_mes_idx on comissoes.linhas (mes);
create index linhas_pessoa_idx on comissoes.linhas (pessoa_id);

create table comissoes.eventos (
  id bigint generated always as identity primary key,
  linha_id bigint references comissoes.linhas (id),
  mes date,
  pessoa_id bigint references comissoes.pessoas (id),
  contrato_id integer,
  acao text not null,
  antes jsonb,
  depois jsonb,
  motivo text,
  ator uuid,
  quando timestamptz not null default now()
);
create index eventos_linha_idx on comissoes.eventos (linha_id);

create table comissoes.execucoes (
  id bigint generated always as identity primary key,
  rotina text not null,
  inicio timestamptz not null default now(),
  resultado jsonb not null
);

create function comissoes.so_inclusao() returns trigger
language plpgsql set search_path = comissoes, pg_temp as $$
begin
  raise exception 'linhas e eventos de comissão são só inclusão' using errcode = '55000';
end $$;
create trigger so_inclusao before update or delete or truncate on comissoes.linhas
  for each statement execute function comissoes.so_inclusao();
create trigger so_inclusao before update or delete or truncate on comissoes.eventos
  for each statement execute function comissoes.so_inclusao();

do $$
declare t text;
begin
  foreach t in array array['config', 'feriados', 'pessoas', 'meses', 'marcos', 'parcela_escolhida', 'linhas', 'eventos', 'execucoes'] loop
    execute format('alter table comissoes.%I enable row level security', t);
  end loop;
end $$;

-- 3. Permissão e calendário ----------------------------------------------------------------------

create function comissoes.exigir(_ok boolean, _mensagem text) returns void
language plpgsql set search_path = comissoes, pg_temp as $$
begin
  if not coalesce(_ok, false) then
    raise exception '%', _mensagem using errcode = '42501';
  end if;
end $$;

create function comissoes.pode(_ator uuid, _chave text) returns boolean
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select _ator is not null and ops.can_user(_ator, _chave)
$$;

create function comissoes.e_lider(_ator uuid) returns boolean
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select comissoes.pode(_ator, 'manage.comissoes_revisao')
$$;

create function comissoes.e_financeiro(_ator uuid) returns boolean
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select comissoes.pode(_ator, 'manage.comissoes_fechamento')
$$;

create function comissoes.regras() returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select valor from comissoes.config where chave = 'regras'
$$;

-- O dia é o de São Paulo (R-10).
create function comissoes.hoje() returns date
language sql stable set search_path = comissoes, pg_temp as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create function comissoes.dia_util(_dia date) returns boolean
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select extract(isodow from _dia) < 6 and not exists (select 1 from comissoes.feriados f where f.dia = _dia)
$$;

-- O dia do mês, ou o dia útil anterior (R-10; P-01 para o dia 16).
create function comissoes.dia_ou_util_anterior(_mes date, _dia integer) returns date
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
declare v_d date := _mes + (_dia - 1);
begin
  while not comissoes.dia_util(v_d) loop
    v_d := v_d - 1;
  end loop;
  return v_d;
end $$;

create function comissoes.prazo(_mes date) returns date
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select comissoes.dia_ou_util_anterior(_mes, (comissoes.regras() ->> 'dia_prazo_revisao')::int)
$$;

-- Envio da planilha ao Departamento Pessoal: o dia 11, ou o próximo dia útil (calendário de 23/10/2026).
create function comissoes.envio_dp_em(_mes date) returns date
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
declare v_d date := _mes + ((comissoes.regras() ->> 'dia_envio_dp')::int - 1);
begin
  while not comissoes.dia_util(v_d) loop
    v_d := v_d + 1;
  end loop;
  return v_d;
end $$;

create function comissoes.pagamento_em(_mes date) returns date
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select comissoes.dia_ou_util_anterior(_mes, (comissoes.regras() ->> 'dia_pagamento')::int)
$$;

-- O mês de pagamento que ainda aceita linha nova: a partir do desejado, o primeiro em prévia e dentro
-- do prazo. O que chega depois da liberação ou do dia 10 vai para o mês seguinte (R-10, P-02).
create function comissoes.mes_aberto(_desejado date) returns date
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare
  v_mes date := date_trunc('month', greatest(_desejado, comissoes.hoje()))::date;
  v_situacao text;
begin
  loop
    -- Cria o mês antes de ler e lê com for share: uma liberação ao mesmo tempo espera esta
    -- transação, e esta nunca grava num mês que outra acabou de liberar (guia, seção 5).
    if comissoes.hoje() <= comissoes.prazo(v_mes) then
      insert into comissoes.meses (mes) values (v_mes) on conflict (mes) do nothing;
      select m.situacao into v_situacao from comissoes.meses m where m.mes = v_mes for share;
      if v_situacao = 'previa' then
        return v_mes;
      end if;
    end if;
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
end $$;

-- O mês ainda aceita mudança do líder? Em prévia e até o dia 10 (R-11).
create function comissoes.editavel(_mes date) returns boolean
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select coalesce((select situacao = 'previa' from comissoes.meses where mes = _mes), false)
     and comissoes.hoje() <= comissoes.prazo(_mes)
$$;

-- 4. Regra da unidade (R-03 a R-07) --------------------------------------------------------------

-- 'cac': as metades seguem a parcela do CAC na apuração. 'sem_adiantamento' (Recife): a 1ª pela
-- assinatura, a 2ª pelo CAC. 'sem_cac': as duas quando o cliente paga o 1º honorário.
create function comissoes.regra_do_contrato(_contrato integer) returns text
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
declare
  v_c record;
  v_u record;
  v_achou boolean;
  v_r jsonb := comissoes.regras();
begin
  select ct.unidade, ct.mrr_mensal, ct.ganho_em into v_c from ops.contratos ct where ct.id = _contrato;
  select un.paga_cac, un.cac_desde, un.cac_honorario_minimo_mensal into v_u
    from ops.unidades un where un.nome_da_praca = v_c.unidade;
  v_achou := found;
  if not v_achou or v_c.unidade is null
     or (v_r -> 'unidades_sem_cac') ? v_c.unidade
     or not coalesce(v_u.paga_cac, false)
     or (v_u.cac_desde is not null and v_c.ganho_em < v_u.cac_desde)
     or (v_u.cac_honorario_minimo_mensal is not null and coalesce(v_c.mrr_mensal, 0) < v_u.cac_honorario_minimo_mensal) then
    return 'sem_cac';
  end if;
  if (v_r -> 'unidades_sem_adiantamento') ? v_c.unidade then
    return 'sem_adiantamento';
  end if;
  return 'cac';
end $$;

-- 5. Geração das linhas --------------------------------------------------------------------------

create function comissoes.pessoa_de(_nome text) returns bigint
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare v_p bigint;
begin
  if nullif(btrim(_nome), '') is null then
    return null;
  end if;
  insert into comissoes.pessoas (nome) values (btrim(_nome)) on conflict (nome) do nothing;
  select id into v_p from comissoes.pessoas where nome = btrim(_nome);
  return v_p;
end $$;

-- Base e percentual em vigor de uma linha de comissão: o último ajuste não excluído, ou ela mesma.
create function comissoes.excluida(_linha bigint) returns boolean
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select coalesce((select e.acao = 'excluida' from comissoes.eventos e
                    where e.linha_id = _linha and e.acao in ('excluida', 'restaurada')
                    order by e.id desc limit 1), false)
$$;

create function comissoes.vigente(_linha bigint) returns table (base numeric, percentual numeric, valor numeric)
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select coalesce(a.base, l.base), coalesce(a.percentual, l.percentual),
         l.valor + coalesce((select sum(x.valor) from comissoes.linhas x
                              where x.origem_id = l.id and x.tipo = 'ajuste' and not comissoes.excluida(x.id)), 0)
    from comissoes.linhas l
    left join lateral (select x.base, x.percentual from comissoes.linhas x
                        where x.origem_id = l.id and x.tipo = 'ajuste' and not comissoes.excluida(x.id)
                        order by x.id desc limit 1) a on true
   where l.id = _linha
$$;

-- Percentual proposto (R-02): SDR fixo; closer, o último em vigor da pessoa, ou o padrão.
create function comissoes.percentual_proposto(_pessoa bigint, _papel text) returns numeric
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select case when _papel = 'sdr' then (comissoes.regras() ->> 'percentual_sdr')::numeric
              else coalesce((select v.percentual from comissoes.linhas l, comissoes.vigente(l.id) v
                              where l.pessoa_id = _pessoa and l.papel = 'closer' and l.tipo = 'comissao'
                                and not comissoes.excluida(l.id)
                              order by l.id desc limit 1),
                            (comissoes.regras() ->> 'percentual_closer_padrao')::numeric) end
$$;

-- Grava uma metade para o closer e o SDR do contrato, se ainda não existir (R-09). A 2ª metade
-- segue a pessoa e o percentual da 1ª (R-01, R-02). Devolve quantas linhas nasceram.
create function comissoes.gravar_metade(_contrato integer, _metade smallint, _mes_desejado date, _fonte text,
                                        _apuracao integer, _item bigint, _mes_referencia date, _ator uuid, _motivo text)
returns integer
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare
  v_c record;
  v_papel text;
  v_pessoa bigint;
  v_pct numeric;
  v_primeira bigint;
  v_mes date;
  v_novo bigint;
  v_n integer := 0;
begin
  select ct.id, ct.titulo, ct.unidade, ct.mrr_mensal, ct.closer, ct.sdr into v_c from ops.contratos ct where ct.id = _contrato;
  if v_c.id is null or coalesce(v_c.mrr_mensal, 0) <= 0 then
    return 0;
  end if;
  foreach v_papel in array array['closer', 'sdr'] loop
    continue when exists (select 1 from comissoes.linhas l
                           where l.contrato_id = _contrato and l.papel = v_papel and l.metade = _metade and l.tipo = 'comissao');
    v_primeira := (select l.id from comissoes.linhas l
                    where l.contrato_id = _contrato and l.papel = v_papel and l.metade <> _metade and l.tipo = 'comissao'
                    order by l.id limit 1);
    if v_primeira is not null then
      v_pessoa := (select l.pessoa_id from comissoes.linhas l where l.id = v_primeira);
      v_pct := (select v.percentual from comissoes.vigente(v_primeira) v);
    else
      v_pessoa := comissoes.pessoa_de(case when v_papel = 'closer' then v_c.closer else v_c.sdr end);
      continue when v_pessoa is null;  -- contrato sem closer ou sem SDR: alerta na revisão (R-01)
      v_pct := comissoes.percentual_proposto(v_pessoa, v_papel);
    end if;
    v_mes := comissoes.mes_aberto(_mes_desejado);
    v_novo := null;
    insert into comissoes.linhas (tipo, contrato_id, cliente, unidade, pessoa_id, papel, metade, base, percentual, valor,
                                  mes, fonte, apuracao_id, item_id, mes_referencia, motivo, criada_por)
    values ('comissao', _contrato, coalesce(v_c.titulo, 'Contrato ' || _contrato), v_c.unidade, v_pessoa, v_papel, _metade,
            v_c.mrr_mensal, v_pct, round(v_c.mrr_mensal * v_pct / 200, 2), v_mes, _fonte, _apuracao, _item, _mes_referencia,
            _motivo, _ator)
    on conflict (contrato_id, papel, metade) where tipo = 'comissao' do nothing
    returning id into v_novo;
    if v_novo is not null then
      insert into comissoes.eventos (linha_id, mes, pessoa_id, contrato_id, acao, depois, motivo, ator)
      values (v_novo, v_mes, v_pessoa, _contrato, 'gerada',
              jsonb_build_object('fonte', _fonte, 'apuracao', _apuracao, 'metade', _metade, 'percentual', v_pct), _motivo, _ator);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Gera o que um contrato já liberou (R-03 a R-07). Só contrato do Inside Sales ganho a partir do
-- corte; o anterior é da regra antiga e só entra pelo líder (R-09). Nunca desfaz decisão do líder
-- (R-11): linha excluída continua existindo e barra a metade pelo índice único.
create function comissoes.gerar_contrato(_contrato integer) returns integer
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare
  v_c record;
  v_regra text;
  v_it record;
  v_parcela smallint;
  v_marco date;
  v_n integer := 0;
begin
  select ct.id, ct.ganho_em, ct.origem_pipeline, ct.entrada_contrato_assinado_em into v_c
    from ops.contratos ct where ct.id = _contrato;
  if v_c.id is null or v_c.origem_pipeline is distinct from 'inside_sales'
     or v_c.ganho_em < (comissoes.regras() ->> 'corte_regra_nova')::date then
    return 0;
  end if;
  v_regra := comissoes.regra_do_contrato(_contrato);

  if v_regra = 'sem_cac' then
    select m.dia into v_marco from comissoes.marcos m where m.contrato_id = _contrato and m.tipo = 'pagamento_cliente';
    if v_marco is not null then
      v_n := v_n + comissoes.gravar_metade(_contrato, 1::smallint, (date_trunc('month', v_marco) + interval '1 month')::date,
                                       'pagamento_cliente', null, null, null, null, null);
      v_n := v_n + comissoes.gravar_metade(_contrato, 2::smallint, (date_trunc('month', v_marco) + interval '1 month')::date,
                                       'pagamento_cliente', null, null, null, null, null);
    end if;
    return v_n;
  end if;

  if v_regra = 'sem_adiantamento' then
    -- Só a data registrada pelo financeiro: a entrada no estágio do Pipedrive não é a assinatura do cliente.
    v_marco := (select m.dia from comissoes.marcos m where m.contrato_id = _contrato and m.tipo = 'assinatura');
    if v_marco is not null then
      v_n := v_n + comissoes.gravar_metade(_contrato, 1::smallint, (date_trunc('month', v_marco) + interval '1 month')::date,
                                       'assinatura', null, null, null, null, null);
    end if;
  end if;

  for v_it in
    select i.id, i.apuracao_id, i.cac_parcela, a.mes_referencia
      from ops.royalties_itens i
      join ops.royalties_apuracao a on a.id = i.apuracao_id
     where i.contrato_id = _contrato and i.is_cac and i.excluido_em is null and i.royalties_item > 0
       and a.status = 'confirmado'
     order by a.mes_referencia, i.id
  loop
    v_parcela := coalesce(v_it.cac_parcela, (select e.parcela from comissoes.parcela_escolhida e where e.item_id = v_it.id));
    continue when v_parcela is null and v_regra <> 'sem_adiantamento';  -- parcela a definir pelo líder (P-06)
    if v_regra = 'sem_adiantamento' then
      -- Recife: o CAC, com qualquer parcela, libera a 2ª metade (R-06).
      v_n := v_n + comissoes.gravar_metade(_contrato, 2::smallint, (v_it.mes_referencia + interval '1 month')::date,
                                       'cac', v_it.apuracao_id, v_it.id, v_it.mes_referencia, null, null);
    else
      if v_parcela in (1, 3) then
        v_n := v_n + comissoes.gravar_metade(_contrato, 1::smallint, (v_it.mes_referencia + interval '1 month')::date,
                                         'cac', v_it.apuracao_id, v_it.id, v_it.mes_referencia, null, null);
      end if;
      if v_parcela in (2, 3) then
        v_n := v_n + comissoes.gravar_metade(_contrato, 2::smallint, (v_it.mes_referencia + interval '1 month')::date,
                                         'cac', v_it.apuracao_id, v_it.id, v_it.mes_referencia, null, null);
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- Rotina (só comissoes_rotinas): varre os contratos do Inside Sales desde o corte. Idempotente,
-- com trava contra execução em dobro e registro de cada execução (guia, seção 9).
create function comissoes.gerar_previa() returns jsonb
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare
  v_c record;
  v_n integer := 0;
  v_contratos integer := 0;
  v_resultado jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('comissoes.gerar_previa')) then
    raise exception 'prévia já em execução' using errcode = '55006';
  end if;
  for v_c in
    select ct.id from ops.contratos ct
     where ct.origem_pipeline = 'inside_sales' and ct.ganho_em >= (comissoes.regras() ->> 'corte_regra_nova')::date
     order by ct.id
  loop
    v_n := v_n + comissoes.gerar_contrato(v_c.id);
    v_contratos := v_contratos + 1;
  end loop;
  v_resultado := jsonb_build_object('contratos', v_contratos, 'linhas_novas', v_n, 'hoje', comissoes.hoje());
  insert into comissoes.execucoes (rotina, resultado) values ('gerar_previa', v_resultado);
  return v_resultado;
end $$;

-- 6. Leituras ------------------------------------------------------------------------------------

create function comissoes.linha_json(_l comissoes.linhas) returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select jsonb_build_object(
    'id', _l.id, 'tipo', _l.tipo, 'origem_id', _l.origem_id, 'contrato_id', _l.contrato_id,
    'cliente', _l.cliente, 'unidade', _l.unidade, 'pessoa_id', _l.pessoa_id,
    'pessoa', (select p.nome from comissoes.pessoas p where p.id = _l.pessoa_id),
    'papel', _l.papel, 'metade', _l.metade,
    'base', coalesce(v.base, _l.base), 'percentual', coalesce(v.percentual, _l.percentual),
    'valor', _l.valor, 'valor_vigente', coalesce(v.valor, _l.valor),
    'fonte', _l.fonte, 'apuracao_id', _l.apuracao_id, 'mes_referencia', _l.mes_referencia,
    'motivo', _l.motivo, 'excluida', comissoes.excluida(_l.id), 'mes', _l.mes,
    'ajustada', exists (select 1 from comissoes.linhas x where x.origem_id = _l.id and x.tipo = 'ajuste'))
    from (select 1) um
    left join lateral (select * from comissoes.vigente(_l.id) where _l.tipo = 'comissao') v on true
$$;

-- Linhas de um mês, cada uma com o valor que entra nele: comissão e bônus pelo próprio valor, ajuste
-- pela diferença. Linha excluída fica na lista, com valor zero no total.
create function comissoes.linhas_do_mes(_mes date, _pessoa bigint default null) returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select coalesce(jsonb_agg(comissoes.linha_json(l) order by p.nome, l.cliente, l.metade, l.id), '[]'::jsonb)
    from comissoes.linhas l join comissoes.pessoas p on p.id = l.pessoa_id
   where l.mes = _mes and (_pessoa is null or l.pessoa_id = _pessoa)
$$;

create function comissoes.total_do_mes(_mes date, _pessoa bigint default null) returns numeric
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select coalesce(sum(l.valor), 0) from comissoes.linhas l
   where l.mes = _mes and (_pessoa is null or l.pessoa_id = _pessoa)
     and not comissoes.excluida(l.id)
     and not (l.tipo = 'ajuste' and comissoes.excluida(l.origem_id))
$$;

create function comissoes.mes_json(_mes date) returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select jsonb_build_object('mes', _mes, 'situacao', coalesce(m.situacao, 'previa'),
                            'prazo', comissoes.prazo(_mes), 'envio_dp_em', comissoes.envio_dp_em(_mes), 'pagamento_em', comissoes.pagamento_em(_mes),
                            'editavel', comissoes.editavel(_mes), 'liberado_em', m.liberado_em, 'pago_em', m.pago_em)
    from (select 1) um left join comissoes.meses m on m.mes = _mes
$$;

create function comissoes.meu_perfil(_ator uuid) returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select jsonb_build_object(
    'leitura', comissoes.pode(_ator, 'view.comissoes') or comissoes.e_lider(_ator) or comissoes.e_financeiro(_ator),
    'lider', comissoes.e_lider(_ator),
    'financeiro', comissoes.e_financeiro(_ator),
    'pessoa', (select p.nome from comissoes.pessoas p where p.usuario_id = _ator),
    'hoje', comissoes.hoje())
$$;

-- O que ainda não saiu, com o motivo (R-14): só de quem está logado.
create function comissoes.fica_para_depois(_pessoa bigint) returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  with p as (select nome from comissoes.pessoas where id = _pessoa),
  -- A pessoa de cada contrato e papel: a da 1ª metade, se já nasceu; senão o nome atual no Pipedrive.
  contratos as (
    select ct.id, ct.titulo, ct.unidade, ct.mrr_mensal, x.papel, comissoes.regra_do_contrato(ct.id) as regra
      from ops.contratos ct
     cross join lateral (values ('closer', ct.closer), ('sdr', ct.sdr)) as x(papel, nome)
     where ct.origem_pipeline = 'inside_sales' and ct.ganho_em >= (comissoes.regras() ->> 'corte_regra_nova')::date
       and coalesce(ct.mrr_mensal, 0) > 0
       and coalesce((select l.pessoa_id from comissoes.linhas l
                       where l.contrato_id = ct.id and l.papel = x.papel and l.tipo = 'comissao' order by l.id limit 1),
                     (select pp.id from comissoes.pessoas pp, p where pp.nome = x.nome and pp.nome = p.nome)) = _pessoa
  ),
  faltam as (
    select c.*, m.metade,
           exists (select 1 from comissoes.linhas l where l.contrato_id = c.id and l.papel = c.papel and l.metade = 1
                    and l.tipo = 'comissao') as tem_primeira
      from contratos c cross join (values (1::smallint), (2::smallint)) m(metade)
     where not exists (select 1 from comissoes.linhas l where l.contrato_id = c.id and l.papel = c.papel
                        and l.metade = m.metade and l.tipo = 'comissao')
  ),
  -- Metade que já nasceu num mês ainda em revisão, depois do próximo pagamento: aparece sem valor (R-11).
  em_revisao as (
    select l.contrato_id, l.cliente, l.unidade, l.papel, l.metade, m.mes
      from comissoes.linhas l join comissoes.meses m on m.mes = l.mes
     where l.pessoa_id = _pessoa and l.tipo = 'comissao' and m.situacao = 'previa' and not comissoes.excluida(l.id)
       and m.mes > (select min(x.mes) from comissoes.meses x where x.situacao in ('previa', 'liberado'))
  )
  select coalesce(jsonb_agg(item order by item ->> 'cliente', item ->> 'metade'), '[]'::jsonb) from (
    select jsonb_build_object(
             'contrato_id', f.id, 'cliente', f.titulo, 'unidade', f.unidade, 'papel', f.papel, 'metade', f.metade,
             'valor_estimado', round(f.mrr_mensal * comissoes.percentual_proposto(_pessoa, f.papel) / 200, 2),
             'motivo', case
               when f.regra = 'sem_cac' then 'Aguardando o cliente pagar o 1º honorário (unidade sem CAC)'
               when f.regra = 'sem_adiantamento' and f.metade = 1 then 'Aguardando a data de assinatura'
               when f.metade = 2 and (f.tem_primeira or f.regra = 'sem_adiantamento') then 'Aguardando o cliente pagar o 1º honorário'
               else 'Aguardando o CAC entrar na apuração da unidade' end) as item
      from faltam f
    union all
    select jsonb_build_object(
             'contrato_id', r.contrato_id, 'cliente', r.cliente, 'unidade', r.unidade, 'papel', r.papel, 'metade', r.metade,
             'valor_estimado', null,
             'motivo', 'Em revisão para o pagamento de ' || to_char(comissoes.pagamento_em(r.mes), 'DD/MM/YYYY'))
      from em_revisao r
  ) x
$$;

-- Visão do vendedor (R-11, R-14): valores só de mês liberado ou pago.
create function comissoes.minhas_comissoes(_ator uuid) returns jsonb
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
declare
  v_pessoa bigint;
  v_proximo date;
  v_situacao text;
begin
  perform comissoes.exigir(comissoes.pode(_ator, 'view.comissoes'), 'sem permissão para comissões');
  select id into v_pessoa from comissoes.pessoas where usuario_id = _ator;
  if v_pessoa is null then
    return jsonb_build_object('vinculado', false);
  end if;
  select m.mes, m.situacao into v_proximo, v_situacao from comissoes.meses m
   where m.situacao in ('previa', 'liberado') order by m.mes limit 1;
  return jsonb_build_object(
    'vinculado', true,
    'pessoa', (select nome from comissoes.pessoas where id = v_pessoa),
    'proximo', case when v_proximo is null then null
                    else comissoes.mes_json(v_proximo) || jsonb_build_object(
                      'total', case when v_situacao = 'liberado' then comissoes.total_do_mes(v_proximo, v_pessoa) end,
                      'linhas', case when v_situacao = 'liberado' then comissoes.linhas_do_mes(v_proximo, v_pessoa) else '[]'::jsonb end)
               end,
    'historico', coalesce((select jsonb_agg(comissoes.mes_json(m.mes) || jsonb_build_object(
                             'total', comissoes.total_do_mes(m.mes, v_pessoa),
                             'linhas', comissoes.linhas_do_mes(m.mes, v_pessoa)) order by m.mes desc)
                             from comissoes.meses m
                            where m.situacao in ('liberado', 'pago') and m.mes is distinct from v_proximo
                              and exists (select 1 from comissoes.linhas l where l.mes = m.mes and l.pessoa_id = v_pessoa)),
                          '[]'::jsonb),
    'depois', comissoes.fica_para_depois(v_pessoa));
end $$;

-- Pendências da revisão: o que a rotina não decide sozinha.
create function comissoes.pendencias() returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  with corte as (select (comissoes.regras() ->> 'corte_regra_nova')::date as d),
  itens as (
    select i.id as item_id, i.apuracao_id, i.cac_parcela, i.royalties_item, a.mes_referencia, ct.id as contrato_id,
           ct.titulo, ct.unidade, ct.ganho_em, ct.closer, ct.sdr
      from ops.royalties_itens i
      join ops.royalties_apuracao a on a.id = i.apuracao_id and a.status = 'confirmado'
      join ops.contratos ct on ct.id = i.contrato_id and ct.origem_pipeline = 'inside_sales'
      cross join corte
     where i.is_cac and i.excluido_em is null and i.royalties_item > 0 and a.mes_referencia >= corte.d
  )
  select jsonb_build_object(
    'sem_parcela', coalesce((select jsonb_agg(jsonb_build_object('item_id', it.item_id, 'contrato_id', it.contrato_id,
                              'cliente', it.titulo, 'unidade', it.unidade, 'mes_referencia', it.mes_referencia,
                              'cac', it.royalties_item) order by it.titulo)
                               from itens it, corte
                              where it.cac_parcela is null and it.ganho_em >= corte.d
                                and not exists (select 1 from comissoes.parcela_escolhida e where e.item_id = it.item_id)), '[]'),
    'regra_antiga', coalesce((select jsonb_agg(jsonb_build_object('item_id', it.item_id, 'contrato_id', it.contrato_id,
                               'cliente', it.titulo, 'unidade', it.unidade, 'ganho_em', it.ganho_em,
                               'parcela', it.cac_parcela, 'mes_referencia', it.mes_referencia) order by it.titulo)
                                from itens it, corte
                               where it.ganho_em < corte.d
                                 and not exists (select 1 from comissoes.linhas l where l.contrato_id = it.contrato_id
                                                  and l.tipo = 'comissao'
                                                  and l.metade = any (case coalesce(it.cac_parcela, 0)
                                                                        when 1 then array[1] when 2 then array[2]
                                                                        else array[1, 2] end))), '[]'),
    'sem_closer', coalesce((select jsonb_agg(jsonb_build_object('contrato_id', ct.id, 'cliente', ct.titulo,
                             'unidade', ct.unidade, 'falta', case when nullif(btrim(ct.closer), '') is null then 'closer' else 'SDR' end)
                             order by ct.titulo)
                              from ops.contratos ct, corte
                             where ct.origem_pipeline = 'inside_sales' and ct.ganho_em >= corte.d
                               and (nullif(btrim(ct.closer), '') is null or nullif(btrim(ct.sdr), '') is null)), '[]'),
    -- Contrato com CAC na apuração e pipe vazio: a rotina não sabe se é do Inside Sales (R-01).
    'pipe_a_confirmar', coalesce((select jsonb_agg(distinct jsonb_build_object('contrato_id', ct.id, 'cliente', ct.titulo,
                                   'unidade', ct.unidade))
                                    from ops.royalties_itens i
                                    join ops.royalties_apuracao a on a.id = i.apuracao_id and a.status = 'confirmado'
                                    join ops.contratos ct on ct.id = i.contrato_id and ct.origem_pipeline is null, corte
                                   where i.is_cac and i.excluido_em is null and i.royalties_item > 0
                                     and a.mes_referencia >= corte.d), '[]'),
    -- Closer ou SDR trocado no Pipedrive depois da 1ª metade: a 2ª segue a pessoa da 1ª, o líder decide.
    'pessoa_trocada', coalesce((select jsonb_agg(jsonb_build_object('contrato_id', ct.id, 'cliente', ct.titulo,
                                 'papel', l.papel, 'na_linha', p.nome,
                                 'no_pipedrive', case when l.papel = 'closer' then ct.closer else ct.sdr end) order by ct.titulo)
                                  from comissoes.linhas l
                                  join comissoes.pessoas p on p.id = l.pessoa_id
                                  join ops.contratos ct on ct.id = l.contrato_id
                                 where l.tipo = 'comissao' and l.metade = 1
                                   and p.nome is distinct from btrim(case when l.papel = 'closer' then ct.closer else ct.sdr end)), '[]'),
    'aguardando_data', coalesce((select jsonb_agg(jsonb_build_object('contrato_id', ct.id, 'cliente', ct.titulo,
                                  'unidade', ct.unidade, 'ganho_em', ct.ganho_em,
                                  'tipo', case when comissoes.regra_do_contrato(ct.id) = 'sem_cac' then 'pagamento_cliente'
                                               else 'assinatura' end) order by ct.ganho_em, ct.titulo)
                                   from ops.contratos ct, corte
                                  where ct.origem_pipeline = 'inside_sales' and ct.ganho_em >= corte.d
                                    and coalesce(ct.mrr_mensal, 0) > 0
                                    and ((comissoes.regra_do_contrato(ct.id) = 'sem_cac'
                                          and not exists (select 1 from comissoes.marcos m where m.contrato_id = ct.id
                                                           and m.tipo = 'pagamento_cliente'))
                                      or (comissoes.regra_do_contrato(ct.id) = 'sem_adiantamento'
                                          and not exists (select 1 from comissoes.marcos m where m.contrato_id = ct.id
                                                           and m.tipo = 'assinatura')))), '[]'),
    'sem_vinculo', coalesce((select jsonb_agg(jsonb_build_object('pessoa_id', p.id, 'nome', p.nome) order by p.nome)
                               from comissoes.pessoas p where p.usuario_id is null), '[]'))
$$;

-- Revisão do mês (líder e financeiro leem; só o líder muda).
create function comissoes.revisao(_ator uuid, _mes date) returns jsonb
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_lider(_ator) or comissoes.e_financeiro(_ator), 'só o líder comercial ou o financeiro');
  return comissoes.mes_json(_mes) || jsonb_build_object(
    'total', comissoes.total_do_mes(_mes),
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('pessoa_id', p.id, 'nome', p.nome,
                           'vinculado', p.usuario_id is not null, 'total', comissoes.total_do_mes(_mes, p.id)) order by p.nome)
                           from comissoes.pessoas p
                          where exists (select 1 from comissoes.linhas l where l.mes = _mes and l.pessoa_id = p.id)), '[]'),
    'todas_pessoas', coalesce((select jsonb_agg(jsonb_build_object('pessoa_id', p.id, 'nome', p.nome) order by p.nome)
                                 from comissoes.pessoas p), '[]'),
    'linhas', comissoes.linhas_do_mes(_mes),
    'apuracoes', coalesce((select jsonb_agg(jsonb_build_object('apuracao_id', a.id, 'unidade', u.nome_da_praca,
                             'status', a.status, 'cac', a.cac_valor) order by u.nome_da_praca)
                             from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id
                            where a.mes_referencia = (_mes - interval '1 month')::date and coalesce(a.cac_valor, 0) > 0), '[]'),
    'pendencias', comissoes.pendencias(),
    'meses', coalesce((select jsonb_agg(m.mes order by m.mes desc) from comissoes.meses m), '[]'));
end $$;

-- Quem pode ser ligado a uma pessoa do Pipedrive: quem tem view.comissoes.
create function comissoes.candidatos_vinculo(_ator uuid) returns jsonb
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_lider(_ator), 'só o líder comercial');
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email,
                     'pessoa', (select p.nome from comissoes.pessoas p where p.usuario_id = u.id)) order by u.email)
                     from auth.users u where ops.can_user(u.id, 'view.comissoes')), '[]'::jsonb);
end $$;

-- 7. Ações do líder (R-11) -----------------------------------------------------------------------

create function comissoes.exigir_editavel(_ator uuid, _mes date) returns void
language plpgsql security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_lider(_ator), 'só o líder comercial');
  perform 1 from comissoes.meses where mes = _mes for share;
  if not comissoes.editavel(_mes) then
    raise exception 'o mês % não aceita mudança: já liberado ou fora do prazo do dia 10', to_char(_mes, 'MM/YYYY')
      using errcode = '55000';
  end if;
end $$;

create function comissoes.motivo_valido(_motivo text) returns text
language plpgsql set search_path = comissoes, pg_temp as $$
begin
  if nullif(btrim(_motivo), '') is null or length(_motivo) > 500 then
    raise exception 'informe o motivo (até 500 caracteres)' using errcode = '22023';
  end if;
  return btrim(_motivo);
end $$;

-- Novo percentual ou base numa linha de comissão. Linha de mês ainda editável: o ajuste fica no mesmo
-- mês. Linha de mês liberado ou pago: o ajuste vai para o próximo mês aberto (R-12).
create function comissoes.ajustar_linha(_ator uuid, _linha bigint, _base numeric, _percentual numeric, _motivo text)
returns jsonb
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare
  l comissoes.linhas;
  v record;
  v_mes date;
  v_novo_valor numeric;
  v_id_ajuste bigint;
begin
  perform comissoes.exigir(comissoes.e_lider(_ator), 'só o líder comercial');
  _motivo := comissoes.motivo_valido(_motivo);
  perform pg_advisory_xact_lock(hashtext('comissoes.linha'), _linha::int);
  select * into l from comissoes.linhas where id = _linha;
  if l.id is null or l.tipo <> 'comissao' then
    raise exception 'linha de comissão não encontrada' using errcode = 'P0002';
  end if;
  if comissoes.excluida(l.id) then
    raise exception 'linha excluída: restaure antes de ajustar' using errcode = '55000';
  end if;
  if l.fonte in ('pagamento_cliente', 'assinatura')
     and (select m.situacao from comissoes.meses m where m.mes = l.mes) = 'pago' then
    raise exception 'linha já paga onde não há CAC: é definitiva (R-12)' using errcode = '55000';
  end if;
  if _base is null or _base <= 0 or _percentual is null or _percentual < 0 or _percentual > 20 then
    raise exception 'base maior que zero e percentual entre 0 e 20' using errcode = '22023';
  end if;
  v_mes := case when comissoes.editavel(l.mes) then l.mes else comissoes.mes_aberto(l.mes) end;
  perform comissoes.exigir_editavel(_ator, v_mes);
  select * into v from comissoes.vigente(l.id);
  v_novo_valor := round(_base * _percentual / 200, 2);
  if v_novo_valor = v.valor and _base = v.base and _percentual = v.percentual then
    return jsonb_build_object('ajuste', null, 'mes', v_mes);
  end if;
  insert into comissoes.linhas (tipo, origem_id, contrato_id, cliente, unidade, pessoa_id, papel, metade, base, percentual,
                                valor, mes, fonte, motivo, criada_por)
  values ('ajuste', l.id, l.contrato_id, l.cliente, l.unidade, l.pessoa_id, l.papel, l.metade, _base, _percentual,
          v_novo_valor - v.valor, v_mes, 'ajuste', _motivo, _ator)
  returning id into v_id_ajuste;
  insert into comissoes.eventos (linha_id, mes, pessoa_id, contrato_id, acao, antes, depois, motivo, ator)
  values (l.id, v_mes, l.pessoa_id, l.contrato_id, 'ajustada',
          jsonb_build_object('base', v.base, 'percentual', v.percentual, 'valor', v.valor),
          jsonb_build_object('base', _base, 'percentual', _percentual, 'valor', v_novo_valor, 'ajuste', v_id_ajuste), _motivo, _ator);
  return jsonb_build_object('ajuste', v_id_ajuste, 'mes', v_mes);
end $$;

create function comissoes.excluir_linha(_ator uuid, _linha bigint, _motivo text) returns void
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare l comissoes.linhas;
begin
  _motivo := comissoes.motivo_valido(_motivo);
  select * into l from comissoes.linhas where id = _linha;
  if l.id is null then
    raise exception 'linha não encontrada' using errcode = 'P0002';
  end if;
  perform comissoes.exigir_editavel(_ator, l.mes);
  perform pg_advisory_xact_lock(hashtext('comissoes.linha'), _linha::int);
  if comissoes.excluida(l.id) then
    return;
  end if;
  insert into comissoes.eventos (linha_id, mes, pessoa_id, contrato_id, acao, antes, motivo, ator)
  values (l.id, l.mes, l.pessoa_id, l.contrato_id, 'excluida', jsonb_build_object('valor', l.valor), _motivo, _ator);
end $$;

create function comissoes.restaurar_linha(_ator uuid, _linha bigint, _motivo text) returns void
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare l comissoes.linhas;
begin
  _motivo := comissoes.motivo_valido(_motivo);
  select * into l from comissoes.linhas where id = _linha;
  if l.id is null then
    raise exception 'linha não encontrada' using errcode = 'P0002';
  end if;
  perform comissoes.exigir_editavel(_ator, l.mes);
  perform pg_advisory_xact_lock(hashtext('comissoes.linha'), _linha::int);
  if not comissoes.excluida(l.id) then
    return;
  end if;
  insert into comissoes.eventos (linha_id, mes, pessoa_id, contrato_id, acao, depois, motivo, ator)
  values (l.id, l.mes, l.pessoa_id, l.contrato_id, 'restaurada', jsonb_build_object('valor', l.valor), _motivo, _ator);
end $$;

-- Contrato da regra antiga com CAC na apuração: o líder decide incluir a metade (R-09).
create function comissoes.incluir_metade(_ator uuid, _contrato integer, _metade smallint, _motivo text) returns integer
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare v_mes date := comissoes.mes_aberto(comissoes.hoje());
begin
  _motivo := comissoes.motivo_valido(_motivo);
  perform comissoes.exigir_editavel(_ator, v_mes);
  if _metade not in (1, 2) then
    raise exception 'metade 1 ou 2' using errcode = '22023';
  end if;
  if not exists (select 1 from ops.contratos ct where ct.id = _contrato and ct.origem_pipeline = 'inside_sales') then
    raise exception 'contrato do Inside Sales não encontrado' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('comissoes.contrato'), _contrato);
  return comissoes.gravar_metade(_contrato, _metade, v_mes, 'manual', null, null, null, _ator, _motivo);
end $$;

create function comissoes.escolher_parcela(_ator uuid, _item bigint, _parcela smallint) returns integer
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare v_contrato integer;
begin
  perform comissoes.exigir(comissoes.e_lider(_ator), 'só o líder comercial');
  if _parcela not in (1, 2, 3) then
    raise exception 'parcela 1, 2 ou 3 (as duas)' using errcode = '22023';
  end if;
  select i.contrato_id into v_contrato from ops.royalties_itens i
   where i.id = _item and i.is_cac and i.cac_parcela is null and i.excluido_em is null;
  if v_contrato is null then
    raise exception 'item de CAC sem parcela não encontrado' using errcode = 'P0002';
  end if;
  insert into comissoes.parcela_escolhida (item_id, parcela, escolhido_por) values (_item, _parcela, _ator)
  on conflict (item_id) do nothing;
  if not found then
    raise exception 'a parcela deste item já foi escolhida' using errcode = '55000';
  end if;
  insert into comissoes.eventos (contrato_id, acao, depois, ator)
  values (v_contrato, 'parcela_escolhida', jsonb_build_object('item', _item, 'parcela', _parcela), _ator);
  perform pg_advisory_xact_lock(hashtext('comissoes.contrato'), v_contrato);
  return comissoes.gerar_contrato(v_contrato);
end $$;

-- Data da assinatura (Recife) ou do pagamento do cliente (unidade sem CAC), registrada pelo líder ou
-- pelo financeiro (P-03). Corrigir a data só vale enquanto nenhuma linha nasceu dela.
create function comissoes.registrar_data(_ator uuid, _contrato integer, _tipo text, _dia date) returns integer
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare v_antes date;
begin
  -- Só o financeiro registra (P-03): quem revisa a comissão não cria a prova que a libera.
  perform comissoes.exigir(comissoes.e_financeiro(_ator), 'só o financeiro');
  if _tipo not in ('assinatura', 'pagamento_cliente') then
    raise exception 'tipo de data inválido' using errcode = '22023';
  end if;
  if _dia is null or _dia > comissoes.hoje() or _dia < date '2026-01-01' then
    raise exception 'data fora do intervalo' using errcode = '22023';
  end if;
  if not exists (select 1 from ops.contratos ct where ct.id = _contrato and ct.origem_pipeline = 'inside_sales') then
    raise exception 'contrato do Inside Sales não encontrado' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('comissoes.contrato'), _contrato);
  select m.dia into v_antes from comissoes.marcos m where m.contrato_id = _contrato and m.tipo = _tipo;
  if v_antes is not null and exists (select 1 from comissoes.linhas l where l.contrato_id = _contrato and l.tipo = 'comissao'
                                     and l.fonte = _tipo) then
    raise exception 'a data já gerou comissão: corrija pela linha' using errcode = '55000';
  end if;
  insert into comissoes.marcos (contrato_id, tipo, dia, registrado_por) values (_contrato, _tipo, _dia, _ator)
  on conflict (contrato_id, tipo) do update set dia = excluded.dia, registrado_por = excluded.registrado_por,
                                                registrado_em = now();
  insert into comissoes.eventos (contrato_id, acao, antes, depois, ator)
  values (_contrato, 'data_registrada', case when v_antes is null then null else jsonb_build_object('dia', v_antes) end,
          jsonb_build_object('tipo', _tipo, 'dia', _dia), _ator);
  return comissoes.gerar_contrato(_contrato);
end $$;

create function comissoes.lancar_bonus(_ator uuid, _pessoa bigint, _mes date, _valor numeric, _motivo text, _chave text)
returns bigint
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare v_novo bigint;
begin
  _motivo := comissoes.motivo_valido(_motivo);
  perform comissoes.exigir_editavel(_ator, _mes);
  if _chave is null or length(_chave) not between 8 and 100 then
    raise exception 'chave de idempotência inválida' using errcode = '22023';
  end if;
  if _valor is null or _valor <= 0 or _valor > 100000 then
    raise exception 'valor do bônus entre 0 e 100.000' using errcode = '22023';
  end if;
  if not exists (select 1 from comissoes.pessoas where id = _pessoa) then
    raise exception 'pessoa não encontrada' using errcode = 'P0002';
  end if;
  -- Pedido repetido (mesma chave) tem um efeito só.
  perform pg_advisory_xact_lock(hashtext('comissoes.bonus'), hashtext(_chave));
  select id into v_novo from comissoes.linhas where chave_idempotencia = _chave;
  if v_novo is not null then
    return v_novo;
  end if;
  insert into comissoes.linhas (tipo, pessoa_id, valor, mes, fonte, motivo, criada_por, chave_idempotencia)
  values ('bonus', _pessoa, round(_valor, 2), _mes, 'bonus', _motivo, _ator, _chave)
  returning id into v_novo;
  insert into comissoes.eventos (linha_id, mes, pessoa_id, acao, depois, motivo, ator)
  values (v_novo, _mes, _pessoa, 'bonus_lancado', jsonb_build_object('valor', round(_valor, 2)), _motivo, _ator);
  return v_novo;
end $$;

create function comissoes.vincular_pessoa(_ator uuid, _pessoa bigint, _usuario uuid) returns void
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
declare v_antes uuid;
begin
  perform comissoes.exigir(comissoes.e_lider(_ator), 'só o líder comercial');
  select usuario_id into v_antes from comissoes.pessoas where id = _pessoa for update;
  if not found then
    raise exception 'pessoa não encontrada' using errcode = 'P0002';
  end if;
  if _usuario is not null and not ops.can_user(_usuario, 'view.comissoes') then
    raise exception 'o login escolhido não tem acesso a comissões' using errcode = '22023';
  end if;
  update comissoes.pessoas set usuario_id = _usuario where id = _pessoa;
  insert into comissoes.eventos (pessoa_id, acao, antes, depois, ator)
  values (_pessoa, 'vinculo', jsonb_build_object('usuario', v_antes), jsonb_build_object('usuario', _usuario), _ator);
end $$;

create function comissoes.liberar_mes(_ator uuid, _mes date) returns void
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_lider(_ator), 'só o líder comercial');
  update comissoes.meses set situacao = 'liberado', liberado_por = _ator, liberado_em = now()
   where mes = _mes and situacao = 'previa';
  if not found then
    raise exception 'o mês não está em prévia' using errcode = '55000';
  end if;
  insert into comissoes.eventos (mes, acao, depois, ator)
  values (_mes, 'mes_liberado', jsonb_build_object('total', comissoes.total_do_mes(_mes)), _ator);
end $$;

-- 8. Ações do financeiro -------------------------------------------------------------------------

create function comissoes.marcar_pago(_ator uuid, _mes date) returns void
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_financeiro(_ator), 'só o financeiro');
  update comissoes.meses set situacao = 'pago', pago_por = _ator, pago_em = now()
   where mes = _mes and situacao = 'liberado';
  if not found then
    raise exception 'só mês liberado pelos líderes pode ser marcado como pago' using errcode = '55000';
  end if;
  insert into comissoes.eventos (mes, acao, depois, ator)
  values (_mes, 'mes_pago', jsonb_build_object('total', comissoes.total_do_mes(_mes)), _ator);
end $$;

create function comissoes.reabrir_mes(_ator uuid, _mes date, _motivo text) returns void
language plpgsql volatile security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_financeiro(_ator), 'só o financeiro');
  _motivo := comissoes.motivo_valido(_motivo);
  update comissoes.meses set situacao = 'previa', liberado_por = null, liberado_em = null
   where mes = _mes and situacao = 'liberado';
  if not found then
    raise exception 'só mês liberado e ainda não pago pode ser reaberto' using errcode = '55000';
  end if;
  insert into comissoes.eventos (mes, acao, motivo, ator) values (_mes, 'mes_reaberto', _motivo, _ator);
end $$;

-- Exportação do mês, uma linha por pessoa e cliente, no layout da planilha (só o financeiro).
create function comissoes.exportar_mes(_ator uuid, _mes date) returns jsonb
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_financeiro(_ator), 'só o financeiro');
  return comissoes.mes_json(_mes) || jsonb_build_object('total', comissoes.total_do_mes(_mes),
                                                        'linhas', comissoes.linhas_do_mes(_mes));
end $$;

-- 9. Fechamento do schema -------------------------------------------------------------------------

revoke all on all tables in schema comissoes from public, anon, authenticated, service_role;
revoke all on all sequences in schema comissoes from public, anon, authenticated, service_role;
revoke execute on all functions in schema comissoes from public, anon, authenticated, service_role;

-- 10. Porta da tela (ops.comissoes_*) --------------------------------------------------------------
-- O ator é sempre auth.uid(); a função do schema comissoes confere a chave e o escopo por conta própria.

create function ops.comissoes_perfil() returns jsonb
language sql stable security definer set search_path = ops, pg_temp as $$ select comissoes.meu_perfil(auth.uid()) $$;
create function ops.comissoes_minhas() returns jsonb
language sql stable security definer set search_path = ops, pg_temp as $$ select comissoes.minhas_comissoes(auth.uid()) $$;
create function ops.comissoes_revisao(p_mes date) returns jsonb
language sql stable security definer set search_path = ops, pg_temp as $$ select comissoes.revisao(auth.uid(), p_mes) $$;
create function ops.comissoes_candidatos() returns jsonb
language sql stable security definer set search_path = ops, pg_temp as $$ select comissoes.candidatos_vinculo(auth.uid()) $$;
create function ops.comissoes_ajustar_linha(p_linha bigint, p_base numeric, p_percentual numeric, p_motivo text) returns jsonb
language sql volatile security definer set search_path = ops, pg_temp as $$
  select comissoes.ajustar_linha(auth.uid(), p_linha, p_base, p_percentual, p_motivo) $$;
create function ops.comissoes_excluir_linha(p_linha bigint, p_motivo text) returns void
language sql volatile security definer set search_path = ops, pg_temp as $$ select comissoes.excluir_linha(auth.uid(), p_linha, p_motivo) $$;
create function ops.comissoes_restaurar_linha(p_linha bigint, p_motivo text) returns void
language sql volatile security definer set search_path = ops, pg_temp as $$ select comissoes.restaurar_linha(auth.uid(), p_linha, p_motivo) $$;
create function ops.comissoes_incluir_metade(p_contrato integer, p_metade smallint, p_motivo text) returns integer
language sql volatile security definer set search_path = ops, pg_temp as $$
  select comissoes.incluir_metade(auth.uid(), p_contrato, p_metade, p_motivo) $$;
create function ops.comissoes_escolher_parcela(p_item bigint, p_parcela smallint) returns integer
language sql volatile security definer set search_path = ops, pg_temp as $$
  select comissoes.escolher_parcela(auth.uid(), p_item, p_parcela) $$;
create function ops.comissoes_registrar_data(p_contrato integer, p_tipo text, p_dia date) returns integer
language sql volatile security definer set search_path = ops, pg_temp as $$
  select comissoes.registrar_data(auth.uid(), p_contrato, p_tipo, p_dia) $$;
create function ops.comissoes_lancar_bonus(p_pessoa bigint, p_mes date, p_valor numeric, p_motivo text, p_chave text) returns bigint
language sql volatile security definer set search_path = ops, pg_temp as $$
  select comissoes.lancar_bonus(auth.uid(), p_pessoa, p_mes, p_valor, p_motivo, p_chave) $$;
create function ops.comissoes_vincular_pessoa(p_pessoa bigint, p_usuario uuid) returns void
language sql volatile security definer set search_path = ops, pg_temp as $$
  select comissoes.vincular_pessoa(auth.uid(), p_pessoa, p_usuario) $$;
create function ops.comissoes_liberar_mes(p_mes date) returns void
language sql volatile security definer set search_path = ops, pg_temp as $$ select comissoes.liberar_mes(auth.uid(), p_mes) $$;
create function ops.comissoes_marcar_pago(p_mes date) returns void
language sql volatile security definer set search_path = ops, pg_temp as $$ select comissoes.marcar_pago(auth.uid(), p_mes) $$;
create function ops.comissoes_reabrir_mes(p_mes date, p_motivo text) returns void
language sql volatile security definer set search_path = ops, pg_temp as $$ select comissoes.reabrir_mes(auth.uid(), p_mes, p_motivo) $$;
create function ops.comissoes_exportar_mes(p_mes date) returns jsonb
language sql stable security definer set search_path = ops, pg_temp as $$ select comissoes.exportar_mes(auth.uid(), p_mes) $$;

-- Rotina: o n8n chama de hora em hora com a chave de serviço.
create function ops.comissoes_gerar_previa() returns jsonb
language sql volatile security definer set search_path = ops, pg_temp as $$ select comissoes.gerar_previa() $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ops.comissoes_perfil()', 'ops.comissoes_minhas()', 'ops.comissoes_revisao(date)', 'ops.comissoes_candidatos()',
    'ops.comissoes_ajustar_linha(bigint, numeric, numeric, text)', 'ops.comissoes_excluir_linha(bigint, text)',
    'ops.comissoes_restaurar_linha(bigint, text)', 'ops.comissoes_incluir_metade(integer, smallint, text)',
    'ops.comissoes_escolher_parcela(bigint, smallint)', 'ops.comissoes_registrar_data(integer, text, date)',
    'ops.comissoes_lancar_bonus(bigint, date, numeric, text, text)', 'ops.comissoes_vincular_pessoa(bigint, uuid)',
    'ops.comissoes_liberar_mes(date)', 'ops.comissoes_marcar_pago(date)', 'ops.comissoes_reabrir_mes(date, text)',
    'ops.comissoes_exportar_mes(date)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function ops.comissoes_gerar_previa() from public, anon, authenticated;
grant execute on function ops.comissoes_gerar_previa() to service_role;
