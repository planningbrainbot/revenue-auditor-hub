-- ============================================================================
-- 20260903150000_v_clientes_diretorio.sql
--
-- Diretório unificado de clientes para /clientes (aba "Base nova").
--
-- ANTES: a tela lia só `empresas` com tipo_unidade='franquia' em unidade regional
-- (324 linhas). A Matriz e as BUs internas (Construção Civil, Consultoria,
-- Agronegócio) ficavam de fora por construção, e a base do ERP (omie_clientes,
-- ~10,2 mil registros: Matriz 5.149, Curitiba 4.295, demais 779) só aparecia na
-- aba "Base Antiga" — que, por sinal, voltava VAZIA pra usuário logado, porque
-- omie_clientes tem RLS ligada sem nenhuma policy de SELECT.
--
-- AGORA: uma view que une as três fontes e entrega UMA linha por documento
-- (CNPJ/CPF), com unidade normalizada e grupo econômico resolvido:
--   1. empresas          — todas as linhas (Pipedrive, Pipefy, reconciliações);
--   2. omie_clientes     — cadastro completo das 8 contas Omie, deduplicado por
--                          documento; só entra quando o documento NÃO existe em
--                          empresas (senão enriquece a linha de empresas);
--   3. omie_clientes_cadastro — fonte complementar mais fresca da conta Partners
--                          (359 CNPJs que ainda não chegaram em omie_clientes);
--                          só entra quando não existe nas duas anteriores.
--
-- `base`:  'nova' = tem deal no Pipedrive (mesmo recorte da tela hoje, estendido
--          à Matriz); 'antiga' = só ERP/reconciliação. Os cards Ativos/Churn da
--          tela continuam contando só base nova.
-- `grupo`: resolvido nesta ordem de prioridade —
--          (1) grupos via empresas.grupo_id ou grupos.cnpj_raiz  -> 'g:<id>'
--          (2) filiais atreladas a um contrato (contrato_omie_grupos) -> 'c:<contrato_id>'
--          (3) nome fantasia "GRUPO X" no Omie (mesmo grupo, raízes diferentes) -> 'n:<slug>'
--          (4) raiz de CNPJ compartilhada por 2+ documentos -> 'r:<raiz8>'
--          (3) e (4) só viram grupo com 2+ DOCUMENTOS distintos; (1) e (2) são explícitos.
--
-- Custo medido em 03/09: ~11,2 mil linhas de saída, ~0,5 s quente. Aditiva: não
-- altera nenhuma tabela.
--
-- ----------------------------------------------------------------------------
-- SEGURANÇA — as três camadas, e por que a view carrega a sua própria
-- ----------------------------------------------------------------------------
-- `security_invoker = true` faz a view respeitar a RLS de quem consulta, mas
-- isso NÃO bastava: `omie_clientes_cadastro` tem policy `using (true)` para
-- authenticated (20260714200000, e a 20260826093000 manteve de propósito porque
-- Fila Cella e royalties dependem), então a primeira versão desta view entregava
-- ~10 mil documentos para QUALQUER usuário logado, inclusive papéis sem
-- `view.clientes` (medido: papel `financeiro` lia 11.173 linhas). Por isso o
-- SELECT final da view carrega o próprio gate:
--
--   (a) permissão: as mesmas chaves das policies das tabelas que a view lê
--       (`view.clientes`, `view.fila_cella`, `view.painel_cs`), ou admin/diretor,
--       ou conexão de servidor (service_role/postgres, que não têm auth.uid()).
--       Um gate mais estreito que essas policies devolveria tela vazia sem erro
--       para quem alcança o dado por outro caminho — o modo de falha que a
--       20260722180000 foi escrita para eliminar.
--   (b) escopo por unidade: quem tem `data.scope.own_unit_only` (socio,
--       socio_franqueado) só enxerga a própria praça. O casamento é por
--       `public.norm_unidade()` (função que já existia: lower + acentos + espaços
--       colapsados, a mesma regra de `normalizeUnitName` no cliente) contra
--       `public.unidades_do_usuario()`, que replica no banco os apelidos que
--       `unitMatches` usava só no cliente, nos DOIS sentidos ("Sudeste (RJ)" =
--       "Rio de Janeiro", "Matriz" = "Goiania / Matriz").
--       Sócio sem linha em `socios` (unidade nula) vê ZERO linhas — fail-closed,
--       porque `x = any('{}')` é false.
--       O escopo casa a praça da linha OU qualquer conta Omie em que o documento
--       aparece: para as ~10 mil linhas só-ERP, `unidade` sai de um desempate por
--       `max(updated_at)` entre contas, então sem a segunda metade o franqueado
--       perderia a linha inteira de um cliente que ele fatura, conforme a conta
--       que sincronizou por último. Ele já enxerga esses títulos em
--       `contas_receber`. As AÇÕES (editar, marcar churn) continuam presas à
--       `unidade`, no cliente e no servidor.
--
-- A policy de `omie_clientes` criada aqui repete o mesmo escopo, para que o
-- vazamento não volte por uma consulta direta à tabela (antes desta migration a
-- tabela tinha RLS sem policy nenhuma, ou seja, ninguém lia). O escopo é uma
-- policy RESTRICTIVE separada: a 20260826093000 cria outras três policies
-- PERMISSIVE de SELECT nessa tabela, e permissivas são OR'd — um perfil
-- customizado passaria por fora.
-- `contas_receber` NÃO ganha policy nova: quem não enxerga AR só perde a coluna
-- `ultimo_recebimento` (fica null), o resto da view funciona.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) norm_unidade() e unidades_do_usuario() — os nomes de praça que o usuário
--    atual pode ver, já normalizados. NULL quando não há unidade; quem consome
--    faz `= any (coalesce(..., '{}'))`, que é false — falha fechado.
--    Os apelidos são os mesmos de UNIT_ALIASES em src/lib/unit-names.ts, e valem
--    nos dois sentidos como no `unitMatches`.
--    "São Luís"/"São Luis" não precisa de apelido: unaccent resolve.
-- ----------------------------------------------------------------------------
-- `public.norm_unidade(text)` JÁ EXISTE no banco (IMMUTABLE, translate + lower +
-- espaços colapsados — a mesma regra de normalizeUnitName no cliente) e não é
-- redefinida aqui. Atenção ao contrato dela: devolve STRING VAZIA para entrada
-- nula, não NULL. Por isso todo uso abaixo vem embrulhado em `nullif(..., '')`:
-- sem isso, um sócio sem unidade produziria o array {''} e casaria com toda
-- linha de unidade nula — fail-open exatamente no caso que o gate existe pra
-- fechar.
create or replace function public.unidades_do_usuario()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with alvo as (select nullif(public.norm_unidade(public.current_user_unidade()), '') as u),
  -- apelidos, aplicados nos DOIS sentidos como unitMatches faz no cliente:
  -- sócio cadastrado como 'Sudeste (RJ)' precisa casar praça 'Rio de Janeiro',
  -- e sócio de 'Matriz' precisa casar 'Goiania / Matriz'.
  pares (a, b) as (
    values ('rio de janeiro',   'sudeste (rj)'),
           ('rio de janeiro',   'rj'),
           ('goiania / matriz', 'matriz'),
           ('goiania / matriz', 'goiania')
  )
  select case
           when (select u from alvo) is null then null
           else array(
             select distinct v
             from (
                    select (select u from alvo)
               union all select p.b from pares p where p.a = (select u from alvo)
               union all select p.a from pares p where p.b = (select u from alvo)
             ) t(v)
             where v is not null
           )
         end
