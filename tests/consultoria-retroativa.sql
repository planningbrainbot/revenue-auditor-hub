with base as (
 select '{"old_base":true,"new_commercial":false,"regime":"Lucro Presumido","contact":false,"consultoria_origin":{"status":"retroativa","non_simples_confirmed":null}}'::jsonb a
), cases as (
 select 'base antiga fora do Simples sem contato, faixa ou segmento' name,a,'{}'::jsonb review,true expected from base
 union all select 'comercial bloqueado',a||'{"new_commercial":true}'::jsonb,'{}',false from base
 union all select 'prova comercial bloqueada',a||'{"consultoria_origin":{"status":"comercial"}}'::jsonb,'{}',false from base
 union all select 'base nova bloqueada',a||'{"old_base":false}'::jsonb,'{}',false from base
 union all select 'origem sem prova bloqueada',a-'consultoria_origin','{}',false from base
 union all select 'Simples bloqueado',a||'{"regime":"Simples Nacional"}'::jsonb,'{}',false from base
 union all select 'regime desconhecido pendente',a||'{"regime":null}'::jsonb,'{}',false from base
 union all select 'consulta fora do Simples comprovada',a||'{"regime":null,"consultoria_origin":{"status":"retroativa","non_simples_confirmed":true}}'::jsonb,'{}',true from base
 union all select 'faixa e segmento não vetam',a||'{"band_conflict":true,"segment_conflict":true}'::jsonb,'{}',true from base
 union all select 'divergência de regime impede',a||'{"regime_conflict":true}'::jsonb,'{}',false from base
 union all select 'revisão não libera origem comercial',a||'{"new_commercial":true}'::jsonb,'{"regime":"Lucro Real","band":"R$ 25 milhões até R$ 50 milhões","segment":"Indústria"}',false from base
)
select name,expected,(ops.monetizacao_offer_issue(a,'consultoria',review) is null) actual from cases;
