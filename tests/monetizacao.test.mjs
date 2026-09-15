import test from 'node:test';
import assert from 'node:assert/strict';
import { oferta, disponibilidade, operacao, temporal, receitaSomada, dias, csv, capacidade } from '../src/lib/monetizacao/model.ts';
import { summarize, PRODUCT } from '../supabase/functions/monetizacao-crm/crm.mjs';
import { expectedRevenue, REVENUE_FIELDS } from '../supabase/functions/monetizacao-crm/revenue.mjs';

const account = (override={}) => ({key:'a',name:'Empresa sintética',units:[],unit_label:null,orgs:[10],contact:false,band:'R$ 10 milhões até R$ 25 milhões',regime:'Lucro Real',segment:'Indústria',old_base:true,matrix:false,new_commercial:false,pipedrive_contract:true,consultoria_priority:true,finance_candidate:true,finance:{status:'elegivel',reason:''},ecd:false,...override});
const stages=[{id:1,order_nr:1,name:'Base elegível'},{id:2,order_nr:2,name:'Abordagem em curso'},{id:3,order_nr:3,name:'Reunião agendada'},{id:4,order_nr:4,name:'Reunião realizada'},{id:5,order_nr:5,name:'Em negociação'},{id:6,order_nr:6,name:'Proposta enviada'},{id:7,order_nr:7,name:'Reciclado'}];
const change=(old,newValue,at,actor=20,field='stage_id') => ({object:'dealChange',data:{field_key:field,old_value:old,new_value:newValue,log_time:at,user_id:actor}});
const raw=(over={}) => ({id:100,title:'Empresa sintética',org_id:{value:10,name:'Empresa sintética'},user_id:{id:20,name:'Hunter'},creator_user_id:{id:20},stage_id:5,status:'open',pipeline_id:39,add_time:'2026-09-01 12:00:00',update_time:'2026-09-15 15:00:00',[PRODUCT]:1129,...over});
const card=(r=raw(), flow=[change(1,2,'2026-09-02 12:00:00'),change(2,4,'2026-09-03 12:00:00'),change(4,5,'2026-09-04 12:00:00')])=>summarize([r],stages,{[r.id]:flow},'2026-09').cards[0];
const filter={from:'2026-09-01',to:'2026-09-15',owner:20,product:''};

