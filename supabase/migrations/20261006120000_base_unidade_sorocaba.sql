-- Sorocaba fora da Base de clientes (relato do Matheus em 05/10/2026: "Não tem sorocaba ainda").
--
-- Três lacunas, todas da criação das unidades novas por SQL em 16/09 e do backfill de 22/09:
-- 1. 286 das 312 empresas de Sorocaba, e 162 de Goiânia, ficaram com `unidade_id` nulo. A leitura do Pipefy de 21–22/09
--    gravou o vínculo como "unknown" porque `ops.unidades.pipefy_id` ainda estava vazio; o backfill de 22/09 trocou o id
--    pelo nome em `empresas.unidade`, mas não preencheu `unidade_id`, e o sync só refaz o vínculo quando o registro muda
--    no Pipefy. Na Base essas contas aparecem como "Unidade a confirmar" e saem do escopo da unidade.
-- 2. Sorocaba não tem linha em `ops.monetizacao_unidades`, que é a lista do filtro de unidade da Base e da cobertura.
-- 3. São Bernardo está lá com `unidade_id` nulo e só casa as contas pelo nome.
--
-- A trava: unidade regional nova ganha a linha em `monetizacao_unidades` ao ser cadastrada. A chave segue a convenção
-- das demais (DECISIONS 22/09, Recife): os 16 primeiros caracteres hexadecimais do sha256 do nome.
--
-- Depois desta migration, rode o recálculo das contas afetadas (DECISIONS 06/10): `ops.base_refresh_cadastro` por
-- empresa, `ops.base_carteira_refresh` por lote de chaves e `ops.monetizacao_cobertura_refresh()`.
--
-- Reversão: as linhas tocadas estão no backup `unidade-sorocaba-backup-20261006.json` do scratchpad da sessão;
-- `delete from ops.monetizacao_unidades where key = 'e9d9999ccc6b6699'`,
-- `update ops.monetizacao_unidades set unidade_id = null where key = '578dcbc830975a88'` e
-- `drop trigger unidade_regional_na_base on ops.unidades`.

-- Ingestão corrigida, não discordância do Pipefy: o connector sempre apontou para a unidade certa (mesma porta do
-- backfill de 22/09).
set local planning.pipefy_ingest = 'on';

with alvo as (
  select s.empresa_id, u.id as unidade_id
    from ops.base_sync_registros s
    join ops.empresas e on e.id = s.empresa_id
    join ops.unidades u on u.pipefy_id = s.vinculos -> 'unidade_raw' ->> 0
   where s.fonte = 'pipefy_empresa'
     and e.unidade_id is null
     and jsonb_array_length(coalesce(s.vinculos -> 'unidade_raw', '[]')) = 1
     and e.unidade = u.nome_da_praca
), empresas as (
  update ops.empresas e
     set unidade_id = a.unidade_id
    from alvo a
   where e.id = a.empresa_id
  returning e.id
)
update ops.base_sync_registros s
   set vinculos = s.vinculos || jsonb_build_object('unidade_id', a.unidade_id, 'unidade_status', 'resolved')
  from alvo a
 where s.fonte = 'pipefy_empresa'
   and s.empresa_id = a.empresa_id;

insert into ops.monetizacao_unidades (key, unidade_id, nome, classification)
values ('e9d9999ccc6b6699', 14, 'Sorocaba', 'unidade')
on conflict (key) do update set unidade_id = excluded.unidade_id;

update ops.monetizacao_unidades
   set unidade_id = 12
 where key = '578dcbc830975a88'
   and unidade_id is null;

create or replace function ops.unidade_regional_na_base()
returns trigger
language plpgsql security definer set search_path = ops, public, extensions as $$
begin
  if new.tipo = 'regional' and nullif(trim(new.nome_da_praca), '') is not null then
    insert into ops.monetizacao_unidades (key, unidade_id, nome, classification)
    values (left(encode(sha256(convert_to(new.nome_da_praca, 'UTF8')), 'hex'), 16), new.id, new.nome_da_praca, 'unidade')
    on conflict (key) do update
      set unidade_id = coalesce(ops.monetizacao_unidades.unidade_id, excluded.unidade_id);
  end if;
  return null;
end $$;
revoke all on function ops.unidade_regional_na_base() from public, anon, authenticated;

drop trigger if exists unidade_regional_na_base on ops.unidades;
create trigger unidade_regional_na_base after insert on ops.unidades
  for each row execute function ops.unidade_regional_na_base();
