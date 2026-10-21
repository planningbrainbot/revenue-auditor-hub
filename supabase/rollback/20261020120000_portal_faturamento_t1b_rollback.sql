-- Rollback da 20261020120000_portal_faturamento_t1b.sql (Portal de Faturamento, T1b, 20/10/2026).
--
-- Tira as RPCs (ops.fat_*, integracoes.* do conector), as funções internas, o tipo de escopo, a guarda da situação,
-- as colunas e tabelas novas, e devolve os checks da T1a. Dado das tabelas novas (departamentos, estado do Omie,
-- consulta à Receita) e das colunas novas se perde. receita.fat_eventos é append-only: os eventos de emissora e
-- serviço ficam, e por isso o check de entidade volta como NOT VALID. Pela mesma razão, o check de operação de
-- integracoes.omie_envios volta NOT VALID se houver linha de alterar_os ou sincronizar_servicos.
-- Ensaiado em supabase/gates/20261020_portal_faturamento_t1b.sql (bloco Z).

begin;

drop trigger if exists fat_pedidos_status_guarda on receita.fat_pedidos;

do $drop$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where (p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%')
        or (p.pronamespace = 'integracoes'::regnamespace and p.proname in (
              'fat_exigir_conector', 'fat_envio_proximos', 'fat_envio_resultado', 'fat_status_aplicar',
              'fat_status_enfileirar', 'fat_servicos_aplicar', 'pipefy_envio_proximos', 'pipefy_envio_resultado',
              'receita_cnpj_gravar'))
        or (p.pronamespace = 'receita'::regnamespace and p.proname in (
              'fat_hoje', 'fat_dias_uteis', 'fat_status_rotulo', 'fat_documento_valido', 'fat_email_valido',
              'fat_parcelas_calcular', 'fat_recusar', 'fat_erro', 'fat_pessoa', 'fat_diff', 'fat_escopo',
              'fat_exigir_porta', 'fat_ve', 'fat_e_substituto', 'fat_pend_ok', 'fat_pend_devolvido', 'fat_pend_erro',
              'fat_acoes', 'fat_exigir', 'fat_contratos_vigentes', 'fat_contratos_outra_emissora', 'fat_bloqueio',
              'fat_pedido_validar', 'fat_snapshot', 'fat_transicao_permitida', 'fat_transicao', 'fat_evento_pedido',
              'fat_entrar_na_fila', 'fat_proximo_passo', 'fat_pedidos_status_guarda'))
  loop
    execute format('drop function %s', f);
  end loop;
end $drop$;

drop type receita.fat_escopo_t;

-- integracoes
drop table integracoes.receita_cnpj;
drop table integracoes.omie_emissora_estado;
drop index integracoes.pipefy_envios_origem_seq_idx;
alter table integracoes.pipefy_envios drop column seq;
drop index integracoes.omie_envios_depende_idx;
alter table integracoes.omie_envios drop column depende_de, drop column modo;
alter table integracoes.omie_envios drop constraint omie_envios_operacao_check;
alter table integracoes.omie_envios drop constraint omie_envios_origem_check;
do $checks$
begin
  if exists (select 1 from integracoes.omie_envios where operacao in ('alterar_os', 'sincronizar_servicos')
                                                     or origem = 'fat_emissora') then
    alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
      'garantir_cliente', 'incluir_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os')) not valid;
    alter table integracoes.omie_envios add constraint omie_envios_origem_check
      check (origem in ('fat_pedido', 'fat_contrato', 'fat_competencia')) not valid;
  else
    alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
      'garantir_cliente', 'incluir_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os'));
    alter table integracoes.omie_envios add constraint omie_envios_origem_check
      check (origem in ('fat_pedido', 'fat_contrato', 'fat_competencia'));
  end if;
end $checks$;
comment on column integracoes.omie_envios.payload is 'O "param" da chamada ao Omie, sem app_key nem app_secret.';
comment on column integracoes.omie_envios.resposta is null;
comment on column integracoes.pipefy_envios.payload is 'A mutation GraphQL montada (query e variables), sem token.';

-- receita
alter table receita.fat_eventos drop constraint fat_eventos_entidade_check;
alter table receita.fat_eventos add constraint fat_eventos_entidade_check
  check (entidade in ('pedido', 'contrato', 'item', 'competencia', 'dono')) not valid;

alter table receita.fat_servicos drop column no_omie;

drop index receita.fat_pedidos_status_idx;
drop index receita.fat_pedidos_enviado_por_idx;
alter table receita.fat_pedidos drop constraint fat_pedidos_completo;
alter table receita.fat_pedidos add constraint fat_pedidos_completo check (
  status in ('rascunho', 'devolvido', 'cancelado')
  or (tomador_tipo is not null and tomador_documento is not null and nullif(btrim(tomador_nome), '') is not null
      and servico_id is not null and nullif(btrim(descricao_nf), '') is not null and valor is not null
      and forma is not null and parcelas is not null and primeiro_vencimento is not null
      and competencia is not null and documento is not null and meio is not null and dono_id is not null)) not valid;
alter table receita.fat_pedidos
  drop constraint fat_pedidos_departamento_fk,
  drop constraint fat_pedidos_parcelas_max,
  drop column enviado_por, drop column enviado_em, drop column status_em, drop column na_fila_em,
  drop column conferido_por, drop column faturado_em, drop column simulacao, drop column omie_os_etapa,
  drop column omie_nf_emitida_em, drop column omie_lido_em, drop column tomador_municipio, drop column tomador_uf,
  drop column tomador_situacao;

drop table receita.fat_departamentos;

commit;
