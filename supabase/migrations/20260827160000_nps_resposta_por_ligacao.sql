-- Suporte a "responder pela pesquisa por telefone": o time de CS liga pra
-- quem recebeu o WhatsApp e não respondeu, registra a resposta manualmente
-- (mesma estrutura de nota/avaliação da pesquisa) e opcionalmente anexa a
-- gravação da ligação.
--
-- Aplicado em produção via Management API + Storage API em 27/08/2026.

alter table public.nps_pesquisas add column if not exists canal_resposta text default 'whatsapp';
alter table public.nps_pesquisas add column if not exists gravacao_url text;

-- Bucket "nps-gravacoes" (privado, limite 50MB/arquivo) criado via Storage
-- API (não SQL) — sem representação nesta migration.

create policy "nps_gravacoes upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'nps-gravacoes' and can('view.disparos_whatsapp'));

create policy "nps_gravacoes leitura" on storage.objects
  for select to authenticated
  using (bucket_id = 'nps-gravacoes' and can('view.disparos_whatsapp'));
