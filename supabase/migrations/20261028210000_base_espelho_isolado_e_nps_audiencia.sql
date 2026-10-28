-- Duas pendências da atualização da base pela unidade (28/10/2026).
--
-- 1. Espelho do Pipefy travado desde 21/09: a reconciliação de Empresas parava sempre na mesma página porque um
--    registro (Móveis DAGA, unidade Itaúna, que não existe em ops.unidades) gravava o id cru do conector em
--    `unidade` e quebrava a regra empresas_unidade_nao_e_id. Como o lote era uma transação só, os outros 49
--    registros iam junto, e a página voltava a cada 5 minutos (os ~10 erros 400 por hora do tick). O mapeamento
--    da Edge Function passa a gravar o rótulo; aqui, um registro com erro não derruba mais o lote: ele volta com
--    status 'error' e o resto é gravado.
--
-- 2. P-02 do PRD: o disparo do NPS (n8n, workflow "NPS - Criar Card e Enviar WhatsApp") lê ops.nps_audiencia.
--    Cliente com contato do NPS marcado recebe só nesse contato; cliente sem marca segue a regra de antes.
--    Contato inativo sai. A view não herda RLS: quem chega como usuário logado passa pela chave do NPS e pelo
--    escopo de unidade (o sócio lia por ela os contatos da rede inteira, buraco que a fatia 0 não fechou).

create or replace function ops.base_ingest_lote(_registros jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops', 'public', 'extensions'
as $function$
declare r jsonb; results jsonb:='[]';
begin
 if jsonb_array_length(_registros)>100 then raise exception 'Lote excede 100 registros'; end if;
 for r in select value from jsonb_array_elements(_registros) loop
  begin
   results:=results||jsonb_build_array(ops.base_ingest_pipefy(r->>'fonte',r->>'registro_id',(r->>'fonte_at')::timestamptz,(r->>'lido_em')::timestamptz,r->'campos',r->'vinculos'));
  exception when others then
   -- Um registro ruim não segura os outros do lote; o chamador recebe o motivo e o registro volta no próximo ciclo.
   results:=results||jsonb_build_array(jsonb_build_object('status','error','registro_id',r->>'registro_id','erro',left(sqlerrm,300)));
  end;
 end loop;
 return results;
end $function$;

create or replace view ops.nps_audiencia as
 with base as (
  select c.id, c.nome_completo, c.whatsapp, c.email, c.contato_nps, c.empresa_id,
    e.titulo as empresa_titulo, e.unidade, e.origem_da_base,
    -- O cliente (a conta da Base, que junta os cadastros de Empresas) tem um contato do NPS válido marcado?
    exists (
     select 1 from ops.monetizacao_contas m
      join ops.contatos x on x.empresa_id = any(m.empresa_ids)
     where c.empresa_id = any(m.empresa_ids)
       and x.ativo and x.contato_nps and ops.base_whatsapp(x.whatsapp) is not null
    ) as cliente_tem_marcado
  from ops.contatos c
   left join ops.empresas e on e.id = c.empresa_id
   left join ops.central_tratativas ct on ct.status = 'lost'::text and ct.pipedrive_deal_id::text = e.pipedrive_id
  where c.ativo
    and c.whatsapp is not null and length(regexp_replace(c.whatsapp, '\D'::text, ''::text, 'g'::text)) >= 10
    and ct.pipedrive_deal_id is null
    and (coalesce(auth.role(), '') <> 'authenticated'
         or (((select ops.can('view.nps')) or (select ops.can('edit.nps')))
             and ((not (select ops.can('data.scope.own_unit_only')))
                  or nullif(ops.norm_unidade(e.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}')))))
 )
 select distinct on (b.whatsapp) b.id, b.nome_completo, b.whatsapp, b.email, b.empresa_id, b.empresa_titulo,
   b.unidade, b.origem_da_base
 from base b
 where not b.cliente_tem_marcado or (b.contato_nps and ops.base_whatsapp(b.whatsapp) is not null)
 order by b.whatsapp, b.contato_nps desc, (b.email is not null) desc, b.id desc;

revoke insert, update, delete, truncate, references, trigger on ops.nps_audiencia from authenticated, anon;
