alter table ops.monetizacao_diagnostico_entradas
  drop constraint if exists monetizacao_diagnostico_entradas_consultoria_check,
  drop column if exists onboarding_card_id,
  drop column if exists saiu_onboarding_em,
  drop column if exists consultoria,
  drop column if exists consultoria_cnpj,
  drop column if exists consultoria_projeto_id,
  drop column if exists consultoria_em,
  drop column if exists consultoria_erro;
