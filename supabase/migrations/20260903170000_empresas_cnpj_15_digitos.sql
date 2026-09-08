-- ============================================================================
-- 20260903170000_empresas_cnpj_15_digitos.sql
--
-- 35 linhas de `empresas` gravadas em 27/08/2026 têm CNPJ com **15 dígitos**:
-- um CNPJ válido com um '0' grudado à direita. Assinatura de cast de float em
-- planilha (o mesmo defeito que come zero à esquerda, do outro lado).
--
-- EVIDÊNCIA de que o corte é o valor certo, não um chute:
--   · as 35 seguem o MESMO padrão — exatamente 15 dígitos e último dígito '0';
--   · em 35 de 35, `left(dig, 14)` passa na validação de dígito verificador do
--     CNPJ; `right(dig, 14)` não passa em nenhuma (0 de 35);
--   · vêm de duas fontes do mesmo lote (`basenps_reconciliacao`, `pipedrive_sync`),
--     ids 25157–25197, todas criadas no mesmo dia.
--
-- POR QUE CORRIGIR NA ORIGEM: `v_clientes_diretorio` já normaliza para não
-- duplicar 11 empresas na tela, mas `contratos`, `contas_receber`,
-- `contrato_omie_grupos` e a apuração de royalties casam por CNPJ cru — lá o
-- registro continua não batendo com o Omie, em silêncio.
--
-- NÃO CORRIGIDO DE PROPÓSITO: `empresas.id = 25195` (SÃO MIGUEL AR CONDICIONADO
-- LTDA), com 13 dígitos: '3024480001600'. A reconstrução exigiria empilhar duas
-- hipóteses (dois zeros à esquerda E o zero à direita), e embora
-- '00302448000160' passe no DV, isso é fraco demais para reescrever o cadastro
-- de um cliente. Fica para revisão humana.
--
-- REVERSÍVEL: `empresas_backup_20260903_cnpj15` guarda id + cnpj anterior. Para
-- desfazer:
--   update public.empresas e set cnpj = b.cnpj_anterior
--     from public.empresas_backup_20260903_cnpj15 b where b.id = e.id;
--
-- Não há unique constraint nem índice único em `empresas.cnpj` (conferido em
-- pg_constraint e pg_indexes), então o corte não viola nada — mas ele faz uma
-- linha passar a repetir o CNPJ de outra já existente em `empresas`. É duplicata
-- lógica, do mesmo tipo que a limpeza de 03/07/2026 tratou, e a view conta
-- documentos distintos justamente por isso.
-- ============================================================================

create table if not exists public.empresas_backup_20260903_cnpj15 (
  id            integer primary key,
  cnpj_anterior text        not null,
  cnpj_novo     text        not null,
  salvo_em      timestamptz not null default now()
);

comment on table public.empresas_backup_20260903_cnpj15 is
  'Backup do corte de CNPJ de 15 dígitos (migration 20260903170000). Mantida para rollback.';

insert into public.empresas_backup_20260903_cnpj15 (id, cnpj_anterior, cnpj_novo)
select e.id,
       e.cnpj,
       left(regexp_replace(e.cnpj, '\D', '', 'g'), 14)
from public.empresas e
where length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 15
  and right(regexp_replace(e.cnpj, '\D', '', 'g'), 1) = '0'
on conflict (id) do nothing;

update public.empresas e
   set cnpj = left(regexp_replace(e.cnpj, '\D', '', 'g'), 14)
 where length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 15
   and right(regexp_replace(e.cnpj, '\D', '', 'g'), 1) = '0';

-- Conferência: deve devolver 0 linhas com 15 dígitos e 35 no backup.
--   select count(*) from public.empresas
--    where length(regexp_replace(coalesce(cnpj,''),'\D','','g')) = 15;
--   select count(*) from public.empresas_backup_20260903_cnpj15;
