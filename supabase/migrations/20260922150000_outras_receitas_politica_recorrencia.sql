-- 68_outras_receitas_politica_recorrencia.sql
-- Politica de recorrencia das linhas de "outras receitas" da apuracao.
--
-- Decisao do usuario em 22/09/2026:
--   Pipedrive e Panda Pe .... recorrentes, valor fixo
--   Qculture Rocks .......... o valor oscila, tem de ser digitado mes a mes
--   Acesso ao Power BI ...... nao sera mais cobrado
--
-- POR QUE UMA POLITICA, E NAO UMA TABELA DE RECORRENTES: criarApuracao
-- (src/lib/royalties.functions.ts) ja copia TODAS as linhas de outras receitas
-- da apuracao anterior da unidade. Trocar isso por um catalogo faria Customer
-- Success e Gente & Gestao pararem de aparecer, porque nao estao em catalogo
-- nenhum -- uma regressao silenciosa que so apareceria na competencia seguinte.
-- Entao a copia continua sendo a regra geral, e esta tabela e a excecao: diz o
-- que fazer com as quatro linhas que tem regra propria. O resto passa direto.
--
-- O casamento e por regex sobre ops.cac_nome_chave(nome), que tira acento e
-- colapsa pontuacao, porque os nomes foram digitados a mao e divergem:
-- "Pipedrive" e "Pipe drive"; "Panda Pé" e "Panda pé"; "Qculture Rocks",
-- "Qulture.rocks" e "Qulture rocks"; "Acesso Power BI" e "Acesso ao Power BI".
-- Normalizar o nome tambem conserta esse espalhamento.

set search_path = ops, public;

begin;

create table if not exists ops.royalties_outras_receitas_politica (
  id             bigserial primary key,
  chave          text        not null unique,
  nome_canonico  text        not null,
  padrao         text        not null,
  modo           text        not null check (modo in ('fixo', 'mensal', 'descontinuado')),
  valor          numeric(12,2),
  observacao     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint politica_fixo_tem_valor check (modo <> 'fixo' or valor is not null)
);

comment on table ops.royalties_outras_receitas_politica is
  'Excecoes a copia mes-a-mes de royalties_outras_receitas_itens. Fonte de verdade '
  'do valor das linhas fixas. Linha que nao casa com nenhum padrao daqui e copiada '
  'do mes anterior sem alteracao.';

insert into ops.royalties_outras_receitas_politica
  (chave, nome_canonico, padrao, modo, valor, observacao)
values
  ('pipedrive', 'Pipedrive', '^pipe ?drive$', 'fixo', 335.36,
   'R$ 335,36 em todas as unidades. Valor praticado em 06, 07 e 08/2026; os R$ 335,00 '
   || 'de Belem e Patos em 08/2026 foram digitacao, e nao foram corrigidos porque a ND '
   || 'daquele mes ja tinha saido.'),
  ('panda_pe', 'Panda Pé', '^panda pe$', 'fixo', 85.00,
   'R$ 85,00, estavel desde 06/2026 em todas as unidades que pagam a linha.'),
  -- "qculture" e "qulture": o 'c' e opcional, mas o 'ulture' e comum aos dois.
  -- Escrever '^q(c|u)lture' nao casa "qculture" -- depois do 'qc' vem "ulture".
  ('qculture', 'Qculture Rocks', '^qc?ulture', 'mensal', null,
   'O valor oscila com o numero de assentos, entao a linha nasce em ZERO e precisa ser '
   || 'preenchida a cada competencia. Faixa observada: R$ 430,94 a R$ 1.896,18.'),
  ('power_bi', 'Acesso ao Power BI', 'power bi', 'descontinuado', null,
   'Nao e mais cobrado das unidades, por decisao do usuario em 22/09/2026.')
on conflict (chave) do update
   set nome_canonico = excluded.nome_canonico,
       padrao        = excluded.padrao,
       modo          = excluded.modo,
       valor         = excluded.valor,
       observacao    = excluded.observacao,
       atualizado_em = now();

-- ---------------------------------------------------------------- aplicacao
-- Roda sobre uma apuracao recem-criada, depois da copia do mes anterior.
-- Idempotente. So mexe em 'rascunho' -- mes confirmado ou faturado e intocavel,
-- que e o que protege as competencias ja cobradas.
create or replace function ops.royalties_aplicar_politica_outras(p_apuracao_id bigint)
returns table (acao text, nome text, de numeric, para numeric)
language plpgsql
security definer
set search_path to ops, public
as $$
declare
  v_status text;
begin
  select a.status into v_status
    from ops.royalties_apuracao a where a.id = p_apuracao_id;
  if v_status is null then
    raise exception 'Apuracao % nao existe', p_apuracao_id;
  end if;
  if v_status <> 'rascunho' then
    return;  -- mes fechado nao se reescreve
  end if;

  -- descontinuadas saem
  return query
  with alvo as (
    select o.id, o.nome, o.valor
      from ops.royalties_outras_receitas_itens o
      join ops.royalties_outras_receitas_politica p
        on ops.cac_nome_chave(o.nome) ~ p.padrao
     where o.apuracao_id = p_apuracao_id and p.modo = 'descontinuado'
  ), del as (
    delete from ops.royalties_outras_receitas_itens o
     using alvo where o.id = alvo.id
     returning alvo.nome, alvo.valor
  )
  select 'removida'::text, del.nome, del.valor, null::numeric from del;

  -- fixas assumem o valor e o nome do catalogo
  return query
  with upd as (
    update ops.royalties_outras_receitas_itens o
       set nome       = p.nome_canonico,
           valor      = p.valor,
           updated_at = now()
      from ops.royalties_outras_receitas_politica p
     where o.apuracao_id = p_apuracao_id
       and p.modo = 'fixo'
       and ops.cac_nome_chave(o.nome) ~ p.padrao
       and (o.nome is distinct from p.nome_canonico or o.valor is distinct from p.valor)
     returning p.nome_canonico as nome, p.valor as novo
  )
  select 'valor fixado'::text, upd.nome, null::numeric, upd.novo from upd;

  -- mensais nascem zeradas, para alguem digitar o valor do mes
  return query
  with upd as (
    update ops.royalties_outras_receitas_itens o
       set nome       = p.nome_canonico,
           valor      = 0,
           observacao = coalesce(p.observacao, o.observacao),
           updated_at = now()
      from ops.royalties_outras_receitas_politica p
     where o.apuracao_id = p_apuracao_id
       and p.modo = 'mensal'
       and ops.cac_nome_chave(o.nome) ~ p.padrao
       and o.valor is distinct from 0
     returning p.nome_canonico as nome, o.valor as antigo
  )
  select 'zerada para preencher'::text, upd.nome, upd.antigo, 0::numeric from upd;

  -- recalcula o cabecalho com a mesma formula de fecharApuracao
  update ops.royalties_apuracao a
     set outras_receitas = t.outras,
         total_fatura    = coalesce(a.csc_valor_fixo, 0)
                           + coalesce(a.royalties_valor, 0)
                           + coalesce(a.cac_valor, 0)
                           + t.outras
                           + coalesce(a.csc_trafego_pago, 0),
         updated_at      = now()
    from (
      select coalesce(sum(o.valor), 0) as outras
        from ops.royalties_outras_receitas_itens o
       where o.apuracao_id = p_apuracao_id
    ) t
   where a.id = p_apuracao_id;
end;
$$;

revoke all on function ops.royalties_aplicar_politica_outras(bigint) from public;
grant execute on function ops.royalties_aplicar_politica_outras(bigint) to authenticated, service_role;

commit;
