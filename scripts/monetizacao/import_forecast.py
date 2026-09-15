"""Importa a referência v10 sem alterar a planilha ou suas premissas.

O XLSX original não possui cache de fórmulas. Avaliador restrito às operações
observadas no modelo: sintaxe não suportada falha, nunca vira zero silencioso.
Uso: python import_forecast.py arquivo.xlsx --output /caminho/privado.json
"""
import argparse, ast, hashlib, json, operator, re, zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
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
            for s in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
                cells = {}
                for c in ET.fromstring(z.read('xl/worksheets/sheet'+s.attrib['sheetId']+'.xml')).findall('.//s:sheetData/s:row/s:c', NS):
                    v, f, inline = c.find('s:v', NS), c.find('s:f', NS), c.find('s:is', NS)
                    value = v.text if v is not None else None
                    if c.attrib.get('t') == 's': value = strings[int(value)]
                    elif c.attrib.get('t') == 'inlineStr': value = ''.join(inline.itertext()) if inline is not None else None
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
        def flat(xs):
            for x in xs:
                if isinstance(x,list): yield from flat(x)
                else: yield x
        nums=list(flat(args))
        if name in ('SUM','MIN','MAX','AVERAGE'): return {'SUM':sum,'MIN':min,'MAX':max,'AVERAGE':lambda x:sum(x)/len(x)}[name](nums)
        raise ValueError('Função não suportada: '+name)

def build(path):
    model = Model(path)
    months = [f'{2026+(8+i)//12}-{(8+i)%12+1:02}' for i in range(12)]
    rows = []
    for r in range(12,68):
        label = model.cells['Forecast'].get('B'+str(r),{}).get('value')
        first = model.cells['Forecast'].get('C'+str(r),{})
        if not label or not (first.get('formula') or isinstance(first.get('value'),(int,float))): continue
        rows.append({'row':r,'label':label.strip(),'format':'percent' if r in (30,31,36,42) else 'money' if r==14 or 46<=r<=59 or 64<=r<=67 else 'number','values':[model.value('Forecast',col_name(c)+str(r)) for c in range(3,15)],'formulas':[model.cells['Forecast'].get(col_name(c)+str(r),{}).get('formula') for c in range(3,15)]})
    by = {r['row']:r['values'] for r in rows}
    # Conferências independentes: fonte/screenshot e identidades mensais.
    assert by[41][0] == 8 and by[41][1] == 16 and by[28][0] == 818
    assert abs(by[35][0]-48.6)<0.01
    for i in range(12):
        assert by[41][i] == sum(by[r][i] for r in (38,39,40))
        assert abs(by[29][i]-sum(by[r][i] for r in (25,26,27)))<1e-8
        assert abs(by[50][i]-sum(by[r][i] for r in (46,47,48,49)))<1e-8
        assert abs(by[58][i]-sum(by[r][i] for r in (54,55,56,57)))<1e-8
        assert abs(by[66][i]-by[58][i]-by[65][i])<1e-8
    return {'id':'v10-2026-09-09','version':'v10 · dois aquários','source_name':path.name,'source_date':'2026-09-09','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'scope':'front','months':months,'rows':rows,'note':'Plano de referência anterior à revisão dos gates. Preserva as premissas e o mix da planilha; não representa o estoque elegível atual nem uma nova promessa de fechamento.'}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    doc=build(a.source);a.output.write_text(json.dumps(doc,ensure_ascii=False,allow_nan=False))
    print(json.dumps({'version':doc['version'],'months':len(doc['months']),'rows':len(doc['rows']),'checks':'source Sep/Oct + monthly work/contracts/revenue/cash/margin reconciled'}))
