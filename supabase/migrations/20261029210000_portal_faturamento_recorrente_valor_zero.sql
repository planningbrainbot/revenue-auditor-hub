-- Portal de Faturamento · E2: contrato de R$ 0 sem nota no mês anterior não é linha do mês (29/10/2026).
--
-- Em nov/2026, 9 das 63 linhas que pediam resposta eram contratos de R$ 0,00 no Omie sem nota em outubro: o Omie
-- não fatura valor zero, e o dono era chamado à toa ("Sem nota em out"). Agora o contrato só é elegível com valor
-- no Omie ou com nota no mês anterior (o de R$ 0 que faturou em outubro continua, como "valor diferente").
-- Rollback: supabase/rollback/20261029210000_portal_faturamento_recorrente_valor_zero_rollback.sql

begin;

do $troca$
declare
  _def text := pg_get_functiondef('receita.fat_competencias_gerar(date)'::regprocedure);
  _a constant text := $a$            and (k.vigencia_inicial is null or k.vigencia_inicial <= k.data_fat)) as elegivel$a$;
  _b constant text := $b$            and (k.vigencia_inicial is null or k.vigencia_inicial <= k.data_fat)
            -- Contrato de R$ 0 que não faturou no mês anterior não fatura: não é linha do mês.
            and (coalesce(k.valor_mensal, 0) > 0 or coalesce(a.v, 0) > 0)) as elegivel$b$;
begin
  if position('Contrato de R$ 0' in _def) > 0 then return; end if;
  if position(_a in _def) = 0 then raise exception 'trecho da elegibilidade não encontrado'; end if;
  execute replace(_def, _a, _b);
end $troca$;

-- Atualiza o mês aberto: as linhas de R$ 0 sem resposta saem.
select receita.fat_competencias_atualizar();

commit;
