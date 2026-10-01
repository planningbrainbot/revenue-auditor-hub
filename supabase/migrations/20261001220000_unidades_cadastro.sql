-- Cadastro de unidade pela tela Regras da Rede (/unidades). Pedido do Eliezek em 01/10/2026: "não tem um lugar para
-- cadastrar uma nova unidade no sistema do ops". São Bernardo, Recife e Sorocaba (16/09) e São Paulo (21/09) entraram
-- por SQL direto, e cada uma deixou uma lacuna que só apareceu depois (Sorocaba sem pipefy_id: 311 clientes invisíveis;
-- São Bernardo fora do mapa do Pipedrive: 13 contratos gravados com unidade = "1055").
--
-- O que esta migration faz:
--   a. ops.unidades.pipedrive_opcao_id: o id da opção do campo "Unidade de Negócio" do Pipedrive. Os dois syncs
--      (pipedrive-contratos-sync e monetizacao-crm) passam a cair nela quando o id não está no mapa fixo deles, e
--      unidade nova deixa de pedir mudança de código. O mapa fixo continua mandando nos ids que já conhece: 694 grava
--      "Matriz" de propósito (DECISIONS 18/09, a normalização é quem traduz para Goiânia).
--   b. Nome único (sem diferença de caixa e espaço) e tipo restrito a regional | interna: é por nome que o resto do
--      banco reconcilia unidade (norm_unidade, base_unidade), e duas linhas com o mesmo nome partiriam a carteira.
--   c. manage.unidades_rede: a chave que libera criar e editar. Fica na área admin, não na receita onde a tela mora:
--      a receita é dada a head, auditor, socio e cs, e "quem tem a área tem todas as ações dela" entregaria a eles o
--      percentual de royalties de cada unidade.
--   d. RLS de INSERT e UPDATE em ops.unidades por essa chave. Não existia policy de escrita nenhuma. DELETE fica sem
--      policy de propósito: unidade é referenciada por texto em contratos, empresas e apurações, e apagar a linha
--      deixaria tudo isso órfão sem erro.

-- a. De-para com o Pipedrive ------------------------------------------------------------------------------------------
alter table ops.unidades add column if not exists pipedrive_opcao_id integer;
comment on column ops.unidades.pipedrive_opcao_id is
  'Id da opção do campo "Unidade de Negócio" (5684f154…) no Pipedrive. Lido pelos syncs quando o id não está no mapa fixo deles.';
create unique index if not exists unidades_pipedrive_opcao_id_key
  on ops.unidades (pipedrive_opcao_id) where pipedrive_opcao_id is not null;

-- Os mesmos ids do mapa fixo de pipedrive-contratos-sync (UNIDADE_LABELS). Agronegócio (701), ROIT (720), Itaúna (857)
-- e BPO Financeiro GYN (1124) não estão em ops.unidades e ficam de fora.
update ops.unidades u
   set pipedrive_opcao_id = v.opcao
  from (values
    ('Goiânia', 694), ('Rio de Janeiro', 695), ('Patos de Minas', 696), ('Belém', 697), ('Curitiba', 698),
    ('Consultoria', 699), ('Construção Civil', 700), ('São Paulo', 719), ('Fortaleza', 929), ('Campo Novo', 930),
    ('São Luis', 931), ('Maceió', 984), ('Recife', 1054), ('São Bernardo', 1055), ('Sorocaba', 1056)
  ) v(nome, opcao)
 where u.nome_da_praca = v.nome
   and u.pipedrive_opcao_id is null;

-- b. Nome único e tipo fechado ----------------------------------------------------------------------------------------
create unique index if not exists unidades_nome_da_praca_key
  on ops.unidades (lower(btrim(nome_da_praca)));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unidades_tipo_check'
                   and conrelid = 'ops.unidades'::regclass) then
    alter table ops.unidades
      add constraint unidades_tipo_check check (tipo in ('regional', 'interna'));
  end if;
end $$;

-- c. A chave ---------------------------------------------------------------------------------------------------------
insert into ops.area_chaves (area, permission_key) values ('admin', 'manage.unidades_rede')
on conflict do nothing;

-- d. Escrita ---------------------------------------------------------------------------------------------------------
-- Uma policy por comando: `for all` concederia SELECT junto (feedback_rls_for_all_concede_select).
drop policy if exists unidades_insert_cadastro on ops.unidades;
create policy unidades_insert_cadastro on ops.unidades
  for insert to authenticated
  with check (tem_produto('ops') and (select ops.can('manage.unidades_rede')));

drop policy if exists unidades_update_cadastro on ops.unidades;
create policy unidades_update_cadastro on ops.unidades
  for update to authenticated
  using (tem_produto('ops') and (select ops.can('manage.unidades_rede')))
  with check (tem_produto('ops') and (select ops.can('manage.unidades_rede')));

-- O INSERT ... RETURNING da tela exige leitura da linha nova (feedback_supabase_insert_returning_rls). Quem tem a chave
-- já lê pelas policies de hoje (admin em role_based_read), mas a chave pode ser dada a outra pessoa em
-- /admin/usuarios, e ela precisa ler o que acabou de gravar.
drop policy if exists unidades_select_cadastro on ops.unidades;
create policy unidades_select_cadastro on ops.unidades
  for select to authenticated
  using (tem_produto('ops') and (select ops.can('manage.unidades_rede')));
