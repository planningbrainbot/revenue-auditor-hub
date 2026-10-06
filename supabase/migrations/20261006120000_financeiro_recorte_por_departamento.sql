-- ─────────────────────────────────────────────────────────────────────────────
-- RECORTE POR DEPARTAMENTO NO ACESSO AO FINANCEIRO (06/10/2026)
--
-- A Ana (controladoria), no WhatsApp do Pedro, 06/10 08:54: "Tem algum problema
-- do acesso que não consigo dar acesso só o BPO sem dar a finance e a negocio
-- estruturados". O log mostra as tentativas dela das 08:51 às 08:53: o Filipe
-- ficou "só BPO" e voltava com os três; o Eliezek recebia "EXPANSÃO + Finance"
-- e voltava com o BPO inteiro.
--
-- CAUSA: "Negócios Estruturados" e "Finance" são unidades de
-- `unidades_navegacao.tipo = 'departamento'` DENTRO das empresas do BPO. O
-- acesso era gravado por EMPRESA (`ops.usuario_empresas`) e toda unidade que
-- tocasse uma empresa da pessoa contava como concedida. Dar o BPO dava os dois
-- recortes; dar só o Finance gravava as empresas do BPO e abria o BPO inteiro.
--
-- AGORA: recorte é concessão explícita, nesta tabela, e nunca sai da empresa.
-- `acessos-financeiro.functions.ts` grava e lista; `sessoes-irmas.functions.ts`
-- põe no token do Financeiro.
--
-- MIGRAÇÃO DE QUEM JÁ TEM ACESSO: o recorte entra para quem o tinha marcado na
-- última concessão registrada em `ops.acessos_log` (é o que a pessoa que
-- concedeu escolheu na tela). Quem vê "todas as empresas" não muda (a flag
-- cobre tudo). Quem tem empresa do BPO e nenhum registro de concessão mantém os
-- dois recortes, para ninguém perder acesso sem ter sido decidido.
--
-- REVERSÃO: drop table ops.usuario_recortes_financeiro; e voltar os dois
-- arquivos citados. Sem a tabela, a derivação antiga (por empresa) volta.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ops.usuario_recortes_financeiro (
  user_id       uuid not null references auth.users(id) on delete cascade,
  unidade_id    text not null,
  concedido_em  timestamptz not null default now(),
  concedido_por uuid,
  primary key (user_id, unidade_id)
);

comment on table ops.usuario_recortes_financeiro is
  'Recortes por departamento do Brain Financeiro (unidades_navegacao.tipo = ''departamento'': '
  'negocios-estruturados, finance) concedidos à pessoa. Não se derivam de ops.usuario_empresas: '
  'dar o BPO não dá os recortes, e dar um recorte não dá o BPO.';

alter table ops.usuario_recortes_financeiro enable row level security;
revoke all on ops.usuario_recortes_financeiro from anon;

drop policy if exists usuario_recortes_financeiro_select on ops.usuario_recortes_financeiro;
create policy usuario_recortes_financeiro_select on ops.usuario_recortes_financeiro
  for select to authenticated
  using (user_id = auth.uid() or ops.can('admin.acessos.financeiro'));
-- Escrita só pelo servidor (service role), como em usuario_empresas desde 25/09.

-- ── migração de quem já tem acesso ──────────────────────────────────────────
with recortes(unidade_id) as (values ('negocios-estruturados'), ('finance')),
pessoas as (
  select a.user_id
    from public.produto_acesso a
    left join ops.usuario_escopo e on e.user_id = a.user_id
   where a.produto = 'financeiro' and not coalesce(e.todas_empresas, false)
),
ultimo as (
  select distinct on (alvo) alvo, detalhe->'unidades' as unidades
    from ops.acessos_log
   where acao = 'financeiro_conceder' and alvo is not null
   order by alvo, criado_em desc
)
insert into ops.usuario_recortes_financeiro (user_id, unidade_id, concedido_por)
select p.user_id, r.unidade_id, null
  from pessoas p
 cross join recortes r
  left join ultimo u on u.alvo = p.user_id
 where case
         when u.alvo is not null then u.unidades ? r.unidade_id
         -- sem registro: mantém o que a derivação antiga dava (BPO ⇒ os dois recortes)
         else exists (select 1 from ops.usuario_empresas ue
                       where ue.user_id = p.user_id
                         and ue.empresa_id in ('acf8fb38-16b6-4c38-b862-5359edafdd48',  -- BPO Contábil
                                               'bcfbb86c-a941-4e79-bf87-1d35824a3098',  -- GESTÃO
                                               '8cdf5de7-683f-4d8e-a194-f303677ac6ea',  -- PAC
                                               '70b317a6-4779-4634-a6b9-fe2daa6e5e57')) -- PCC
       end
on conflict (user_id, unidade_id) do nothing;

do $gate$
declare v int;
begin
  select count(*) into v from ops.usuario_recortes_financeiro;
  raise notice 'recortes concedidos na migração: %', v;
end $gate$;
