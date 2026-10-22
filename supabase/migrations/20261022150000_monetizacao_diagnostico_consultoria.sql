-- Pipe 40 (Diagnóstico de Oportunidades), 22/10/2026: o cliente entra 30 dias depois de concluir o onboarding do CS, e
-- quem tem perfil de Consultoria é cadastrado na plataforma da Consultoria no mesmo dia (decisão do Pedro). A entrada
-- guarda de onde veio (card do onboarding e dia da conclusão) e o resultado do cadastro.
alter table ops.monetizacao_diagnostico_entradas
  add column if not exists onboarding_card_id text,
  add column if not exists saiu_onboarding_em date,
  add column if not exists consultoria text,
  add column if not exists consultoria_cnpj text,
  add column if not exists consultoria_projeto_id text,
  add column if not exists consultoria_em timestamptz,
  add column if not exists consultoria_erro text;

alter table ops.monetizacao_diagnostico_entradas
  drop constraint if exists monetizacao_diagnostico_entradas_consultoria_check;
alter table ops.monetizacao_diagnostico_entradas
  add constraint monetizacao_diagnostico_entradas_consultoria_check
  check (consultoria is null or consultoria in ('criado', 'ja_existia', 'sem_fit', 'sem_cnpj', 'pendente', 'erro'));

comment on column ops.monetizacao_diagnostico_entradas.consultoria is
  'Cadastro na plataforma da Consultoria no dia da entrada: criado (pela automação), ja_existia (o CNPJ já tinha projeto), '
  'sem_fit (fora do perfil: Real, ou Presumido de R$ 50 mi para cima), sem_cnpj, pendente (chave desligada) ou erro.';
