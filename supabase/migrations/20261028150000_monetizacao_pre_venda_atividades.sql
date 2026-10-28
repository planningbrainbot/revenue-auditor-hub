-- Pré-venda › Ritmo: as atividades por trás de cada número, uma por linha, para a aba lateral de conferência (Pedro,
-- 28/10/2026: "quero clicar em feitas hoje e poder auditar em uma aba lateral direita").
-- Devolve toda atividade de cadência que entra em algum número do Ritmo no período:
--   feita no período (pelo `feita_em`), a mesma regra de `atividades_concluidas`;
--   com vencimento no período, a mesma regra de `atividades_previstas` (cadência encerrada só conta o que venceu antes);
--   vencida agora e não feita, em cadência ativa, a mesma regra de `monetizacao_pre_venda_atrasados`.
-- Quem chama separa as listas; `automatica` marca o e-mail de apresentação do D0, fora das feitas.
-- Volta: drop function ops.monetizacao_pre_venda_atividades(date, date).

create or replace function ops.monetizacao_pre_venda_atividades(p_de date, p_ate date)
returns table (
  deal_id bigint,
  empresa text,
  user_id bigint,
  pessoa text,
  atividade text,
  vence timestamptz,
  feita boolean,
  feita_em timestamptz,
  automatica boolean,
  cadencia_ativa boolean,
  url text
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
declare
  v_de timestamptz;
  v_ate timestamptz;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_ate - p_de > 366 then
    raise exception 'Período maior que um ano' using errcode = '22023';
  end if;
  v_de := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_ate := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  return query
  with itens as (
    select c.deal_id,
           c.dono,
           c.status,
           concat_ws(' · ', 'D' || nullif(a ->> 'dia', ''), nullif(a ->> 'canal', ''),
             case a ->> 'turno' when 'manha' then 'manhã' when 'tarde' then 'tarde' else nullif(a ->> 'turno', '') end)
             as atividade,
           ops.monetizacao_pre_venda_instante(
             (a ->> 'due_date') || ' ' || coalesce(nullif(a ->> 'due_time', ''), '00:00')) as vence,
           coalesce((a ->> 'feita')::boolean, false) as feita,
           ops.monetizacao_pre_venda_instante(a ->> 'feita_em') as feita_em,
           (a ->> 'chave') = 'd0-manha-email' as automatica,
           case when c.status = 'encerrada' then coalesce(c.encerrado_em, now()) else now() end as corte
      from ops.monetizacao_cadencia c
      cross join lateral jsonb_array_elements(c.atividades) a
     where c.status in ('ativa', 'encerrada')
       and nullif(a ->> 'due_date', '') is not null
  )
  select i.deal_id,
         coalesce(nullif(d.payload ->> 'org', ''), d.payload ->> 'title', 'Card ' || i.deal_id),
         i.dono,
         coalesce(n.pessoa, d.payload ->> 'owner'),
         i.atividade,
         i.vence,
         i.feita,
         i.feita_em,
         coalesce(i.automatica, false),
         i.status = 'ativa',
         'https://grupoplanning.pipedrive.com/deal/' || i.deal_id
    from itens i
    left join ops.monetizacao_deals d on d.id = i.deal_id
    left join ops.monetizacao_pre_venda_pessoas() n on n.user_id = i.dono
   where (i.feita and i.feita_em >= v_de and i.feita_em < v_ate)
      or (i.vence >= v_de and i.vence < v_ate and (i.feita or i.corte >= now() or i.vence < i.corte))
      or (i.status = 'ativa' and not i.feita and i.vence < now())
   order by coalesce(i.feita_em, i.vence) desc, i.deal_id;
end
$$;

revoke all on function ops.monetizacao_pre_venda_atividades(date, date) from public, anon;
grant execute on function ops.monetizacao_pre_venda_atividades(date, date) to authenticated, service_role;
