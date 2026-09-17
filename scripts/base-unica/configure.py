"""Ativa somente as automações das duas tabelas Planning após migração e deploy.
Requer SUPABASE_ACCESS_TOKEN e PIPEFY_TOKEN no ambiente; nunca os imprime.
--private guarda chaves técnicas fora do repositório, com permissão 0600.
"""
import argparse,json,os,secrets,sys,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/monetizacao'))
from bootstrap import call,sql,literal,REF
TABLES={'companies':'nIlE2il6','contacts':'Y2LGWdN-'}
def pf(query,variables):
 req=urllib.request.Request('https://api.pipefy.com/graphql',data=json.dumps({'query':query,'variables':variables}).encode(),headers={'Authorization':'Bearer '+os.environ['PIPEFY_TOKEN'],'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as r:b=json.load(r)
 if b.get('errors'):raise RuntimeError('Pipefy recusou a configuração; detalhes não publicados')
 return b['data']
def configure(private):
 ready=sql("select to_regprocedure('ops.base_ingest_lote(jsonb)') is not null and to_regprocedure('ops.base_unica_catalogo(text[])') is not null ready",True)
 if not ready[0]['ready']:raise RuntimeError('Aplicar as migrações revisadas antes de ativar as automações')
 private.mkdir(parents=True,exist_ok=True,mode=0o700)
 path=private/'automation-secrets.json'
 if path.exists():keys=json.loads(path.read_text())
 else:
  keys={k:secrets.token_urlsafe(48) for k in ['BASE_CLIENTES_WEBHOOK_SECRET','BASE_CLIENTES_CRON_SECRET']}
  path.write_text(json.dumps(keys));path.chmod(0o600)
 call('/secrets',[{'name':k,'value':v} for k,v in keys.items()])
 url=f'https://{REF}.supabase.co/functions/v1/base-clientes-sync'
 for kind,table in TABLES.items():
  current=pf('query($id:ID!){table(id:$id){webhooks{id name url}}}',{'id':table})['table']['webhooks']
  found=[w for w in current if w['url']==url]
  if len(found)>1:raise RuntimeError('Webhooks duplicados: revisar antes de ativar')
  if not found:
   pf('mutation($table:ID!,$url:String!,$headers:Json){createWebhook(input:{table_id:$table,name:"Planning Brain · Base única",url:$url,actions:["card.create","card.field_update","card.delete"],headers:$headers}){webhook{id}}}',{'table':table,'url':url,'headers':json.dumps({'x-planning-base-secret':keys['BASE_CLIENTES_WEBHOOK_SECRET']})})
  print(json.dumps({'table':kind,'webhook':'configured'}),flush=True)
 key=keys['BASE_CLIENTES_CRON_SECRET']
 sql(f"""begin;
 do $do$ begin
 if exists(select 1 from vault.secrets where name='base_clientes_cron_secret') then
 perform vault.update_secret((select id from vault.secrets where name='base_clientes_cron_secret'),{literal(key)});
 else perform vault.create_secret({literal(key)},'base_clientes_cron_secret');end if;
 end $do$;
 select cron.unschedule(jobid) from cron.job where jobname='base-clientes-reconcile';
 select cron.schedule('base-clientes-reconcile','* * * * *',$cron$
 select net.http_post(url:='{url}',headers:=jsonb_build_object('Content-Type','application/json','x-planning-base-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_clientes_cron_secret')),body:='{{"action":"tick"}}'::jsonb,timeout_milliseconds:=150000);
 $cron$);commit;""")
 print(json.dumps({'schedule':'base-clientes-reconcile','active':True}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--private',type=Path,required=True);a=p.parse_args();configure(a.private)