test('Finance: contrato ganho, menos de 25 mi, fora do Simples; não exige contato, CNPJ ou piso',()=>{
 assert.equal(oferta(account({band:'Até R$ 500 mil',regime:'Lucro Arbitrado'}),'finance').status,'elegivel');
 assert.equal(oferta(account({pipedrive_contract:false}),'finance').status,'fora_regra');
 for(const regime of ['Simples Nacional','MEI']) assert.equal(oferta(account({regime}),'finance').status,'fora_regra');
 assert.equal(oferta(account({band:'R$ 25 milhões até R$ 50 milhões'}),'finance').status,'fora_regra');
 assert.equal(oferta(account({band:'[ANTIGO] Entre R$ 4,8 milhões e R$ 78 milhões'}),'finance').status,'revisar');
 assert.equal(oferta(account({regime:null}),'finance').status,'revisar');
 assert.equal(oferta(account({band_conflict:true}),'finance').status,'revisar');
});
test('Consultoria sem contato continua elegível; confirmação resolve divergência com procedência',()=>{
 assert.equal(oferta(account(),'consultoria').status,'elegivel');
 assert.equal(oferta(account({segment_conflict:true}),'consultoria').status,'revisar');
 assert.equal(oferta(account({segment_conflict:true}),'consultoria',{segment:'Agronegócio'}).status,'elegivel');
 assert.equal(oferta(account({regime:'Lucro Presumido'}),'consultoria').status,'fora_regra');
});
test('Disponibilidade é por conta e produto; abertura de Consultoria não ocupa Finance',()=>{
 const c=card();assert.equal(disponibilidade(account(),'consultoria',[c],'2026-09').free,false);
 assert.equal(disponibilidade(account(),'finance',[c],'2026-09').free,true);
 assert.equal(disponibilidade(account(),'consultoria',[{...c,status:'lost'}],'2026-09').free,false);
 assert.equal(disponibilidade(account(),'consultoria',[{...c,status:'lost'}],'2026-10').free,true);
});
test('Proposta direta valida uma vez; retorno à negociação não duplica',()=>{
 const c=card(raw({stage_id:6}),[change(1,6,'2026-09-04 12:00:00'),change(6,5,'2026-09-08 12:00:00')]);
 assert.equal(c.events.validated.length,1);assert.equal(c.events.validated[0].date,'2026-09-04');
});
test('Reciclado não é oportunidade validada mesmo aparecendo depois de negociação',()=>{
 const c=card(raw({stage_id:7}),[change(1,7,'2026-09-04 12:00:00')]);assert.equal(c.events.validated.length,0);
});
test('Ator do movimento preservado quando dono atual muda',()=>{
 const c=card(raw({user_id:{id:99,name:'Sistema'}}),[change(1,5,'2026-09-04 12:00:00',20),change(20,99,'2026-09-05 12:00:00',99,'user_id')]);
 assert.equal(operacao([c],filter).rows.validated.length,1);assert.equal(operacao([c],{...filter,owner:99}).rows.validated.length,0);
 assert.equal(operacao([c],filter).current.length,0);
});
test('Data local usa São Paulo, com mudança de dia em UTC',()=>{
 const c=card(raw(),[change(1,5,'2026-09-02 01:00:00')]);assert.equal(c.events.validated[0].date,'2026-09-01');
 assert.equal(operacao([c],{...filter,from:'2026-09-02'}).rows.validated.length,0);
});
test('Título não determina produto canônico',()=>{
 const c=card(raw({title:'Finance oportunidade Cella',[PRODUCT]:null}));assert.equal(c.route,'sem_produto');
});
test('Histórico indisponível não vira validação inferida da etapa atual',()=>{
 const c=summarize([raw()],stages,{},'2026-09').cards[0];assert.equal(c.history_known,false);assert.equal(c.events.validated.length,0);
});
test('Card distinto no período e por dia; contagem auditável',()=>{
 const c=card(raw({stage_id:4}),[change(1,4,'2026-09-03 12:00:00'),change(4,3,'2026-09-04 12:00:00'),change(3,4,'2026-09-06 12:00:00')]);
 const v=operacao([c],filter);assert.equal(v.rows.meeting.length,1);assert.equal(v.series.reduce((n,d)=>n+d.meeting,0),2);
});
test('Receita nula não vira zero e parcelas divergentes não entram no total conciliado',()=>{
 assert.equal(expectedRevenue({}).total.amount,null);
 const r={};for(const [k,v] of [[REVENUE_FIELDS.total,100],[REVENUE_FIELDS.partners,60],[REVENUE_FIELDS.unit,30]]) {r[k]=v;r[k+'_currency']='BRL';}
 assert.equal(expectedRevenue(r).status,'mismatch');assert.equal(receitaSomada([card(raw(r))]).known,0);
 r[REVENUE_FIELDS.unit]=40;r[REVENUE_FIELDS.unit_name]=694;const totals=receitaSomada([card(raw(r))]);assert.equal(totals.total,100);assert.equal(totals.partners,60);assert.equal(totals.unit,40);
 r[REVENUE_FIELDS.total]=0;r[REVENUE_FIELDS.partners]=0;r[REVENUE_FIELDS.unit]=0;assert.equal(receitaSomada([card(raw(r))]).known,1);
});
test('Sem data fica em bucket explícito, não é alocada ao mês arbitrariamente',()=>{
 const c=card();const t=temporal([c],filter);assert.equal(t.weeks[0].week,'Sem data');assert.equal(t.median,null);
});
test('Período valida datas reais e limite; CSV neutraliza fórmulas',()=>{
 assert.throws(()=>dias('2026-02-30','2026-03-01'));assert.throws(()=>dias('2026-03-01','2026-02-01'));assert.throws(()=>dias('2020-01-01','2026-01-01'));
 assert.ok(csv([['=IMPORTXML("x")']]).includes("'=IMPORTXML"));
});

test('Reserva compartilhada ocupa só a mesma oferta, inclusive enquanto o CRM ainda sincroniza',()=>{
 const reserved=[{account_key:'a',product:'consultoria',status:'uncertain',deal_id:null}];
 assert.equal(disponibilidade(account(),'consultoria',[],'2026-09',reserved).free,false);
 assert.equal(disponibilidade(account(),'finance',[],'2026-09',reserved).free,true);
 assert.equal(disponibilidade(account(),'consultoria',[],'2026-09',[{...reserved[0],status:'released'}]).free,true);
});
test('Capacidade desconta o trabalho iniciado antes de pedir base adicional',()=>{
 const plan={month:'2026-09',allocation:{consultoria:2,finance:0,cella:0},rates:{consultoria:null,finance:null,cella:null}};
 const row=capacidade(plan,[account(),account({key:'b',orgs:[11]})],[card()],filter).find(r=>r.product==='consultoria');
 assert.equal(row.started,1);assert.equal(row.available,1);assert.equal(row.remaining,1);assert.equal(row.executable,1);assert.equal(row.gap,0);assert.equal(row.estimate,null);
});
