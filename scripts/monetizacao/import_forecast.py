"""Importa uma versão do forecast sem alterar a planilha ou suas premissas.

v10 (09/09): uma aba "Forecast", um plano.
v12 (28/09): uma aba "Forecast <cenário>" por cenário (Conservador, Estimado, Otimista), com o mesmo
layout de linhas da v10 (12 a 67) e a parceria da Cella nas linhas 71 e 72. Vira uma fonte por cenário;
o Estimado é o padrão e tem o id sem sufixo, para vir primeiro na ordenação por id.

O XLSX não possui cache de fórmulas. Avaliador restrito às operações usadas nos modelos: sintaxe não
suportada falha, nunca vira zero silencioso.
Uso: python import_forecast.py arquivo.xlsx --output /caminho/privado.json [--sql /caminho/upsert.sql]
     [--drive-url https://docs.google.com/spreadsheets/d/... --drive-updated-at 2026-09-28T19:00:00Z]
"""
import argparse, ast, hashlib, json, operator, posixpath, re, zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
REF = re.compile(r"(?:(?:'([^']+)'|([A-Za-zÀ-ÿ_]+))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?")
def col_num(col):
    n = 0
    for c in col: n = n * 26 + ord(c) - 64
    return n
def col_name(n):
    out = ''
    while n: n, r = divmod(n-1, 26); out = chr(65+r)+out
    return out

class Model:
    def __init__(self, path):
        self.cells = {}
        with zipfile.ZipFile(path) as z:
            shared = ET.fromstring(z.read('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in z.namelist() else []
            strings = [''.join(si.itertext()) for si in shared]
            # A aba se acha pela relação do workbook, não pelo sheetId (que não precisa bater com o arquivo).
            rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
            for s in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
                target = rels[s.attrib[RID]]
                target = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
                cells = {}
                for c in ET.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c', NS):
                    v, f, inline = c.find('s:v', NS), c.find('s:f', NS), c.find('s:is', NS)
                    value = v.text if v is not None else None
                    if c.attrib.get('t') == 's': value = strings[int(value)]
                    elif c.attrib.get('t') == 'inlineStr': value = ''.join(inline.itertext()) if inline is not None else None
                    elif c.attrib.get('t') == 'str': value = value
                    elif value is not None: value = float(value)
                    cells[c.attrib['r']] = {'value': value, 'formula': f.text if f is not None else None}
                self.cells[s.attrib['name']] = cells

    @lru_cache(maxsize=None)
    def value(self, sheet, ref):
        c = self.cells[sheet].get(ref, {})
        if not c.get('formula'): return c.get('value') if c.get('value') is not None else 0
        expr = REF.sub(lambda m: f"REF({(m[1] or m[2] or sheet)!r},{m[3].replace('$','')!r},{m[4].replace('$','') if m[4] else ''!r})", c['formula'])
        expr = expr.replace('<>', '!=').replace('^', '**')
        expr = re.sub(r'(?<![<>=!])=(?!=)', '==', expr)
        return self.evaluate(ast.parse(expr, mode='eval').body, sheet, ref)

    def evaluate(self, n, sheet, ref):
        ev = lambda x: self.evaluate(x, sheet, ref)
        if isinstance(n, ast.Constant): return n.value
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)): return (-1 if isinstance(n.op, ast.USub) else 1)*ev(n.operand)
        if isinstance(n, ast.BinOp): return {ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.Div:operator.truediv,ast.Pow:operator.pow}[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.Compare) and len(n.ops)==1: return {ast.Eq:operator.eq,ast.NotEq:operator.ne,ast.Lt:operator.lt,ast.LtE:operator.le,ast.Gt:operator.gt,ast.GtE:operator.ge}[type(n.ops[0])](ev(n.left),ev(n.comparators[0]))
        if not isinstance(n, ast.Call) or not isinstance(n.func, ast.Name): raise ValueError('Sintaxe não suportada')
        name = n.func.id
        if name == 'IF': return ev(n.args[1] if ev(n.args[0]) else n.args[2])
        if name == 'IFERROR':
            try: return ev(n.args[0])
            except (ZeroDivisionError, IndexError): return ev(n.args[1])
        args = [ev(x) for x in n.args]
        if name == 'REF':
            sh,a,b=args
            if not b: return self.value(sh,a)
            ac, ar = re.fullmatch(r'([A-Z]+)(\d+)',a).groups();bc,br=re.fullmatch(r'([A-Z]+)(\d+)',b).groups()
            return [[self.value(sh,col_name(c)+str(r)) for c in range(col_num(ac),col_num(bc)+1)] for r in range(int(ar),int(br)+1)]
        if name == 'COLUMN': return col_num(re.match('[A-Z]+',ref)[0])
        if name == 'INDEX':
            if args[1] < 1 or args[2] < 1: raise IndexError('Índice fora do intervalo')
            return args[0][int(args[1])-1][int(args[2])-1]
        if name == 'ROUND': return float(Decimal(str(args[0])).quantize(Decimal(10)**-int(args[1]), rounding=ROUND_HALF_UP))
        # N(): número passa, vazio ou texto vira zero (é o uso da Selic opcional da v12).
        if name == 'N': return args[0] if isinstance(args[0], (int, float)) and not isinstance(args[0], bool) else 0
        def flat(xs):
            for x in xs:
                if isinstance(x,list): yield from flat(x)
                else: yield x
        nums=list(flat(args))
        if name in ('SUM','MIN','MAX','AVERAGE'): return {'SUM':sum,'MIN':min,'MAX':max,'AVERAGE':lambda x:sum(x)/len(x)}[name](nums)
        raise ValueError('Função não suportada: '+name)