$$;

comment on function public.unidades_do_usuario() is
  'Nomes de praça (lower+unaccent) que o usuário atual pode ver, incluindo apelidos. NULL quando o usuário não tem unidade — o predicado que usa `= any()` falha fechado.';

revoke execute on function public.unidades_do_usuario()   from public, anon;
grant  execute on function public.unidades_do_usuario()   to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) RLS — leitura de omie_clientes e grupos.
--    Padrão initplan `(select ...)` da 20260826080000: sem o `(select)` o
--    planner reavalia a função por linha (18x medido em contas_receber).
-- ----------------------------------------------------------------------------

-- omie_clientes: superset das chaves que precisam da tabela (a 20260826093000
-- previa fila_cella/painel_cs), + escopo por unidade para quem é escopado.
-- 'Partners' é o nome da conta Omie da Matriz; normalizado aqui como na view.
drop policy if exists "Permission-based read" on public.omie_clientes;
create policy "Permission-based read" on public.omie_clientes
  for select to authenticated
  using (
    (select public.can('view.clientes'))
    or (select public.can('view.fila_cella'))
    or (select public.can('view.painel_cs'))
    or (select public.has_role(auth.uid(), 'admin'::app_role))
    or (select public.has_role(auth.uid(), 'diretor'::app_role))
  );

