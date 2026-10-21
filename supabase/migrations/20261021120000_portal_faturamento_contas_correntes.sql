-- Portal de Faturamento · conta corrente padrão de cada empresa (Ana, 21/10/2026).
--
-- Pendência 1 da E1 (e1/pendencias-ana-tesouraria.md): nenhuma empresa tinha conta corrente padrão, e sem ela a OS em
-- modo gravar para com erro. Resposta literal da Ana (controladoria), em 21/10/2026, empresa – banco:
--   PMC – Itaú · MAROX – Itaú · PAC (Matriz) – Caixa · PAC SP – Itaú · PRJ – Itaú · DOC – Itaú · PARTNERS – Itaú ·
--   PIS – Itaú · PAT – Itaú · PGE – Itaú · PCC – Itaú · BPO – Itaú · PNE – Itaú · NEO – OMIE.CASH · ASCENDIA – Itaú ·
--   CONCILIADOR – Itaú · FINANCE – OMIE.CASH. (PMN, PAI e PNC ficam fora: inativas no portal.)
--
-- O código (nCodCC) de cada uma saiu de geral/contacorrente ListarContasCorrentes do Omie da própria empresa, lido em
-- 21/10/2026 (só leitura). Regra de escolha: conta do tipo CC (conta corrente), não inativa, não bloqueada, do banco
-- que a Ana disse (Itaú = 341, Caixa = 104; OMIE.CASH = banco 450 com descrição "Omie.CASH"). Ficou de fora:
--   - aplicação (tipo CA) do mesmo banco: "Aplicação - Caixa Econômica Federal" na PAC;
--   - Omie.CASH bloqueada (recebíveis de cartão) na NEO; Omie.CASH inativa ou "encerrada".
-- Com mais de uma candidata, nada é gravado e o Pedro decide:
--   - PARTNERS – Itaú: 1868198302 "Itaú - Partners" e 2255763526 "Itaú - CS", as duas CC ativas do 341 na ag. 9338.
--     Fica nula até ele escolher.
--
-- Cada empresa alterada gera o evento de configuração (entidade emissora, evento configurado), como
-- ops.fat_emissora_config faz, com diff da coluna, a procedência e a conta lida no Omie. Autor nulo = sistema.
-- Idempotente: empresa que já tem o mesmo código não muda nem gera evento.
-- Ensaio (begin … rollback): supabase/gates/20261021_portal_faturamento_respostas_ana.sql
-- Rollback: supabase/rollback/20261021120000_portal_faturamento_contas_correntes_rollback.sql

begin;

do $contas$
declare
  _r record;
  g organizacao.empresas_grupo;
  n organizacao.empresas_grupo;
begin
  for _r in
    select v.* from (values
      ('PMC',         '30459798000103', 11505716373::bigint, 'Itaú',      '341', 'Itaú - MAROX'),
      ('MAROX',       '55950467000194',  2406503925::bigint, 'Itaú',      '341', 'Itaú -MAROX SERV'),
      ('PAC',         '24296850000147',  9575010825::bigint, 'Caixa',     '104', 'Caixa Econômica Federal'),
      ('PAC SP',      '59639455000102', 11336517902::bigint, 'Itaú',      '341', 'Itaú- PSP'),
      ('PRJ',         '55909495000168',  6964018974::bigint, 'Itaú',      '341', 'Itaú - RJ'),
      ('DOC',         '49726267000150',  7037113322::bigint, 'Itaú',      '341', 'Itaú - DOC'),
      ('PIS',         '40417435000150',  1808802208::bigint, 'Itaú',      '341', 'Itaú - PIS'),
      ('PAT',         '40949469000196',  6718045126::bigint, 'Itaú',      '341', 'Itaú - PAT'),
      ('PGE',         '23632609000189',  7400610229::bigint, 'Itaú',      '341', 'Itaú - PGE'),
      ('PCC',         '23527887000176',  2769990301::bigint, 'Itaú',      '341', 'Itaú - PCC'),
      ('BPO',         '44275738000137',  1808796467::bigint, 'Itaú',      '341', 'Itaú - BPO'),
      ('PNE',         '68387855000150',  6039556786::bigint, 'Itaú',      '341', 'Itaú Unibanco'),
      ('NEO',         '66532907000100',  2114130305::bigint, 'OMIE.CASH', '450', 'Omie.CASH'),
      ('ASCENDIA',    '68061952000159',  5520442101::bigint, 'Itaú',      '341', 'Itaú Unibanco'),
      ('CONCILIADOR', '63279474000134',  4122845330::bigint, 'Itaú',      '341', 'Itaú Unibanco'),
      ('FINANCE',     '68616679000181',  4617488632::bigint, 'OMIE.CASH', '450', 'Omie.CASH')
    ) as v(apelido, cnpj, conta, banco, codigo_banco, descricao)
  loop
    select * into g from organizacao.empresas_grupo e where e.apelido = _r.apelido and e.cnpj = _r.cnpj for update;
    if not found then
      raise exception 'Empresa % (CNPJ %) não está em organizacao.empresas_grupo.', _r.apelido, _r.cnpj;
    end if;
    if not g.ativa then
      raise exception 'A % está inativa no portal: a conta corrente dela não entra.', _r.apelido;
    end if;
    continue when g.conta_corrente_padrao is not distinct from _r.conta;

    update organizacao.empresas_grupo set conta_corrente_padrao = _r.conta where id = g.id returning * into n;
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('emissora', n.id, n.id, 'configurado', g.modo_omie, n.modo_omie,
            receita.fat_diff(to_jsonb(g), to_jsonb(n), array['conta_corrente_padrao'])
              || jsonb_build_object(
                   'procedencia', 'Ana (controladoria), 21/10/2026: conta corrente padrão por empresa',
                   'conta_omie', jsonb_build_object('banco', _r.banco, 'codigo_banco', _r.codigo_banco,
                                                    'descricao', _r.descricao)),
            null);
  end loop;
end $contas$;

comment on column organizacao.empresas_grupo.conta_corrente_padrao is
  'Código da conta corrente no Omie desta emissora (nCodCC) usada quando o serviço não define outra. Preenchida em '
  '21/10/2026 com a resposta da Ana (controladoria): o banco de cada empresa, e o código lido de ListarContasCorrentes '
  'do Omie dela (migration 20261021120000). Nula: PARTNERS (duas contas Itaú, a escolher pelo Pedro) e as inativas.';

commit;
