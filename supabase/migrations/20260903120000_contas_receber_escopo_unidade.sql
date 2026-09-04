-- Contas a Receber vazava a rede inteira para quem tem escopo de unidade
-- (sócio franqueado): a policy de SELECT olhava só a permissão de página,
-- sem nenhum predicado de unidade. Filtrar na tela não bastava — o dado
-- continuava acessível via API com o token do próprio usuário.

-- Normaliza nome de unidade (acento, caixa, espaço) para comparação tolerante.
CREATE OR REPLACE FUNCTION public.norm_unidade(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
    lower(translate(coalesce(_s, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '\s+', ' ', 'g'))
$$;

-- Verdadeiro quando _unidade é a unidade do usuário logado.
-- Aceita os apelidos usados em tabelas legadas (Sudeste (RJ), RJ).
CREATE OR REPLACE FUNCTION public.unidade_do_usuario(_unidade text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.current_user_unidade() IS NULL OR _unidade IS NULL THEN false
    ELSE public.norm_unidade(_unidade) = ANY (
      CASE public.norm_unidade(public.current_user_unidade())
        WHEN 'rio de janeiro' THEN ARRAY['rio de janeiro', 'sudeste (rj)', 'rj']
        WHEN 'goiania / matriz' THEN ARRAY['goiania / matriz', 'matriz', 'goiania']
        WHEN 'sao luis' THEN ARRAY['sao luis']
        ELSE ARRAY[public.norm_unidade(public.current_user_unidade())]
      END
    )
  END
$$;

DROP POLICY IF EXISTS "Permission-based read" ON public.contas_receber;

CREATE POLICY "Permission-based read"
ON public.contas_receber
FOR SELECT
TO authenticated
USING (
  (
    (SELECT public.can('view.contas_receber'))
    OR (SELECT public.can('view.reconciliacao'))
    OR (SELECT public.can('view.painel_cs'))
  )
  AND (
    NOT (SELECT public.can('data.scope.own_unit_only'))
    OR public.unidade_do_usuario(unidade)
  )
);
