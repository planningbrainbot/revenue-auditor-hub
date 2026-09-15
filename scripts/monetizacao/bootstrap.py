"""Operações auditáveis da migração. Só imprime contagens, nunca credenciais ou contas.

SUPABASE_ACCESS_TOKEN vem do ambiente. --seed recebe o diretório privado de evidências.
Por padrão valida o DDL e faz ROLLBACK. --apply persiste somente as novas tabelas.
"""
import argparse, hashlib, json, os, secrets, urllib.request, urllib.error, uuid
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
REF = 'npknehhyyzelmrbbxvtu'
API = 'https://api.supabase.com/v1/projects/' + REF

def call(path, body=None, method=None, content_type='application/json'):
    data = json.dumps(body,ensure_ascii=False).encode() if isinstance(body,(dict,list)) else body
    req = urllib.request.Request(API+path, data=data, method=method,
        headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':content_type})
    try:
        with urllib.request.urlopen(req,timeout=180) as r:
            raw=r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        # Erros SQL podem conter dados; não imprimir a resposta bruta da API.
        raise RuntimeError('Supabase HTTP '+str(e.code)) from None

def sql(query, read_only=False): return call('/database/query',{'query':query,'read_only':read_only})
def literal(x): return "'"+str(x).replace("'","''")+"'"
def js(x): return literal(json.dumps(x,ensure_ascii=False))+'::jsonb'
def norm(s):
    import unicodedata
    s=''.join(c for c in unicodedata.normalize('NFD',s or '') if unicodedata.category(c)!='Mn').lower().strip()
    return {'sudeste (rj)':'rio de janeiro','goiania / matriz':'matriz','goiania':'matriz','sao luis':'sao luis'}.get(s,s)

def migrations(apply):
    paths=sorted(ROOT.glob('supabase/migrations/20260915*_monetizacao*.sql'))
    paths=[ROOT/'supabase/migrations/20260915120000_aquario_monetizacao.sql']+[p for p in paths if p.name!='20260915120000_aquario_monetizacao.sql']
    chunks=[p.read_text().removeprefix('begin;').removesuffix('commit;\n') for p in paths]
    # Primeiro arquivo contém comentários antes de BEGIN; nested BEGIN é inofensivo no Postgres.
    query='begin;\n'+'\n'.join(chunks)+ ('\ncommit;' if apply else '\nrollback;')
    sql(query)
    print(json.dumps({'migration_files':[p.name for p in paths],'persisted':apply}))

def seed(private: Path, dashboard: Path):
    source=json.loads((private/'11-september-input.json').read_text())
    catalog=json.loads((dashboard/'runtime/hunter-catalog.json').read_text())
    details=json.loads((dashboard/'runtime/customer-details.json').read_text())
    by={a['key']:a for a in catalog['accounts']}
    units=sql('select id,nome_da_praca from ops.unidades',True)
    unitmap={norm(u['nome_da_praca']):u['id'] for u in units}
    mapped={u['key']:unitmap.get(norm(u['name'])) for u in catalog['units']}
    unitrows=[{'key':u['key'],'unidade_id':mapped[u['key']],'nome':u['name'],'classification':u['classification']} for u in catalog['units']]
    sql(f"insert into ops.monetizacao_unidades(key,unidade_id,nome,classification) select x->>'key',(x->>'unidade_id')::integer,x->>'nome',x->>'classification' from jsonb_array_elements({js(unitrows)}) x on conflict(key) do update set unidade_id=excluded.unidade_id,nome=excluded.nome,classification=excluded.classification")
    rows=[]
    for a in source['accounts']:
        key=hashlib.sha256(str(a['id']).encode()).hexdigest()[:16]
        p=by.get(key)
        if not p:
            p={'key':key,'name':a['razao_social'],'units':[],'unit_label':a.get('unidade'),'orgs':a['org_ids'],'contact':bool(a['contatos']),'band':a.get('faixa'),'regime':a.get('regime'),'segment':a.get('segmento'),'old_base':any(x.get('valor')=='Base Antiga' for x in a.get('procedencia',{}).get('origem_da_base',[])),'matrix':bool(a.get('matriz_recorrente')),'new_commercial':'A' in a['origens'],'pipedrive_contract':bool(a.get('deal_primeiro_ganho')),'pipedrive_contract_id':a.get('deal_primeiro_ganho'),'consultoria_priority':False,'finance_candidate':False,'finance':{'status':'revisar','reason':'Reavaliar conforme cadastro'},'ecd':bool(a.get('ecd')),'band_conflict':'faixa' in a.get('conflitos_campos',{}),'regime_conflict':'regime' in a.get('conflitos_campos',{})}
        p={**p,'canonical_id':a['id'],'source_ids':a['source_ids']}
        uids={mapped[u] for u in p['units'] if mapped.get(u)}
        # Unidade declarada conciliada complementa a carteira comercial sem registro Pipefy.
        if not p['units'] and unitmap.get(norm(p.get('unit_label'))):uids.add(unitmap[norm(p['unit_label'])])
        eids=[int(s.split(':',1)[1]) for s in a['source_ids'] if s.startswith('ops:') and s.split(':',1)[1].isdigit()]
        d=details.get(key,{'cnpjs':a.get('cnpjs',[]),'fields':{},'contacts':[],'sources':{}}).copy()
        ecd=a.get('ecd') or {}
        # Somente resumo agregado já autorizado. Nenhuma demonstração fiscal bruta é copiada.
        d={k:v for k,v in d.items() if k in ['cnpjs','fields','contacts','sources','contract_count','person_id']}
        d['ecd_summary']={'available':bool(ecd),'exercise':str(ecd.get('ecd_exercicio','')) if isinstance(ecd,dict) else ''}
        if not d.get('fields'):
            d['fields']={k:{'value':p.get(v),'source':'base reconciliada','at':source['measured_at']} for k,v in [('faixa','band'),('regime','regime'),('segmento','segment'),('unidade','unit_label')]}
        rows.append({'key':key,'perfil':p,'empresa_ids':eids,'org_ids':p['orgs'],'unidade_ids':sorted(uids),'source_at':source['measured_at'],'detalhe':d})
    assert len(rows)==len({r['key'] for r in rows})
    for start in range(0,len(rows),100):
        chunk=rows[start:start+100]
        query=f"""begin;
        insert into ops.monetizacao_contas(key,perfil,empresa_ids,org_ids,unidade_ids,source_at)
        select x->>'key',x->'perfil',array(select jsonb_array_elements_text(x->'empresa_ids')::integer),array(select jsonb_array_elements_text(x->'org_ids')::bigint),array(select jsonb_array_elements_text(x->'unidade_ids')::integer),(x->>'source_at')::timestamptz from jsonb_array_elements({js(chunk)}) x
        on conflict(key) do nothing;
        insert into ops.monetizacao_detalhes(account_key,detalhe) select x->>'key',x->'detalhe' from jsonb_array_elements({js(chunk)}) x on conflict(account_key) do nothing;
        commit;"""
        sql(query)
    sql(f"update ops.monetizacao_sync set catalog_at={literal(source['measured_at'])}::timestamptz where id")
    print(json.dumps({'seed_accounts':len(rows),'catalog_accounts':len(by),'units':len(unitrows),'unmapped_units':sum(u['unidade_id'] is None for u in unitrows),'source_at':source['measured_at']}))

def deploy_edge():
    folder=ROOT/'supabase/functions/monetizacao-crm'
    boundary='planning-'+uuid.uuid4().hex
    chunks=[]
    meta={'entrypoint_path':'index.ts','name':'monetizacao-crm','verify_jwt':False}
    chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{json.dumps(meta)}\r\n'.encode())
    for p in sorted(folder.iterdir()):
        if p.suffix not in ('.ts','.mjs'):continue
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{p.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+p.read_bytes()+b'\r\n')
    chunks.append(f'--{boundary}--\r\n'.encode())
    result=call('/functions/deploy?slug=monetizacao-crm',b''.join(chunks),content_type='multipart/form-data; boundary='+boundary)
    print(json.dumps({k:result.get(k) for k in ['id','slug','status','version','verify_jwt']}))

def schedule():
    # Nova chave desta integração, gerada aqui. Não lê nem exporta segredos existentes.
    key=secrets.token_urlsafe(48)
    call('/secrets',[{'name':'MONETIZACAO_SYNC_SECRET','value':key}])
    sql(f"""do $do$ begin
      if exists(select 1 from vault.secrets where name='monetizacao_sync_secret') then
        perform vault.update_secret((select id from vault.secrets where name='monetizacao_sync_secret'),{literal(key)});
      else perform vault.create_secret({literal(key)},'monetizacao_sync_secret','Invocação agendada do CRM de Monetização'); end if;
      end $do$;
      create or replace function ops.monetizacao_cron() returns bigint language sql security definer set search_path=ops,public,extensions as $fn$
      select net.http_post(url:='https://{REF}.supabase.co/functions/v1/monetizacao-crm',headers:=jsonb_build_object('Content-Type','application/json','x-monetizacao-sync',(select decrypted_secret from vault.decrypted_secrets where name='monetizacao_sync_secret')),body:='{{"action":"sync"}}'::jsonb,timeout_milliseconds:=180000);
      $fn$;
      revoke all on function ops.monetizacao_cron() from public,anon,authenticated;
      select cron.schedule('monetizacao-crm-5min','*/5 * * * *','select ops.monetizacao_cron()');
    """)
    print(json.dumps({'schedule':'*/5 * * * *','job':'monetizacao-crm-5min'}))
    # Disparo apenas de leitura do Pipedrive + atualização do cache privado.
    req=urllib.request.Request(f'https://{REF}.supabase.co/functions/v1/monetizacao-crm',data=b'{"action":"sync"}',headers={'Content-Type':'application/json','x-monetizacao-sync':key})
    with urllib.request.urlopen(req,timeout=180) as r:print(json.dumps(json.load(r)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--validate',action='store_true');p.add_argument('--seed',type=Path);p.add_argument('--dashboard',type=Path);p.add_argument('--deploy-edge',action='store_true');p.add_argument('--schedule',action='store_true');args=p.parse_args()
    if args.apply or args.validate:migrations(args.apply)
    if args.seed:
        if not args.dashboard:p.error('--dashboard obrigatório para --seed')
        seed(args.seed,args.dashboard)
    if args.deploy_edge:deploy_edge()
    if args.schedule:schedule()
