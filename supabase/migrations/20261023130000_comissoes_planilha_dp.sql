-- Comissões: planilha para o Departamento Pessoal no formato da "Comissão time comercial" de set/26 e
-- pagamento sempre no dia 20 (decisões do usuário em 23/10/2026; PRD wiki/prds/2026-10-comissoes-v1.md,
-- P-01 e P-13). O dia exato em feriado ou fim de semana é do fluxo do DP e do financeiro, não do sistema.

create or replace function comissoes.pagamento_em(_mes date) returns date
language sql stable security definer set search_path = comissoes, pg_temp as $$
  select _mes + ((comissoes.regras() ->> 'dia_pagamento')::int - 1)
$$;

-- O que fica para depois ganha o serviço, a base, o percentual e se o contrato já começou a pagar
-- (pendente) ou não (não iniciada), as colunas da planilha de comissões.
create or replace function comissoes.fica_para_depois(_pessoa bigint) returns jsonb
language sql stable security definer set search_path = comissoes, pg_temp as $$
  with p as (select nome from comissoes.pessoas where id = _pessoa),
  -- A pessoa de cada contrato e papel: a da 1ª metade, se já nasceu; senão o nome atual no Pipedrive.
  contratos as (
    select ct.id, ct.titulo, ct.unidade, ct.produto, ct.mrr_mensal, x.papel, comissoes.regra_do_contrato(ct.id) as regra
      from ops.contratos ct
     cross join lateral (values ('closer', ct.closer), ('sdr', ct.sdr)) as x(papel, nome)
     where ct.origem_pipeline = 'inside_sales' and ct.ganho_em >= (comissoes.regras() ->> 'corte_regra_nova')::date
       and coalesce(ct.mrr_mensal, 0) > 0
       and coalesce((select l.pessoa_id from comissoes.linhas l
                       where l.contrato_id = ct.id and l.papel = x.papel and l.tipo = 'comissao' order by l.id limit 1),
                     (select pp.id from comissoes.pessoas pp, p where pp.nome = x.nome and pp.nome = p.nome)) = _pessoa
  ),
  faltam as (
    select c.*, m.metade,
           exists (select 1 from comissoes.linhas l where l.contrato_id = c.id and l.papel = c.papel and l.metade = 1
                    and l.tipo = 'comissao') as tem_primeira,
           exists (select 1 from comissoes.linhas l where l.contrato_id = c.id and l.papel = c.papel
                    and l.tipo = 'comissao') as iniciado
      from contratos c cross join (values (1::smallint), (2::smallint)) m(metade)
     where not exists (select 1 from comissoes.linhas l where l.contrato_id = c.id and l.papel = c.papel
                        and l.metade = m.metade and l.tipo = 'comissao')
  ),
  -- Metade que já nasceu num mês ainda em revisão, depois do próximo pagamento: aparece sem valor (R-11).
  em_revisao as (
    select l.contrato_id, l.cliente, l.unidade, l.papel, l.metade, m.mes
      from comissoes.linhas l join comissoes.meses m on m.mes = l.mes
     where l.pessoa_id = _pessoa and l.tipo = 'comissao' and m.situacao = 'previa' and not comissoes.excluida(l.id)
       and m.mes > (select min(x.mes) from comissoes.meses x where x.situacao in ('previa', 'liberado'))
  )
  select coalesce(jsonb_agg(item order by item ->> 'cliente', item ->> 'metade'), '[]'::jsonb) from (
    select jsonb_build_object(
             'contrato_id', f.id, 'cliente', f.titulo, 'unidade', f.unidade, 'servico', f.produto, 'papel', f.papel,
             'metade', f.metade, 'base', f.mrr_mensal, 'iniciado', f.iniciado,
             'percentual', comissoes.percentual_proposto(_pessoa, f.papel),
             'valor_estimado', round(f.mrr_mensal * comissoes.percentual_proposto(_pessoa, f.papel) / 200, 2),
             'motivo', case
               when f.regra = 'sem_cac' then 'Aguardando o cliente pagar o 1º honorário (unidade sem CAC)'
               when f.regra = 'sem_adiantamento' and f.metade = 1 then 'Aguardando a data de assinatura'
               when f.metade = 2 and (f.tem_primeira or f.regra = 'sem_adiantamento') then 'Aguardando o cliente pagar o 1º honorário'
               else 'Aguardando o CAC entrar na apuração da unidade' end) as item
      from faltam f
    union all
    select jsonb_build_object(
             'contrato_id', r.contrato_id, 'cliente', r.cliente, 'unidade', r.unidade, 'servico', null, 'papel', r.papel,
             'metade', r.metade, 'base', null, 'iniciado', true, 'percentual', null,
             'valor_estimado', null,
             'motivo', 'Em revisão para o pagamento de ' || to_char(comissoes.pagamento_em(r.mes), 'DD/MM/YYYY'))
      from em_revisao r
  ) x
$$;


-- Exportação do mês para o DP (só o financeiro): as linhas do pagamento, com o serviço do contrato, e o
-- que fica para depois de cada pessoa do time.
create or replace function comissoes.exportar_mes(_ator uuid, _mes date) returns jsonb
language plpgsql stable security definer set search_path = comissoes, pg_temp as $$
begin
  perform comissoes.exigir(comissoes.e_financeiro(_ator), 'só o financeiro');
  return comissoes.mes_json(_mes) || jsonb_build_object(
    'total', comissoes.total_do_mes(_mes),
    'linhas', coalesce((select jsonb_agg(comissoes.linha_json(l) || jsonb_build_object(
                          'servico', (select ct.produto from ops.contratos ct where ct.id = l.contrato_id))
                          order by p.nome, l.cliente, l.metade, l.id)
                          from comissoes.linhas l join comissoes.pessoas p on p.id = l.pessoa_id
                         where l.mes = _mes), '[]'::jsonb),
    'pendentes', coalesce((select jsonb_agg(item || jsonb_build_object('pessoa', p.nome) order by p.nome)
                             from comissoes.pessoas p
                             cross join lateral jsonb_array_elements(comissoes.fica_para_depois(p.id)) item), '[]'::jsonb));
end $$;

revoke execute on function comissoes.pagamento_em(date), comissoes.fica_para_depois(bigint),
  comissoes.exportar_mes(uuid, date) from public, anon, authenticated, service_role;
