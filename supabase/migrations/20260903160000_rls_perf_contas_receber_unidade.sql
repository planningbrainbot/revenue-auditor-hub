-- ============================================================================
-- 20260903160000_rls_perf_contas_receber_unidade.sql
--
-- `contas_receber` estourava o statement_timeout para papel escopado por unidade.
--
-- MEDIDO em 03/09, papel socio_franqueado do Rio:
--   select count(*) from contas_receber  ->  9.433 ms   (statement_timeout = 8s)
--   Seq Scan de 30.876 linhas, filtro chamando `unidade_do_usuario(unidade)` POR
--   LINHA — e cada chamada roda `current_user_unidade()` duas ou três vezes, que
--   por sua vez consulta `socios`. As outras nove chamadas do mesmo predicado já
--   são InitPlan (uma vez cada, sub-milissegundo); só esta escala com a tabela.
--
-- Isso é a continuação direta da 20260814170000, que já tinha feito este mesmo
-- conserto nas OUTRAS chamadas desta policy. A de unidade ficou de fora porque
-- depende da coluna `unidade` e não podia virar `(select ...)` sozinha.
--
-- CONSERTO: a parte que depende da linha passa a ser só
-- `norm_unidade(unidade)` — IMMUTABLE, translate + regexp, sem I/O — comparada
-- contra um ARRAY que o planner resolve UMA vez como InitPlan
-- (`(select public.unidades_do_usuario())`).
--
-- EQUIVALÊNCIA — `unidades_do_usuario()` devolve o mesmo conjunto que o CASE
-- dentro de `unidade_do_usuario(text)`, com uma diferença deliberada: os
-- apelidos passam a valer nos DOIS sentidos, como `unitMatches` sempre fez no
-- cliente (src/lib/unit-names.ts). Ou seja, sócio cadastrado em `socios` como
-- 'Matriz' passa a casar a praça 'Goiania / Matriz', e 'Sudeste (RJ)' passa a
-- casar 'Rio de Janeiro' — hoje esses casos veriam ZERO linha. Nenhum sócio
-- cadastrado está nessa situação (os dois existentes são 'Rio de Janeiro' e um
-- sem unidade), então o recorte de todo mundo continua igual — conferido
-- linha a linha e por soma de `valor` antes e depois, ver o bloco de validação
-- no fim deste arquivo.
--
-- `unidade_do_usuario(text)` NÃO é alterada: continua existindo com a mesma
-- assinatura e semântica para qualquer outro uso.
-- ============================================================================

alter policy "Permission-based read" on public.contas_receber
  using (
    (
      (select public.can('view.contas_receber'::text))
      or (select public.can('view.reconciliacao'::text))
      or (select public.can('view.painel_cs'::text))
    )
    and (
      (not (select public.can('data.scope.own_unit_only'::text)))
      -- `nullif(..., '')`: norm_unidade devolve string vazia (não NULL) para
      -- entrada nula, e sem isso uma linha de unidade nula casaria com o ''
      -- que um usuário sem unidade produziria — fail-open.
      or nullif(public.norm_unidade(unidade), '')
         = any (coalesce((select public.unidades_do_usuario()), '{}'::text[]))
    )
  );

-- ----------------------------------------------------------------------------
-- Validação (rodar como cada papel, comparar com o baseline de 03/09):
--   socio_franqueado RJ -> 1.295 linhas / 11.571.105,50 / 1 unidade
--   cs                  -> 30.876 linhas / 48.643.245,94 / 7 unidades
--   admin               -> 30.876 linhas / 48.643.245,94 / 7 unidades
--   financeiro          -> 0 linhas
--
--   begin; set local role authenticated;
--   set local request.jwt.claims to '{"sub":"<uid>","role":"authenticated"}';
--   select count(*), sum(valor), count(distinct unidade) from public.contas_receber;
-- ----------------------------------------------------------------------------
