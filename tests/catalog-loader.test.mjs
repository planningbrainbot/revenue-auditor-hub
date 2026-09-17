import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogPages } from '../src/lib/monetizacao/catalog-loader.ts';
const version={catalog_at:'2026-09-17T12:00:00Z',scope_signature:'scope-a'};
const pages=Array.from({length:20},(_,i)=>({after:i?String(i-1):null,through:String(i),count:1}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('carrega lotes com até quatro consultas em paralelo e preserva a ordem do manifesto',async()=>{
 let running=0,max=0;
 const result=await loadCatalogPages(pages,async page=>{
  running++;max=Math.max(max,running);await delay((Number(page.through)%4)+1);running--;
  return {...version,accounts:[{key:page.through}]};
 },{...version,base_count:20});
 assert.equal(max,4);assert.deepEqual(result.map(a=>a.key),pages.map(p=>p.through));
});
test('nunca aceita versão ou escopo diferentes entre manifesto e página',async()=>{
 for(const patch of [{catalog_at:'new-version'},{scope_signature:'other-scope'}])
  await assert.rejects(loadCatalogPages(pages.slice(0,1),async()=>({...version,...patch,accounts:[{key:'0'}]}),{...version,base_count:1}),/base ou seu acesso mudou/);
});
test('recusa lote parcial e limite divergente mesmo com a mesma revisão',async()=>{
 for(const accounts of [[],[{key:'different-boundary'}]])
  await assert.rejects(loadCatalogPages(pages.slice(0,1),async()=>({...version,accounts}),{...version,base_count:1}),/base ou seu acesso mudou/);
});
test('recusa duplicação entre lotes sem publicar total parcial',async()=>{
 const boundaries=[{after:null,through:'b',count:2},{after:'b',through:'c',count:2}];
 await assert.rejects(loadCatalogPages(boundaries,async p=>({...version,accounts:(p.after?['b','c']:['a','b']).map(key=>({key}))}),{...version,base_count:4}),/total parcial/);
});
test('cancelamento encerra a carga e carteira vazia não faz consultas',async()=>{
 let called=0;assert.deepEqual(await loadCatalogPages([],async()=>{called++;},{...version,base_count:0}),[]);assert.equal(called,0);
 const controller=new AbortController();controller.abort();
 await assert.rejects(loadCatalogPages(pages,async()=>{called++;},{...version,base_count:20,signal:controller.signal}),{name:'AbortError'});assert.equal(called,0);
});
test('falha não inicia novos lotes e manifesto incompleto falha antes da rede',async()=>{
 let called=0;
 await assert.rejects(loadCatalogPages(pages,async p=>{called++;if(p.through==='0')throw new Error('offline');await delay(3);return {...version,accounts:[{key:p.through}]};},{...version,base_count:20}),/offline/);
 await delay(8);assert.equal(called,4);
 await assert.rejects(loadCatalogPages(pages,async()=>{called++;},{...version,base_count:21}),/lotes da carteira/);assert.equal(called,4);
});
