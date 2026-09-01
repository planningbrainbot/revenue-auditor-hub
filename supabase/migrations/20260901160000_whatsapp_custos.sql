-- Extrato de custo dos disparos de WhatsApp (Meta Cloud API).
--
-- Fonte de verdade: `pricing_analytics` da Graph API do WABA
-- (GET /{waba_id}?fields=pricing_analytics...). É o mesmo número que a Meta
-- usa pra faturar — cobra por CONVERSA (janela de 24h), não por mensagem.
-- Uma conversa pode conter N mensagens e custa uma vez só, então "volume"
-- aqui NÃO é quantidade de mensagens enviadas: é quantidade de conversas
-- cobradas. Pra volume de disparo use nps_pesquisas/nps_envio_map.
--
-- Granularidade: 1 linha por (dia, número remetente, categoria, tipo).
-- Full-refresh por janela de datas no sync — a Meta reprocessa números
-- retroativamente por alguns dias, então reescrever a janela é mais seguro
-- que insert incremental.

create table if not exists public.whatsapp_custos (
  id            bigserial primary key,
  dia           date         not null,
  waba_id       text         not null,
  waba_nome     text,
  phone_number  text         not null,
  -- MARKETING | UTILITY | AUTHENTICATION | SERVICE ...
  categoria     text         not null,
  -- REGULAR | FREE_CUSTOMER_SERVICE | FREE_ENTRY_POINT ...
  tipo          text         not null,
  -- conversas cobradas na janela (NÃO é nº de mensagens)
  volume        integer      not null default 0,
  -- custo na moeda da conta da Meta (BRL para este WABA)
  custo         numeric(12,4) not null default 0,
  moeda         text         not null default 'BRL',
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  constraint whatsapp_custos_unico unique (dia, waba_id, phone_number, categoria, tipo)
);

create index if not exists whatsapp_custos_dia_idx on public.whatsapp_custos (dia desc);
create index if not exists whatsapp_custos_phone_idx on public.whatsapp_custos (phone_number);

alter table public.whatsapp_custos enable row level security;

-- Leitura segue a permissão da própria página, não has_role hardcoded:
-- liberar a página em /admin/permissoes precisa liberar o dado junto.
drop policy if exists "whatsapp_custos_select" on public.whatsapp_custos;
create policy "whatsapp_custos_select" on public.whatsapp_custos
  for select to authenticated using ((select public.can('view.disparos_whatsapp')));

-- Escrita é exclusiva do sync (service_role, que ignora RLS). Sem policy de
-- insert/update/delete de propósito: ninguém edita extrato de fatura na mão.

comment on table public.whatsapp_custos is
  'Custo de conversas do WhatsApp Cloud API por dia/numero/categoria. Fonte: Graph API pricing_analytics do WABA. Sync: Edge Function whatsapp-custos-sync.';
comment on column public.whatsapp_custos.volume is
  'Conversas cobradas (janela 24h), NAO numero de mensagens enviadas.';
