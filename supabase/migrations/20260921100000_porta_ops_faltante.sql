-- Porta do Ops para quem já tem papel ou área, mas nunca ganhou a linha.
--
-- `public.produto_acesso` é quem `public.tem_produto('ops')` lê, e as policies
-- de 20260917100000 barram por ela. Só o convite da página de Equipe escrevia
-- esta tabela: quem foi criado por /admin/usuarios ficou com papel certinho e
-- sem porta. Em 21/09/2026 eram três (raul.dantas, heloisa.araujo,
-- brenda.patury), invisíveis porque só parte das tabelas exige a porta hoje.
--
-- O caminho de criação foi corrigido em adminCreateUser no mesmo commit; isto
-- aqui é o acerto do que já estava gravado. Idempotente: roda de novo sem
-- efeito.
insert into public.produto_acesso (user_id, produto)
select distinct q.user_id, 'ops'
from (
  select user_id from ops.user_roles
  union
  select user_id from ops.usuario_areas where allowed
  union
  select user_id from ops.area_admins
) q
join public.profiles p on p.user_id = q.user_id
on conflict (user_id, produto) do nothing;
