-- Fix RLS performance footgun on contas_receber: policies called has_role()/can()/
-- current_user_unidade() inline, so Postgres re-evaluates them per row instead of
-- once per query. Measured impact on v_reconciliacao_mensal (used by /rede-overview
-- "Resumo por unidade"): 65ms without RLS vs 1.2s with RLS as an authenticated user
-- (18x), on a table with only ~30k rows — enough to trip the API statement timeout
-- ("canceling statement due to statement timeout") as the table grows.
--
-- Fix: wrap each function call in `(select ...)`, the documented Postgres/Supabase
-- pattern that lets the planner cache the result as an InitPlan instead of
-- re-invoking it per row. Purely a performance change — same boolean logic, same
-- roles, same access rules. Verified via EXPLAIN ANALYZE: 332ms -> 9ms on an
-- isolated repro of the same predicate shape (36x).
--
-- Same unwrapped pattern exists on ~42 other tables (contratos, empresas,
-- central_tratativas, unidades, auditorias_internas, etc.) — not touched here,
-- scoped to contas_receber only per the timeout actually reported. See
-- wiki/log.md / ops notes for the full table list if revisiting this.

ALTER POLICY "Auditors can read contas_receber" ON public.contas_receber
  USING ((select public.has_role(auth.uid(), 'auditor'::app_role)));

ALTER POLICY "Permission-based read" ON public.contas_receber
  USING (
    (select public.can('view.contas_receber'::text))
    OR (select public.can('view.reconciliacao'::text))
    OR (select public.can('view.painel_cs'::text))
  );

ALTER POLICY "role_based_read" ON public.contas_receber
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role))
    OR (select public.has_role(auth.uid(), 'diretor'::app_role))
    OR (
      (select public.has_role(auth.uid(), 'socio'::app_role))
      AND (unidade = (select public.current_user_unidade()))
    )
  );
