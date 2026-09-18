-- Histórico de mudança dos campos do contrato.
--
-- Por que existe: a unidade do Grupo Andrade Bezerra ficou divergente do
-- Pipedrive por meses (o CRM dizia Fortaleza, o Ops dizia Maceió) e ninguém viu,
-- porque nada guardava o antes e o depois. Um contrato que troca de unidade
-- troca de dono do royalty, do CAC e do ranking: é mudança que precisa deixar
-- rastro.
--
-- Origem: `alterado_por` nulo significa que quem escreveu foi um sync (a Edge
-- Function usa service role, sem auth.uid()); preenchido significa que veio de
-- uma tela, com a pessoa identificada.

create table if not exists ops.contratos_alteracoes (
  id bigserial primary key,
  contrato_id bigint not null references ops.contratos(id) on delete cascade,
  pipedrive_deal_id text,
  campo text not null,
  valor_antigo text,
  valor_novo text,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  origem text
);

comment on table ops.contratos_alteracoes is
  'Histórico de mudança dos campos do contrato que mudam de verdade depois da venda (unidade, título, CNPJ, status, MRR, pipeline de origem, data do ganho).';

create index if not exists contratos_alteracoes_contrato_idx
  on ops.contratos_alteracoes(contrato_id, alterado_em desc);
create index if not exists contratos_alteracoes_campo_idx
  on ops.contratos_alteracoes(campo, alterado_em desc);

create or replace function ops.registrar_alteracao_contrato() returns trigger
language plpgsql security definer set search_path = ops, public as $$
declare
  -- Só os campos que mudam de verdade e mudam dono de dinheiro. Valor e
  -- produto mudam a toda sincronização e virariam ruído.
  campos text[] := array['unidade','titulo','cnpj','status_contrato','mrr_mensal','origem_pipeline','ganho_em'];
  k text;
  velho text; novo text;
  quem uuid := auth.uid();
begin
  foreach k in array campos loop
    velho := to_jsonb(old) ->> k;
    novo  := to_jsonb(new) ->> k;
    if velho is distinct from novo then
      insert into ops.contratos_alteracoes
        (contrato_id, pipedrive_deal_id, campo, valor_antigo, valor_novo, alterado_por, origem)
      values (new.id, new.pipedrive_deal_id, k, velho, novo, quem,
              case when quem is null then 'sync' else 'tela' end);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_contratos_alteracoes on ops.contratos;
create trigger trg_contratos_alteracoes
  after update on ops.contratos
  for each row execute function ops.registrar_alteracao_contrato();

alter table ops.contratos_alteracoes enable row level security;
drop policy if exists contratos_alteracoes_leitura on ops.contratos_alteracoes;
create policy contratos_alteracoes_leitura on ops.contratos_alteracoes
  for select to authenticated using (ops.can('view.unidades_rede'));
grant select on ops.contratos_alteracoes to authenticated;