def months_from(start_year, start_month, n=12):
    return [f'{start_year+(start_month-1+i)//12}-{(start_month-1+i)%12+1:02}' for i in range(n)]

def read_rows(model, sheet, last, money, percent, cols=tuple(range(3, 15))):
    rows = []
    for r in range(12, last + 1):
        label = model.cells[sheet].get('B'+str(r),{}).get('value')
        first = model.cells[sheet].get('C'+str(r),{})
        if not isinstance(label, str) or not (first.get('formula') or isinstance(first.get('value'),(int,float))): continue
        rows.append({'row':r,'label':label.strip(),'format':'percent' if r in percent else 'money' if r in money else 'number','values':[model.value(sheet,col_name(c)+str(r)) for c in cols],'formulas':[model.cells[sheet].get(col_name(c)+str(r),{}).get('formula') for c in cols]})
    return rows

def projected_columns(model, sheet):
    """Colunas do projetado. Desde 28/09 a v12 alterna Projetado | Realizado por mês (C, E, G...);
    o realizado da planilha é retrato datado e não entra na fonte: a tela mede o seu do CRM."""
    if model.cells[sheet].get('D11', {}).get('value') == 'Realizado': return tuple(3 + 2*i for i in range(12))
    return tuple(range(3, 15))

def identities(by, contract_rows_integer):
    for i in range(12):
        if contract_rows_integer: assert by[41][i] == sum(by[r][i] for r in (38,39,40))
        else: assert abs(by[41][i]-sum(by[r][i] for r in (38,39,40)))<1e-8
        assert abs(by[29][i]-sum(by[r][i] for r in (25,26,27)))<1e-8
        assert abs(by[50][i]-sum(by[r][i] for r in (46,47,48,49)))<1e-8
        assert abs(by[58][i]-sum(by[r][i] for r in (54,55,56,57)))<1e-8
        assert abs(by[66][i]-by[58][i]-by[65][i])<1e-8

MONEY = {14} | set(range(46,60)) | set(range(64,68))
PERCENT = {30,31,36,42}

