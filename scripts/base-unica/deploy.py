"""Deploy no Supabase Planning unificado; nunca imprime chaves ou registros."""
import argparse,json,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/monetizacao'))
from bootstrap import call,sql
FILES=['20260916235000_base_clientes_sync.sql','20260917000000_base_unica_catalogo.sql','20260917010000_base_ecd_metadata.sql','20260917011000_base_vinculos_conflitantes.sql','20260917012000_base_clientes_acesso.sql','20260917013000_base_eventos_perdidos.sql','20260917014000_base_identidade_pendente.sql']
def schemas():
 if sql("select to_regclass('ops.base_sync_registros') is not null installed",True)[0]['installed']:
  raise RuntimeError('Base já iniciada: conferir as migrations aplicadas antes de retomar. Não repetir renomeações/policies.')
 for name in FILES:
  sql((ROOT/'supabase/migrations'/name).read_text())
  print(json.dumps({'migration':name,'applied':True}),flush=True)
def edge(slug):
 boundary='planning-'+uuid.uuid4().hex
 meta={'entrypoint_path':slug+'/index.ts','name':slug,'verify_jwt':False}
 chunks=[f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{json.dumps(meta)}\r\n'.encode()]
 for path in list((ROOT/'supabase/functions'/slug).glob('*'))+[ROOT/'supabase/functions/_shared/strict-date.mjs']:
  if path.suffix not in ('.ts','.mjs'):continue
  filename=str(path.relative_to(ROOT/'supabase/functions'))
  chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+path.read_bytes()+b'\r\n')
 chunks.append(f'--{boundary}--\r\n'.encode())
 r=call('/functions/deploy?slug='+slug,b''.join(chunks),content_type='multipart/form-data; boundary='+boundary)
 print(json.dumps({k:r.get(k) for k in ['slug','status','version']}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['schemas','edge']);p.add_argument('--slug',choices=['base-clientes-sync','pipefy-auditoria-interna-sync']);a=p.parse_args()
 if a.action=='schemas':schemas()
 else:edge(a.slug or 'base-clientes-sync')