-- O escopo por unidade tem que ser RESTRICTIVE, não parte do USING acima: a
-- 20260826093000 cria mais três policies PERMISSIVE de SELECT nesta tabela
-- (role_based_read, "Auditors can read", "Custom roles can read"), e policies
-- permissivas são OR'd — um perfil customizado passaria por fora do escopo.
-- RESTRICTIVE é ANDed com todas elas.
-- `= any (coalesce(..., '{}'))`: sem o coalesce, `any ((select f()))` é lido como
-- ANY(subquery) e o Postgres procura o operador `text = text[]`, que não existe.
drop policy if exists "unit scope" on public.omie_clientes;
create policy "unit scope" on public.omie_clientes
  as restrictive for select to authenticated
  using (
    not (select public.can('data.scope.own_unit_only'))
    or nullif(public.norm_unidade(case when unidade = 'Partners' then 'Matriz' else unidade end), '')
       = any (coalesce((select public.unidades_do_usuario()), '{}'::text[]))
  );

-- grupos: 12 linhas de metadado de grupo econômico. Só quem NÃO é escopado por
-- unidade — para um franqueado, `grupo_qtd` contaria membros de outras praças, e
-- `descricao`/`grupo_pipefy_id` não têm por que sair da matriz. Para esses
-- papéis o LEFT JOIN da view vira null e o grupo cai para contrato/fantasia/raiz.
drop policy if exists "Permission-based read" on public.grupos;
create policy "Permission-based read" on public.grupos
  for select to authenticated
  using (
    (select public.can('view.clientes'))
    and not (select public.can('data.scope.own_unit_only'))
  );

-- ----------------------------------------------------------------------------
-- 3) A view
-- ----------------------------------------------------------------------------
drop view if exists public.v_clientes_diretorio cascade;

