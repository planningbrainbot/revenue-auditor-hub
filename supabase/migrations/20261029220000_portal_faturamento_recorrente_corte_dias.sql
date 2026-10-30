-- Portal de Faturamento · E2: a contagem da ficha do dia na Lista do corte bate com a lista (29/10/2026).
--
-- A ficha "13/11 · 811" contava também o contrato já encerrado no Omie sem resposta, que a lista esconde (790 na
-- lista). Agora as duas usam a mesma regra. Também tira, para quem vê a tela, as entidades HTML que o Omie manda nos
-- nomes ("GOMES &amp; MILHOMENS") das linhas e do espelho já gravados; a leitura nova do conector não as grava mais.
-- Rollback: supabase/rollback/20261029220000_portal_faturamento_recorrente_corte_dias_rollback.sql

begin;

do $troca$
declare
  _def text := pg_get_functiondef('ops.fat_corte(date, uuid)'::regprocedure);
  _a constant text := $a$                               where not c.automacao and c.emissora_id = any (_escopo)
                                 and c.data_corte >= (date_trunc('month', _hoje) - interval '1 month')::date$a$;
  _b constant text := $b$                               where not c.automacao and c.emissora_id = any (_escopo)
                                 and c.data_corte >= (date_trunc('month', _hoje) - interval '1 month')::date
                                 -- Mesma regra da lista: encerrado no Omie sem resposta não é trabalho da tesouraria.
                                 and not (c.motivos = array['encerrado_omie'] and c.resposta is null)$b$;
begin
  if position('Mesma regra da lista' in _def) > 0 then return; end if;
  if position(_a in _def) = 0 then raise exception 'trecho dos dias não encontrado em ops.fat_corte'; end if;
  execute replace(_def, _a, _b);
end $troca$;

update integracoes.omie_contratos_vigentes
   set cliente_nome = replace(replace(replace(cliente_nome, '&amp;', '&'), '&quot;', '"'), '&#39;', ''''),
       projeto = replace(replace(replace(projeto, '&amp;', '&'), '&quot;', '"'), '&#39;', '''')
 where cliente_nome ~ '&(amp|quot|#39);' or projeto ~ '&(amp|quot|#39);';
update receita.fat_competencias
   set cliente_nome = replace(replace(replace(cliente_nome, '&amp;', '&'), '&quot;', '"'), '&#39;', ''''),
       projeto = replace(replace(replace(projeto, '&amp;', '&'), '&quot;', '"'), '&#39;', '''')
 where cliente_nome ~ '&(amp|quot|#39);' or projeto ~ '&(amp|quot|#39);';

commit;
