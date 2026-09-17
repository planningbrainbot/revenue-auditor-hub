import test from 'node:test';
import assert from 'node:assert/strict';
import {aplicarBase,passaRefinamento} from '../src/lib/clientes-base.ts';
import {oferta} from '../src/lib/monetizacao/model.ts';
import {ofertaRecon,grupoRecon} from '../src/lib/monetizacao/recon.ts';
const meta={key:'test',cnpjs:['11222333000181'],empresa_ids:[],pipefy_ids:[],pipedrive_ids:[],omie_units:[],omie_records:0,contact_count:0,contact:false,ecd:[],declared_origin:[],origin:'antiga',origin_reason:'Unidade confirmou',validated_at:'2026-09-17',source_status:'not_linked'};
const company={key:'test',old_base:false,new_commercial:false,contact:true,ecd:true,regime:'Lucro Real'};
test('Base única: empresa antiga confirmada sem contato, receita ou ECD continua elegível a Consultoria',()=>{
 const a=aplicarBase(company,meta);assert.equal(oferta(a,'consultoria').status,'elegivel');assert.equal(a.contact,false);assert.equal(a.ecd,false);
});
test('Base única: origem pendente não herda elegibilidade de um snapshot antigo',()=>{
 const a=aplicarBase({...company,old_base:true,consultoria_origin:{status:'retroativa'}},{...meta,origin:'confirmar',origin_reason:'Validar unidade'});
 assert.equal(oferta(a,'consultoria').status,'revisar');assert.equal(a.old_base,false);
});
test('Base única: funil cumulativo e contato não se torna requisito comercial',()=>{
 const a=aplicarBase(company,{...meta,ecd:[{cnpj:'11222333000181',year:2024}]});
 assert.equal(passaRefinamento(a,''),true);assert.equal(passaRefinamento(a,'cnpj'),true);assert.equal(passaRefinamento(a,'contato'),false);assert.equal(passaRefinamento(a,'ecd'),false);
 assert.equal(passaRefinamento({...a,base:{...a.base,contact:true}},'ecd'),true);
});
test('Base única: ausência confirmada no Pipefy suspende envio até revisão',()=>{
 const a=aplicarBase(company,{...meta,source_status:'absent'});assert.equal(oferta(a,'consultoria').status,'revisar');
});
test('CNPJ contraditório mantém todos os produtos pendentes, inclusive Recon',()=>{
 const a=aplicarBase({...company,band:'R$ 25 milhões até R$ 50 milhões',pipedrive_contract:true},{...meta,identity_conflict:true});
 for(const product of ['cella','finance','consultoria'])assert.equal(oferta(a,product).status,'revisar');
 assert.equal(ofertaRecon(a).status,'revisar');assert.equal(grupoRecon(a),'identidade');
});
