-- Contatos no "Exportar filtro" da Base de clientes. O CSV só dizia se a conta tinha contato;
-- o contato em si vivia na gaveta, uma conta por vez (monetizacao_detail). Esta função devolve
-- os mesmos canais da gaveta, das mesmas três fontes e com o mesmo gate, para um lote de contas,
-- mais nome e cargo do contato vinculado no Pipefy, que a gaveta não mostra.
-- Conta fora do escopo não volta (some do resultado, sem erro), como na leitura da carteira.
create or replace function ops.base_contatos_exportar(_keys text[]) returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare out jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
 if not ops.monetizacao_can('view.contatos') then raise exception 'Sem permissão para ver contatos';end if;
 if cardinality(_keys)>500 then raise exception 'Máximo de 500 contas por lote';end if;
 -- EXECUTE planeja com o array de verdade; o plano genérico do plpgsql levava 8 s por lote de 500.
 execute $q$ with contas as (
  select a.key,a.empresa_ids from ops.monetizacao_contas a
  where a.key=any($1) and ops.monetizacao_scope(a.unidade_ids)
 ), canais as (
  -- Conta sem empresa no Ops: o que ficou gravado no detalhe (Pipedrive e stakeholder do Pipefy).
  select c.key,null::text nome,null::text cargo,x->>'type' tipo,x->>'value' valor
  from contas c join ops.monetizacao_detalhes d on d.account_key=c.key
  cross join lateral jsonb_array_elements(coalesce(d.detalhe->'contacts','[]')) x
  where cardinality(c.empresa_ids)=0 and coalesce(x->>'source','') not like 'ops.contatos%'
  union all
  select c.key,nullif(trim(p.nome_completo),''),nullif(trim(p.cargo),''),v.tipo,v.valor
  from contas c join ops.contatos p on p.empresa_id=any(c.empresa_ids)
  left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=p.id
  cross join lateral (values ('email',p.email),('whatsapp',p.whatsapp)) v(tipo,valor)
  where s.status is distinct from 'ausente' and nullif(trim(v.valor),'') is not null
  union all
  select c.key,null,null,v.tipo,v.valor
  from contas c join ops.base_conta_cnpjs d on d.account_key=c.key
  join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj
  cross join lateral (values ('email',o.email),('telefone',o.telefone)) v(tipo,valor)
  where nullif(trim(v.valor),'') is not null
 ), emails as (
  -- O Omie guarda vários e-mails no mesmo campo, separados por vírgula ou ponto e vírgula.
  select distinct key,lower(e) email from canais
  cross join lateral regexp_split_to_table(trim(valor),'[,;[:space:]]+') e
  where tipo='email' and e like '%@%'
 ), telefones as (
  -- O mesmo número chega formatado de jeitos diferentes; vale um por sequência de dígitos, sem o 55.
  select distinct on (key,digitos) key,trim(valor) telefone from (
   select key,valor,regexp_replace(regexp_replace(valor,'\D','','g'),'^55(?=\d{10,11}$)','') digitos
   from canais where tipo<>'email'
  ) t where digitos<>'' order by key,digitos,valor
 )
 select coalesce(jsonb_object_agg(c.key,jsonb_build_object(
   'nomes',(select string_agg(distinct nome||coalesce(' ('||cargo||')',''),'; ') from canais n where n.key=c.key and nome is not null),
   'emails',(select string_agg(email,'; ' order by email) from emails e where e.key=c.key),
   'telefones',(select string_agg(telefone,'; ' order by telefone) from telefones t where t.key=c.key))),'{}')
 from (select distinct key from canais) c $q$ into out using _keys;
 return out;
end $$;
revoke all on function ops.base_contatos_exportar(text[]) from public,anon;
grant execute on function ops.base_contatos_exportar(text[]) to authenticated;
