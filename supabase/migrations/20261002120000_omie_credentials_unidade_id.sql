-- Chave do Omie ligada à unidade pelo id, para a ficha da unidade (/unidades/$unidadeId) mostrar as chaves dela.
-- Pedido do Eliezek em 01/10/2026: "a página da unidade deveria conter tudo, dados cadastrais, chaves de acesso".
--
-- ops.omie_credentials casava com a unidade só pelo texto, e 4 das 11 linhas não batiam com ops.unidades em 01/10:
-- "Planning CWB 01" e "Planning CWB 02" são dois aplicativos de Curitiba (a unidade tem quatro CNPJs), "São Luís" leva
-- acento que o cadastro não leva, e "Planning Partners (Matriz)" é o Omie da holding, que não é unidade da rede
-- (project_unidade_goiania_vs_partners) e fica sem unidade_id de propósito.
--
-- Aditivo: a coluna `unidade` continua sendo o que as edge functions omie-* e base-clientes-sync leem. Uma unidade
-- pode ter mais de um aplicativo, por isso a coluna nova não é única.

alter table ops.omie_credentials
  add column if not exists unidade_id integer references ops.unidades (id);
comment on column ops.omie_credentials.unidade_id is
  'Unidade da rede dona deste aplicativo do Omie. Nulo no Omie da Partners (holding). Preenchido pelo nome quando vem vazio.';
create index if not exists omie_credentials_unidade_id_idx on ops.omie_credentials (unidade_id);

update ops.omie_credentials c
   set unidade_id = u.id
  from ops.unidades u
 where c.unidade_id is null
   and lower(btrim(u.nome_da_praca)) = lower(btrim(c.unidade));

update ops.omie_credentials c
   set unidade_id = u.id
  from (values ('Planning CWB 01', 'Curitiba'), ('Planning CWB 02', 'Curitiba'), ('São Luís', 'São Luis'))
       v(aplicativo, nome)
  join ops.unidades u on u.nome_da_praca = v.nome
 where c.unidade_id is null
   and c.unidade = v.aplicativo;

-- /admin/integracoes grava só o nome. Credencial nova com o nome exato da unidade já nasce ligada; as outras ficam
-- nulas e aparecem só lá, como a da Partners.
create or replace function ops.omie_credentials_preenche_unidade()
returns trigger
language plpgsql
set search_path = ops, public
as $$
begin
  if new.unidade_id is null then
    select u.id into new.unidade_id
      from ops.unidades u
     where lower(btrim(u.nome_da_praca)) = lower(btrim(new.unidade));
  end if;
  return new;
end $$;

drop trigger if exists omie_credentials_preenche_unidade on ops.omie_credentials;
create trigger omie_credentials_preenche_unidade
  before insert or update of unidade on ops.omie_credentials
  for each row execute function ops.omie_credentials_preenche_unidade();