def build_v10(model, path):
    rows = read_rows(model, 'Forecast', 67, MONEY, PERCENT)
    by = {r['row']:r['values'] for r in rows}
    # Conferências independentes: fonte/screenshot e identidades mensais.
    assert by[41][0] == 8 and by[41][1] == 16 and by[28][0] == 818
    assert abs(by[35][0]-48.6)<0.01
    identities(by, True)
    return [{'id':'v10-2026-09-09','version':'v10 · dois aquários','source_name':path.name,'source_date':'2026-09-09','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'scope':'front','months':months_from(2026,9),'rows':rows,'note':'Plano de referência anterior à revisão dos gates. Preserva as premissas e o mix da planilha; não representa o estoque elegível atual nem uma nova promessa de fechamento.'}]

CENARIOS = [('Estimado', ''), ('Conservador', '-conservador'), ('Otimista', '-otimista')]
NOTA_V12 = {
    'Estimado': 'Forecast v12, cenário Estimado: premissas da planilha da parceria Diehl & Cella para a Cella (por faixa de faturamento e regime, base declarada medida em 28/09); Consultoria e Finance como na v10.',
    'Conservador': 'Forecast v12, cenário Conservador (aprovado em 28/09): êxito, honorários e conversão abaixo da planilha e o corte atual de R$ 25 mi para a Cella.',
    'Otimista': 'Forecast v12, cenário Otimista (aprovado em 28/09): êxito, honorários e conversão acima da planilha e entrada da Cella a partir de R$ 10 mi.',
}

def build_v12(model, path, source_date):
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    # A planilha da parceria, reproduzida: 1 empresa por faixa soma R$ 7.329.293,40.
    cf = model.cells['Cella por faixa']
    total = next(r for r in range(1, 200) if cf.get(f'B{r}', {}).get('value') == 'Total')
    assert abs(model.value('Cella por faixa', f'K{total}') - 7329293.4) < 0.01
    docs, out = {}, []
    for nome, sufixo in CENARIOS:
        sheet = f'Forecast {nome}'
        cols = projected_columns(model, sheet)
        rows = read_rows(model, sheet, 72, MONEY | {71, 72}, PERCENT, cols)
        by = {r['row']:r['values'] for r in rows}
        assert len(rows) >= 44 and 71 in by and 72 in by, (nome, len(rows))
        identities(by, False)
        # Desde 29/09 as contagens são inteiras (arredondamento acumulado): contrato, lead, reunião, oportunidade, estoque.
        for row in (15, 16, 17, 19, 22, 23, 24, 25, 26, 27, 28, 29, 35, 37, 38, 39, 40, 41):
            if row in by: assert all(abs(v - round(v)) < 1e-9 for v in by[row]), (nome, row, by[row])
        # Honorários da parceria = contratos de Cella × honorário médio; receita da Planning = × fatia.
        for i in range(12):
            if by[38][i]: assert by[71][i] >= by[46][i] - 1e-6
        docs[nome] = rows
        out.append({'id':f'v12-{source_date}{sufixo}','version':f'v12 · {nome}','scenario':nome,'default':nome=='Estimado','sheet':sheet,'columns':[col_name(c) for c in cols],
                    'source_name':path.name,'source_date':source_date,'sha256':sha,'scope':'front','months':months_from(2026,9),'rows':rows,'note':NOTA_V12[nome]})
    # Conservador ≤ Estimado ≤ Otimista em contratos e receita assinada, como os cenários foram montados.
    tot = lambda nome, row: sum(next(r for r in docs[nome] if r['row']==row)['values'])
    for row in (41, 50, 71):
        assert tot('Conservador', row) <= tot('Estimado', row) <= tot('Otimista', row), row
    return out

def build(path, source_date='2026-09-28', drive_url=None, drive_updated_at=None):
    model = Model(path)
    docs = build_v12(model, path, source_date) if all(f'Forecast {nome}' in model.cells for nome, _ in CENARIOS) else build_v10(model, path)
    if drive_url:
        # A tela só mostra o botão para planilha Google (forecast-model.tsx).
        assert drive_url.startswith('https://docs.google.com/spreadsheets/d/'), drive_url
        for d in docs: d.update(drive_url=drive_url, drive_updated_at=drive_updated_at)
    return docs

def upsert_sql(docs):
    parts = []
    for d in docs:
        payload = json.dumps(d, ensure_ascii=False, allow_nan=False)
        assert '$forecast$' not in payload
        parts.append(f"insert into ops.monetizacao_forecasts (id, payload, imported_at) values ({json.dumps(d['id'])[1:-1]!r}, $forecast${payload}$forecast$::jsonb, now()) on conflict (id) do update set payload = excluded.payload, imported_at = excluded.imported_at;")
    return 'begin;\n' + '\n'.join(parts) + '\ncommit;\n'

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--output',required=True,type=Path)
    p.add_argument('--source-date',default='2026-09-28');p.add_argument('--sql',type=Path)
    p.add_argument('--drive-url');p.add_argument('--drive-updated-at');a=p.parse_args()
    docs=build(a.source,a.source_date,a.drive_url,a.drive_updated_at);a.output.write_text(json.dumps(docs,ensure_ascii=False,allow_nan=False))
    if a.sql: a.sql.write_text(upsert_sql(docs))
    print(json.dumps([{'id':d['id'],'version':d['version'],'months':len(d['months']),'rows':len(d['rows'])} for d in docs],ensure_ascii=False))
