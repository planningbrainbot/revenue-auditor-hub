// Integração exclusiva do Planning Brain. Os eventos apenas solicitam releitura.
import { TABLES, COMPANY_FIELDS, webhookRecord, mapCompany, mapContact } from './pipefy.mjs';
import { unitName } from './domain.mjs';
type Row = Record<string, any>;
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PIPEFY = Deno.env.get('PIPEFY_TOKEN')!;
const HOOK = Deno.env.get('BASE_CLIENTES_WEBHOOK_SECRET');
const CRON = Deno.env.get('BASE_CLIENTES_CRON_SECRET');
const response = (body: Row, status=200) => new Response(JSON.stringify(body), { status, headers: {'Content-Type':'application/json','Cache-Control':'no-store'} });
async function db(path: string, body?: unknown, method='POST') {
 const r=await fetch(`${URL}/rest/v1/${path}`,{method:body===undefined?'GET':method,headers:{apikey:SERVICE,Authorization:`Bearer ${SERVICE}`,'Content-Type':'application/json','Accept-Profile':'ops','Content-Profile':'ops',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!r.ok) throw new Error(`Banco recusou operação (${r.status})`); // Nunca devolver linhas/valores SQL ao chamador.
 return r.status===204?null:await r.json();
}
const rpc=(name:string,body:Row)=>db(`rpc/${name}`,body);
async function pf(query:string,variables:Row={}) {
 const r=await fetch('https://api.pipefy.com/graphql',{method:'POST',headers:{Authorization:`Bearer ${PIPEFY}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
 if(!r.ok) throw new Error(`Pipefy indisponível (${r.status})`);
 const b=await r.json(); if(b.errors?.length) throw new Error('Pipefy recusou consulta ou alteração');
 if(!b.data) throw new Error('Pipefy retornou resposta sem dados'); return b.data;
}
const RECORD='id title created_at updated_at table { id } record_fields { name value array_value field { id } }';
async function read(id:string,table:string) {const record=(await pf(`query($id:ID!){ table_record(id:$id){ ${RECORD} } }`,{id})).table_record;if(record&&String(record.table?.id)!==table)throw new Error('Registro não pertence à tabela Planning esperada');return record;}
async function schema(table:string) {const b=await pf('query($id:ID!){table(id:$id){table_fields{id}}}',{id:table});if(!b.table)throw new Error('Tabela Pipefy não encontrada');return b.table.table_fields.map((f:Row)=>f.id);}
async function page(table:string,after:string|null=null) {
 const b=await pf(`query($table:ID!,$after:String){table_records(table_id:$table,first:50,after:$after){pageInfo{hasNextPage endCursor} edges{node{${RECORD}}}}}`,{table,after});
 const p=b.table_records;if(!p?.pageInfo||!Array.isArray(p.edges))throw new Error('Paginação Pipefy inválida');
 if(p.edges.some((e:Row)=>String(e.node?.table?.id)!==table))throw new Error('Página contém registro fora da tabela esperada');
 if(p.pageInfo.hasNextPage&&(!p.pageInfo.endCursor||p.pageInfo.endCursor===after))throw new Error('Paginação Pipefy não avançou');
 return {records:p.edges.map((e:Row)=>e.node),next:p.pageInfo.hasNextPage?p.pageInfo.endCursor:null};
}
async function units() {
 const local:Row[]=await db('unidades?select=id,nome_da_praca,pipefy_id&limit=100');
 const source=await page(TABLES.units);if(source.next)throw new Error('Dicionário de unidades excedeu paginação prevista');
 // Apenas resolve IDs de unidades já cadastradas; rótulos estranhos nunca criam unidades.
 return local.flatMap(u=>{
  const linked=source.records.filter((r:Row)=>String(r.id)===String(u.pipefy_id)||unitName(r.title)===unitName(u.nome_da_praca));
  return linked.length===1?[{...u,pipefy_id:String(linked[0].id)}]:[u];
 });
}
function mapped(record:Row,kind:string,fields:string[],dictionary:Row[],at:string) {
 if(kind==='companies'){
  const m=mapCompany(record,fields,dictionary);
  return {fonte:'pipefy_empresa',registro_id:m.id,fonte_at:m.updatedAt,lido_em:at,campos:m.fields,vinculos:{unidade_id:m.unit?.id??null,unidade_status:m.unit?.status??null,unidade_raw:m.unit?.raw??[],cnpj_valido:m.cnpjValid}};
 }
 const m=mapContact(record,fields);return {fonte:'pipefy_contato',registro_id:m.id,fonte_at:m.updatedAt,lido_em:at,campos:m.fields,vinculos:{empresas:m.companyRefs}};
}
async function ingestOne(id:string,kind:string) {
 const at=new Date().toISOString();
 const [record,fields,dictionary]=await Promise.all([read(id,TABLES[kind as keyof typeof TABLES]),schema(TABLES[kind as keyof typeof TABLES]),kind==='companies'?units():Promise.resolve([])]);
 if(!record){await rpc('base_pipefy_ausente',{_fonte:kind==='companies'?'pipefy_empresa':'pipefy_contato',_registro:id,_at:at});return {status:'absent'};}
 const result=(await rpc('base_ingest_lote',{_registros:[mapped(record,kind,fields,dictionary,at)]}))[0];
 if(kind==='companies'&&result.empresa_id)await rpc('base_refresh_cadastro',{_empresa:result.empresa_id});
 return result;
}
async function reconcile() {
 const job=await rpc('base_sync_claim',{});if(!job)return {status:'idle'};
 let cursor=job.cursor,received=0,written=0,complete=false;
 try{
  const [fields,dictionary]=await Promise.all([schema(TABLES[job.kind as keyof typeof TABLES]),job.kind==='companies'?units():Promise.resolve([])]);
  for(let n=0;n<5;n++){
   const at=new Date().toISOString(),p=await page(TABLES[job.kind as keyof typeof TABLES],cursor);
   const results=await rpc('base_ingest_lote',{_registros:p.records.map((r:Row)=>mapped(r,job.kind,fields,dictionary,at))});
   received+=p.records.length;written+=results.filter((r:Row)=>['ok','pending'].includes(r.status)).length;cursor=p.next;
   if(!cursor){complete=true;break;}
  }
  if(complete){
   // Ausência na paginação é apenas suspeita. Relê até dez registros por ciclo
   // para recuperar exclusões cujo webhook se perdeu, sem apagar histórico.
   const missing=await rpc('base_sync_missing',{_kind:job.kind,_lease:job.lease});
   for(const id of missing)await ingestOne(id,job.kind);
   await rpc('monetizacao_intake_ops',{});await rpc('base_intake_omie',{});await rpc('base_refinar_ecd',{});await rpc('base_refresh_cadastro',{});
  }
  await rpc('base_sync_progress',{_kind:job.kind,_lease:job.lease,_cursor:cursor,_recebidos:received,_gravados:written,_complete:complete,_erro:null});
  return {status:complete?'ok':'running',source:job.kind,received,written};
 }catch(e){await rpc('base_sync_progress',{_kind:job.kind,_lease:job.lease,_cursor:cursor,_recebidos:received,_gravados:written,_complete:false,_erro:(e as Error).message});throw e;}
}
async function outbox() {
 const change=await rpc('base_claim_alteracao',{});if(!change)return {status:'idle'};
 try{
  const fields=await schema(TABLES.companies);
  if(!fields.includes(change.campo)||!COMPANY_FIELDS[change.campo])throw new Error('Campo indisponível na tabela Pipefy');
  const current=await read(change.pipefy_id,TABLES.companies);if(!current)throw new Error('Registro não existe no Pipefy');
  const before=mapCompany(current,fields,await units()).fields[COMPANY_FIELDS[change.campo]]??null;
  if(JSON.stringify(before)!==JSON.stringify(change.valor_proposto)&&JSON.stringify(before)!==JSON.stringify(change.valor_anterior)){
   await db(`base_alteracoes?id=eq.${change.id}`,{status:'conflict',erro:'O campo mudou no Pipefy desde a proposta; revise a correção.'},'PATCH');return {status:'conflict'};
  }
  if(JSON.stringify(before)!==JSON.stringify(change.valor_proposto))await pf('mutation($id:ID!,$field:ID!,$value:[UndefinedInput]){setTableRecordFieldValue(input:{table_record_id:$id,field_id:$field,value:$value}){table_record{id}}}',{id:change.pipefy_id,field:change.campo,value:change.valor_proposto});
  const confirmed=await read(change.pipefy_id,TABLES.companies);if(!confirmed)throw new Error('Não foi possível confirmar a alteração');
  const row=mapped(confirmed,'companies',fields,await units(),new Date().toISOString());
  if(JSON.stringify(row.campos[COMPANY_FIELDS[change.campo]]??null)!==JSON.stringify(change.valor_proposto))throw new Error('Pipefy ainda não confirmou o valor proposto');
  await rpc('base_ingest_lote',{_registros:[row]});
  await db(`base_alteracoes?id=eq.${change.id}`,{status:'confirmed',confirmado_em:new Date().toISOString(),erro:null},'PATCH');return {status:'confirmed'};
 }catch(e){await db(`base_alteracoes?id=eq.${change.id}`,{status:'error',erro:(e as Error).message},'PATCH');throw e;}
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return response({error:'Método não permitido'},405);
 const service=!!SERVICE&&req.headers.get('authorization')===`Bearer ${SERVICE}`;
 const scheduled=!!CRON&&req.headers.get('x-planning-base-cron')===CRON;
 const webhook=!!HOOK&&req.headers.get('x-planning-base-secret')===HOOK;
 if(!service&&!webhook&&!scheduled)return response({error:'Não autorizado'},401);
 let body:Row;try{body=await req.json();}catch{return response({error:'JSON inválido'},400);}
 try{
  if((service||scheduled)&&body.action==='tick')return response({sync:await reconcile(),outbox:await outbox()});
  const event=webhookRecord(body,[TABLES.companies,TABLES.contacts]);
  if(!event)return response({error:'Evento fora do contrato'},400);
  const source=event.table===TABLES.companies?'companies':'contacts';
  const run=(await db('base_sync_execucoes',{fonte:`webhook:${source}`,status:'running'}))[0];
  try{const result=await ingestOne(event.id,source);await db(`base_sync_execucoes?id=eq.${run.id}`,{status:result.status==='pending'?'partial':'ok',fim:new Date().toISOString(),recebidos:1,gravados:['ok','pending'].includes(result.status)?1:0,divergencias:result.pending_fields?.length||0},'PATCH');return response(result);}
  catch(e){await db(`base_sync_execucoes?id=eq.${run.id}`,{status:'error',fim:new Date().toISOString(),erro:(e as Error).message},'PATCH');throw e;}
 }catch(e){return response({error:(e as Error).message},502);}
});
