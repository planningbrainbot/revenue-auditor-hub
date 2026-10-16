-- Unidades próprias de Goiânia no cadastro (16/10/2026, decisão do usuário).
-- Não pagam royalties; cada uma paga mídia, CAC ou os dois, para não perder o controle.
--   PAC - Goiânia            = unidade 9 "Goiânia" (Pipedrive 694, grava "Matriz"): só CAC desde set/26
--   Marox - Construção Civil = unidade 10 "Construção Civil" (Pipedrive 700): só mídia, R$ 20 mil/mês
--   PNE - BPO Financeiro     = unidade nova (Pipedrive 1124): mídia e CAC
-- nome_da_praca das duas existentes não muda: é a chave que casa contrato e unidade.

update ops.unidades
   set paga_cac = true,
       cac_desde = '2026-09-01',
       midia_mensal = null,
       royalties_percentual = 0,
       observacoes_financeiras = concat_ws(E'\n', observacoes_financeiras,
         '[16/10/2026] Unidade própria "PAC - Goiânia". Sem royalties. Paga CAC desde set/26 (decisão de 25/09), sem mídia. No Pipedrive grava "Matriz" (opção 694); o funil de CAC trata "Matriz" como Goiânia.'),
       updated_at = now()
 where id = 9;

update ops.unidades
   set paga_cac = false,
       cac_desde = null,
       midia_mensal = 20000,
       royalties_percentual = 0,
       observacoes_financeiras = concat_ws(E'\n', observacoes_financeiras,
         '[16/10/2026] Unidade própria "Marox - Construção Civil". Sem royalties e sem CAC. Paga mídia de R$ 20.000/mês. Falta definir o CNPJ cobrado: Planning Marox Consultoria (30.459.798/0001-03) ou Marox Serviços (55.950.467/0001-94).'),
       updated_at = now()
 where id = 10;

insert into ops.unidades (nome_da_praca, tipo, pipedrive_opcao_id, royalties_percentual,
                          paga_cac, cac_desde, midia_mensal, razao_social, observacoes_financeiras)
select 'BPO Financeiro', 'interna', 1124, 0, true, '2026-09-01', null,
       'Planning Negócios Estruturados',
       '[16/10/2026] Unidade própria "PNE - BPO Financeiro". Sem royalties. Paga mídia e CAC. Falta o valor mensal da mídia, o CNPJ da Planning Negócios Estruturados e confirmar o início do CAC (assumido set/26, igual ao PAC).'
 where not exists (select 1 from ops.unidades where pipedrive_opcao_id = 1124);

-- Contratos da opção 1124 gravados como id cru (DATA-RULES 6c). O sync passa a gravar o nome
-- pelo cadastro; aqui só adianta o que ele faria.
update ops.contratos set unidade = 'BPO Financeiro' where unidade = '1124';

-- Pipedrive grava "Matriz" e o Pipefy "Goiânia / Matriz" para a unidade 9.
create or replace function ops.cac_unidade_chave(t text)
 returns text
 language sql
 immutable
as $function$
  select case k when 'matriz' then 'goiania' when 'goiania matriz' then 'goiania' else k end
    from (select replace(ops.cac_nome_chave(t), ' do campo', '') as k) s
$function$;

-- Confirmado pelo usuário no mesmo dia: mídia do BPO R$ 10.000/mês, CAC desde set/26.
update ops.unidades set midia_mensal = 10000, updated_at = now() where pipedrive_opcao_id = 1124;