create view public.v_clientes_diretorio with (security_invoker = true) as
with
unid as (
  select nome_da_praca, tipo, lower(public.unaccent(nome_da_praca)) as k
  from public.unidades
),
-- empresas: mantém o grão de hoje (1 linha por registro), doc só com dígitos.
-- 35 linhas gravadas em 27/08 têm 15 dígitos (CNPJ válido + um '0' à direita,
-- provável cast de float na importação); sem o corte elas não casam com o Omie e
-- a mesma empresa sai duas vezes. Corrigir na origem é decisão à parte — aqui a
-- view só deixa de propagar o defeito.
emp as (
  select e.id, e.razao_social, e.titulo, e.uf, e.unidade, e.tipo_unidade, e.pipedrive_id,
         e.fonte_cadastro, e.status_financeiro, e.erp, e.segmento, e.grupo_id, e.created_at,
         case
           when length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 15
            and right(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g'), 1) = '0'
           then left(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g'), 14)
           else regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')
         end as doc
  from public.empresas e
),
emp_docs as (select distinct doc from emp where doc <> ''),
-- omie: unidade normalizada pro nome de unidades.nome_da_praca
--       ('Partners' -> 'Matriz', 'São Luís' -> 'São Luis')
omi as (
  select o.codigo_omie, o.razao_social, o.nome_fantasia, o.cidade, o.estado, o.inativo,
         o.pessoa_fisica, o.updated_at,
         regexp_replace(coalesce(o.cnpj_cpf, ''), '\D', '', 'g') as doc,
         coalesce(u.nome_da_praca, o.unidade, '(sem unidade)') as unidade,
         -- unidade como está na tabela: entra na chave do ramo 4 porque a PK de
         -- omie_clientes é (codigo_omie, unidade) crua, e duas contas cruas podem
         -- colapsar no mesmo nome_da_praca.
         coalesce(o.unidade, '(sem unidade)') as unidade_crua
  from public.omie_clientes o
  left join unid u
    on u.k = lower(public.unaccent(case when o.unidade = 'Partners' then 'Matriz' else o.unidade end))
),
-- 1 linha por documento: campos do registro mais recente, unidades = todas as contas
omi_doc as (
  select doc,
         (array_agg(codigo_omie   order by updated_at desc nulls last, codigo_omie))[1] as codigo_omie,
         (array_agg(razao_social  order by updated_at desc nulls last, codigo_omie))[1] as razao_social,
         (array_agg(nome_fantasia order by updated_at desc nulls last, codigo_omie))[1] as nome_fantasia,
         (array_agg(cidade        order by updated_at desc nulls last, codigo_omie))[1] as cidade,
         (array_agg(estado        order by updated_at desc nulls last, codigo_omie))[1] as estado,
         (array_agg(unidade       order by updated_at desc nulls last, codigo_omie))[1] as unidade,
         array_agg(distinct unidade) filter (where unidade is not null)                 as unidades,
         -- inativo só quando inativo em TODAS as contas em que aparece
         bool_and(coalesce(inativo, false))                                             as inativo,
         bool_or(coalesce(pessoa_fisica, false))                                        as pessoa_fisica,
         max(updated_at)                                                                as updated_at
  from omi
  where doc <> ''
  group by doc
),
cad as (
  select c.razao_social, c.data_cadastro, c.updated_at,
         regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as doc,
         coalesce(u.nome_da_praca, c.unidade) as unidade
  from public.omie_clientes_cadastro c
  left join unid u
    on u.k = lower(public.unaccent(case when c.unidade = 'Partners' then 'Matriz' else c.unidade end))
),
cad_doc as (
  select doc,
         (array_agg(razao_social order by updated_at desc nulls last))[1] as razao_social,
         (array_agg(unidade      order by updated_at desc nulls last))[1] as unidade,
         array_agg(distinct unidade) filter (where unidade is not null) as unidades,
         min(data_cadastro) as data_cadastro
  from cad
  where doc <> ''
  group by doc
),
-- contratos ativos por deal e por documento
contr_deal as (
  select pipedrive_deal_id, min(id) as contrato_id
  from public.contratos
  where status_contrato = 'Ativo' and pipedrive_deal_id is not null
  group by pipedrive_deal_id
),
contr_doc as (
  select regexp_replace(cnpj, '\D', '', 'g') as doc, min(id) as contrato_id
  from public.contratos
  where status_contrato = 'Ativo' and coalesce(cnpj, '') <> ''
  group by 1
),
-- filiais atreladas a contrato (contrato_omie_grupos), por documento
filial as (
  select regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') as doc, min(contrato_id) as contrato_id
  from public.contrato_omie_grupos
  group by 1
),
contratos_com_filial as (select distinct contrato_id from public.contrato_omie_grupos),
-- último recebimento por documento, em qualquer conta Omie
receb as (
  select regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') as doc, max(data_pagamento) as ultimo_recebimento
  from public.contas_receber
  where upper(status_pagamento) = 'RECEBIDO' and data_pagamento is not null
  group by 1
),
-- --------------------------------------------------------------------------
-- linhas base
-- --------------------------------------------------------------------------
rows_all as (
  -- (1) empresas
  select
    'e:' || e.id::text                                            as chave,
    e.id                                                          as empresa_id,
    case
      when e.pipedrive_id is not null and (od.doc is not null or cd.doc is not null) then 'ambos'
      when e.pipedrive_id is not null                                                then 'pipedrive'
      when od.doc is not null or cd.doc is not null                                  then 'omie'
      else 'ops'
    end                                                           as origem,
    case when e.pipedrive_id is not null then 'nova' else 'antiga' end as base,
    e.razao_social,
    e.titulo,
    od.nome_fantasia,
    nullif(e.doc, '')                                             as documento,
    e.uf,
    od.cidade,
    coalesce(u.nome_da_praca, e.unidade)                          as unidade,
    coalesce(e.tipo_unidade,
             case u.tipo when 'regional' then 'franquia' when 'interna' then 'matriz' end) as tipo_unidade,
    -- união das contas Omie das duas fontes: 22 documentos aparecem no cadastro
    -- da Matriz sem estar em omie_clientes daquela conta, e um coalesce perderia
    -- essa praça no filtro de unidade da tela.
    coalesce(
      (select array_agg(distinct x order by x)
         from unnest(coalesce(od.unidades, '{}'::text[]) || coalesce(cd.unidades, '{}'::text[])) x),
      '{}'::text[]
    )                                                             as unidades_omie,
    e.pipedrive_id,
    e.fonte_cadastro,
    e.status_financeiro,
    e.erp,
    e.segmento,
    od.codigo_omie,
    od.inativo                                                    as omie_inativo,
    od.pessoa_fisica,
    e.grupo_id                                                    as grupo_id_cadastro,
    coalesce(cdl.contrato_id, cdd.contrato_id)                    as contrato_id,
    (cdl.contrato_id is not null or cdd.contrato_id is not null)  as tem_contrato_ativo,
    f.contrato_id                                                 as filial_de_contrato_id,
    r.ultimo_recebimento,
    cd.data_cadastro                                              as omie_data_cadastro,
    e.created_at                                                  as atualizado_em
  from emp e
  left join unid u        on u.k = lower(public.unaccent(e.unidade))
  left join omi_doc od    on e.doc <> '' and od.doc = e.doc
  left join cad_doc cd    on e.doc <> '' and cd.doc = e.doc
  left join contr_deal cdl on cdl.pipedrive_deal_id = e.pipedrive_id
  left join contr_doc cdd  on e.doc <> '' and cdd.doc = e.doc
  left join filial f       on e.doc <> '' and f.doc = e.doc
  left join receb r        on e.doc <> '' and r.doc = e.doc

  union all

  -- (2) omie sem par em empresas
  select
    'o:' || od.doc,
    null,
    'omie',
    'antiga',
    od.razao_social,
    null,
    od.nome_fantasia,
    od.doc,
    od.estado,
    od.cidade,
    od.unidade,
    case u.tipo when 'regional' then 'franquia' when 'interna' then 'matriz' end,
    coalesce(
      (select array_agg(distinct x order by x)
         from unnest(coalesce(od.unidades, '{}'::text[]) || coalesce(cd.unidades, '{}'::text[])) x),
      '{}'::text[]
    ),
    null,
    'omie_clientes',
    null,
    null,
    null,
    od.codigo_omie,
    od.inativo,
    od.pessoa_fisica,
    null,
    cdd.contrato_id,
    (cdd.contrato_id is not null),
    f.contrato_id,
    r.ultimo_recebimento,
    cd.data_cadastro,
    od.updated_at
  from omi_doc od
  left join unid u       on u.nome_da_praca = od.unidade
  left join cad_doc cd   on cd.doc = od.doc
  left join contr_doc cdd on cdd.doc = od.doc
  left join filial f      on f.doc = od.doc
  left join receb r       on r.doc = od.doc
  where not exists (select 1 from emp_docs x where x.doc = od.doc)

  union all

  -- (3) cadastro sem par em omie nem em empresas
  select
    'c:' || cd.doc,
    null,
    'omie',
    'antiga',
    cd.razao_social,
    null,
    null,
    cd.doc,
    null,
    null,
    cd.unidade,
    case u.tipo when 'regional' then 'franquia' when 'interna' then 'matriz' end,
    coalesce(cd.unidades, '{}'::text[]),
    null,
    'omie_clientes_cadastro',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    cdd.contrato_id,
    (cdd.contrato_id is not null),
    f.contrato_id,
    r.ultimo_recebimento,
    cd.data_cadastro,
    null
  from cad_doc cd
  left join unid u       on u.nome_da_praca = cd.unidade
  left join contr_doc cdd on cdd.doc = cd.doc
  left join filial f      on f.doc = cd.doc
  left join receb r       on r.doc = cd.doc
  where not exists (select 1 from emp_docs x where x.doc = cd.doc)
    and not exists (select 1 from omi_doc  x where x.doc = cd.doc)

  union all

  -- (4) omie sem documento: mantém 1 linha por registro (não dá pra deduplicar).
  -- `omi` já garante unidade não nula ('(sem unidade)'), então a chave nunca é null.
  select
    'o:' || o.unidade_crua || ':' || o.codigo_omie::text,
    null,
    'omie',
    'antiga',
    o.razao_social,
    null,
    o.nome_fantasia,
    null,
    o.estado,
    o.cidade,
    o.unidade,
    case u.tipo when 'regional' then 'franquia' when 'interna' then 'matriz' end,
    array[o.unidade],
    null,
    'omie_clientes',
    null,
    null,
    null,
    o.codigo_omie,
    o.inativo,
    o.pessoa_fisica,
    null,
    null,
    false,
    null,
    null,
    null,
    o.updated_at
  from omi o
  left join unid u on u.nome_da_praca = o.unidade
  where o.doc = ''
),
-- --------------------------------------------------------------------------
-- grupo econômico
--
-- Candidatos, do mais explícito ao mais heurístico. Duas armadilhas tratadas:
--   · a fantasia é normalizada em slug ('GRUPO NEW PET' e 'GRUPO NEWPET' são o
--     mesmo grupo, e sem isso a raiz 16417998 saía partida em dois);
--   · fantasia e raiz só valem com 2+ DOCUMENTOS distintos, contados ANTES da
--     escolha da chave. Sem isso uma fantasia solteira "sequestrava" a linha da
--     raiz dela e o par inteiro ficava sem grupo (raiz 25076027), e duas linhas
--     de `empresas` com o mesmo CNPJ (2 deals) viravam um "grupo" de 2 que é a
--     mesma empresa consigo mesma.
-- --------------------------------------------------------------------------
cand as (
  select b.*,
         coalesce(g1.id, g2.id)     as g_cad_direto,
         coalesce(
           b.filial_de_contrato_id,
           case when b.contrato_id in (select contrato_id from contratos_com_filial) then b.contrato_id end
         )                          as g_contrato_id,
         -- slug (chave) e label (exibição) da mesma fantasia: 'GRUPO NEW PET' e
         -- 'GRUPO NEWPET' têm o mesmo slug, mas a badge mostra o nome com espaços.
         case when upper(coalesce(b.nome_fantasia, '')) like 'GRUPO %'
              then nullif(regexp_replace(upper(public.unaccent(b.nome_fantasia)), '[^A-Z0-9]', '', 'g'), '')
         end                        as g_fantasia,
         case when upper(coalesce(b.nome_fantasia, '')) like 'GRUPO %'
              then upper(btrim(regexp_replace(public.unaccent(b.nome_fantasia), '\s+', ' ', 'g')))
         end                        as g_fantasia_label,
         case when length(b.documento) = 14 then left(b.documento, 8) end as raiz
  from rows_all b
  left join public.grupos g1 on g1.id = b.grupo_id_cadastro
  -- LATERAL com limit 1: `grupos.cnpj_raiz` não tem índice único, e duas linhas
  -- com a mesma raiz duplicariam a linha inteira do diretório (chave repetida).
  left join lateral (
    select g.id, g.nome
    from public.grupos g
    where length(b.documento) = 14 and g.cnpj_raiz = left(b.documento, 8)
    order by g.id
    limit 1
  ) g2 on true
),
-- quantos DOCUMENTOS distintos cada candidato heurístico junta
qtd_fantasia as (
  select g_fantasia, count(distinct documento) as n
  from cand where g_fantasia is not null and documento is not null group by 1
),
qtd_raiz as (
  select raiz, count(distinct documento) as n
  from cand where raiz is not null group by 1
),
-- se QUALQUER membro do mesmo contrato / fantasia / raiz já está num grupo do
-- cadastro, o grupo do cadastro vence pra todos (evita "Rede Ótica" partido em
-- dois: g:3 pra quem tem empresas.grupo_id e c:3 pra filial que só existe em
-- contrato_omie_grupos). Idem fantasia sobre raiz: a raiz inteira segue a
-- fantasia quando ela é válida. Os CASEs evitam que a partição NULL junte todo mundo.
unif as (
  select c.*,
         (qf.n >= 2) as fantasia_valida,
         (qr.n >= 2) as raiz_valida,
         coalesce(
           c.g_cad_direto,
           case when c.g_contrato_id is not null
                then max(c.g_cad_direto) over (partition by c.g_contrato_id) end,
           case when qf.n >= 2
                then max(c.g_cad_direto) over (partition by c.g_fantasia) end,
           case when qr.n >= 2
                then max(c.g_cad_direto) over (partition by c.raiz) end
         ) as g_cad_id,
         case when qr.n >= 2
              then max(case when qf.n >= 2 then c.g_fantasia end) over (partition by c.raiz) end
           as g_fantasia_da_raiz
  from cand c
  left join qtd_fantasia qf on qf.g_fantasia = c.g_fantasia
  left join qtd_raiz     qr on qr.raiz = c.raiz
),
keyed as (
  select u.*,
         g.nome as g_cad_nome,
         case
           when u.g_cad_id      is not null then 'g:' || u.g_cad_id::text
           when u.g_contrato_id is not null then 'c:' || u.g_contrato_id::text
           when coalesce(u.fantasia_valida, false) then 'n:' || u.g_fantasia
           when u.g_fantasia_da_raiz is not null   then 'n:' || u.g_fantasia_da_raiz
           when coalesce(u.raiz_valida, false)     then 'r:' || u.raiz
         end as k_cand,
         case
           when u.g_cad_id      is not null then 'cadastro'
           when u.g_contrato_id is not null then 'contrato'
           when coalesce(u.fantasia_valida, false) then 'nome_fantasia'
           when u.g_fantasia_da_raiz is not null   then 'nome_fantasia'
           when coalesce(u.raiz_valida, false)     then 'raiz_cnpj'
         end as k_origem
  from unif u
  left join public.grupos g on g.id = u.g_cad_id
),
-- grupo_qtd conta DOCUMENTOS distintos, não linhas: duas linhas de `empresas`
-- com o mesmo CNPJ (dois deals do Pipedrive) inflavam o contador da badge.
-- Linha sem documento conta por `chave`, que é única.
qtd_grupo as (
  select k_cand, count(distinct coalesce(documento, chave)) as n
  from keyed where k_cand is not null group by 1
),
counted as (
  select k.*,
         qg.n as k_qtd,
         -- só o label de uma fantasia VÁLIDA nomeia o grupo: um membro arrastado
         -- pela raiz pode ter fantasia solteira ('GRUPO ABC') e batizaria o grupo.
         min(case when k.fantasia_valida then k.g_fantasia_label end)
           over (partition by k.k_cand) as k_fantasia_label,
         -- nome do grupo: primeiro membro com nome de verdade. 198 linhas de
         -- base nova têm razão social sem letra ('.', '0') vinda do sync do
         -- Pipedrive; sem o filtro elas ganhavam a disputa (são as mais curtas)
         -- e a badge do grupo aparecia como ".".
         first_value(
           coalesce(
             case when k.razao_social  ~ '[[:alpha:]]' then btrim(k.razao_social) end,
             case when k.titulo        ~ '[[:alpha:]]' then btrim(k.titulo) end,
             case when k.nome_fantasia ~ '[[:alpha:]]' then btrim(k.nome_fantasia) end
           )
         ) over (
           partition by k.k_cand
           order by (coalesce(
                       case when k.razao_social  ~ '[[:alpha:]]' then btrim(k.razao_social) end,
                       case when k.titulo        ~ '[[:alpha:]]' then btrim(k.titulo) end,
                       case when k.nome_fantasia ~ '[[:alpha:]]' then btrim(k.nome_fantasia) end
                     ) is null),
                    (k.base = 'nova') desc,
                    (substr(k.documento, 9, 4) = '0001') desc nulls last,
                    k.chave
         ) as k_nome_membro
  from keyed k
  left join qtd_grupo qg on qg.k_cand = k.k_cand
),
final as (
  select c.*,
         -- contrato cuja única "filial" tem o mesmo CNPJ do titular não é grupo:
         -- viraria uma badge "(1)". As origens heurísticas já exigiram 2+ documentos.
         case when c.k_cand is not null and not (c.k_origem = 'contrato' and c.k_qtd < 2)
              then c.k_cand end as grupo_chave
  from counted c
)
select
  f.chave,
  f.empresa_id,
  f.origem,
  f.base,
  f.razao_social,
  f.titulo,
  f.nome_fantasia,
  f.documento,
  case length(f.documento) when 14 then 'CNPJ' when 11 then 'CPF' end as tipo_documento,
  f.uf,
  f.cidade,
  f.unidade,
  f.tipo_unidade,
  f.unidades_omie,
  f.pipedrive_id,
  f.fonte_cadastro,
  f.status_financeiro,
  f.erp,
  f.segmento,
  f.codigo_omie,
  f.omie_inativo,
  f.pessoa_fisica,
  f.contrato_id,
  f.tem_contrato_ativo,
  f.ultimo_recebimento,
  f.omie_data_cadastro,
  f.grupo_chave,
  case when f.grupo_chave is not null and f.k_origem = 'cadastro' then f.g_cad_id end as grupo_id,
  case
    when f.grupo_chave is null then null
    when f.k_origem = 'cadastro'      then f.g_cad_nome
    when f.k_origem = 'nome_fantasia' then coalesce(f.k_fantasia_label, f.k_nome_membro, f.grupo_chave)
    else coalesce(f.k_nome_membro, f.grupo_chave)
  end as grupo_nome,
  case when f.grupo_chave is not null then f.k_origem end as grupo_origem,
  case when f.grupo_chave is not null then f.k_qtd::int end as grupo_qtd,
  f.atualizado_em
from final f
-- gate (a): permissão. O conjunto de chaves é o MESMO das policies das tabelas
-- que a view lê (empresas, omie_clientes) — um gate mais estreito devolveria
-- tela vazia sem erro para quem tem acesso ao dado por outro caminho, que é o
-- modo de falha que a 20260722180000 foi escrita para eliminar.
-- Conexões de servidor (service_role dos jobs, postgres da Management API) não
-- têm auth.uid(), então can() daria false: passam pelo nome do role.
where (
        (select current_user in ('postgres', 'service_role', 'supabase_admin'))
        or (select public.can('view.clientes'))
        or (select public.can('view.fila_cella'))
        or (select public.can('view.painel_cs'))
        or (select public.has_role(auth.uid(), 'admin'::app_role))
        or (select public.has_role(auth.uid(), 'diretor'::app_role))
      )
-- gate (b): escopo por unidade, fail-closed (unidade nula do usuário OU da linha
-- não casa com nada, porque `x = any('{}')` é false).
-- Casa a praça da linha OU qualquer conta Omie em que o documento aparece: ~10
-- mil linhas só-ERP têm `unidade` decidida por desempate de sync entre contas, e
-- sem a segunda metade o franqueado perderia a linha inteira de um cliente que
-- ele fatura, conforme a conta que sincronizou por último. Ele já enxerga esses
-- títulos em contas_receber. As AÇÕES (editar, marcar churn) continuam presas à
-- `unidade`, no cliente e no servidor.
  and (
        (select current_user in ('postgres', 'service_role', 'supabase_admin'))
        or not (select public.can('data.scope.own_unit_only'))
        or nullif(public.norm_unidade(f.unidade), '')
           = any (coalesce((select public.unidades_do_usuario()), '{}'::text[]))
        or exists (
             select 1 from unnest(f.unidades_omie) uo
             where nullif(public.norm_unidade(uo), '')
                   = any (coalesce((select public.unidades_do_usuario()), '{}'::text[]))
           )
      );

comment on view public.v_clientes_diretorio is
  'Diretório unificado de clientes (empresas + omie_clientes + omie_clientes_cadastro), 1 linha por documento, com unidade normalizada e grupo econômico resolvido. Lido por /clientes. security_invoker + gate próprio de view.clientes e de escopo por unidade (ver cabeçalho da migration 20260903150000).';

grant select on public.v_clientes_diretorio to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) list_clientes_diretorio() — a tela inteira em UMA execução da view.
--
-- Sem isso o cliente pagina com .range(): a view tem UNION + window functions,
-- então o LIMIT não desce e CADA bloco de 1000 reexecuta os 11,2 mil registros
-- (medido: 1 bloco ≈ view inteira ≈ 0,5 s quente / 1,7 s frio; 12 blocos ⇒ 6 a
-- 20 s por abertura da tela). Retorno escalar jsonb também escapa do
-- max-rows=1000 do PostgREST.
-- `security invoker`: a RLS e os dois gates da view continuam valendo.
-- ----------------------------------------------------------------------------
create or replace function public.list_clientes_diretorio()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.v_clientes_diretorio v
$$;

comment on function public.list_clientes_diretorio() is
  'Devolve v_clientes_diretorio inteira como jsonb, em uma execução. Usada por listClientesDiretorio (src/lib/clientes.functions.ts) no lugar da paginação por range(), que reexecutava a view a cada bloco.';

revoke execute on function public.list_clientes_diretorio() from public, anon;
grant  execute on function public.list_clientes_diretorio() to authenticated, service_role;
