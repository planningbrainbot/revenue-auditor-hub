"""Normaliza evidências da API Driva/Kipflow; ausência nunca equivale a False.

Entrada: arquivo privado account_key -> CNPJs e respostas privadas do dataset complete.
Não contém chaves, clientes nem chamadas automáticas ao CRM.
"""
import re
import unicodedata

SOURCE = 'Driva / Kipflow'


def normal(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or ''))
                   if not unicodedata.combining(c)).lower().strip()


def valid_cnpj(value):
    if not re.fullmatch(r'\d{14}', value) or len(set(value)) == 1:
        return False
    for n, weights in [(12, [5,4,3,2,9,8,7,6,5,4,3,2]), (13, [6,5,4,3,2,9,8,7,6,5,4,3,2])]:
        remainder = sum(int(x)*w for x, w in zip(value[:n], weights)) % 11
        if int(value[n]) != (0 if remainder < 2 else 11-remainder):
            return False
    return True


def normalize_record(cnpj, response):
    row = {'cnpj': cnpj, 'queried_at': response.get('queried_at'),
           'status': 'pending', 'non_simples': None, 'regime': None}
    if not valid_cnpj(cnpj):
        return {**row, 'status': 'invalid_cnpj'}
    if response.get('http') != 200 or response.get('error_code'):
        return {**row, 'status': 'not_found' if response.get('http') == 404 else 'pending'}
    data = response.get('data') or {}
    if str(data.get('cnpj')).zfill(14) != cnpj:
        return {**row, 'status': 'conflict'}
    simple, mei = data.get('opcao_pelo_simples'), data.get('opcao_pelo_mei')
    regimes = {normal(data.get(k)) for k in ['forma_de_tributacao', 'forma_de_tributacao_ajustada']}
    known_outside = {'lucro real', 'lucro presumido', 'lucro arbitrado', 'imune de irpj', 'isenta de irpj'}
    regimes.discard('')
    explicit_outside = bool(regimes & known_outside)
    explicit_simple = any('simples' in r or r == 'mei' for r in regimes)
    conflict = (mei is True and simple is False) or (simple is True and explicit_outside) or (simple is False and explicit_simple)
    if conflict:
        outside, regime = None, None
    elif simple is True or mei is True or explicit_simple:
        outside, regime = False, 'MEI' if mei is True else 'Simples Nacional'
    elif simple is False or explicit_outside:
        outside = True
        regime = next(iter(regimes)).title().replace('Irpj', 'IRPJ') if len(regimes) == 1 and regimes <= known_outside else None
    else:
        outside, regime = None, None
    return {**row, 'status': 'conflict' if conflict else 'enriched', 'non_simples': outside,
            'regime': regime, 'raw_regime': data.get('forma_de_tributacao'),
            'adjusted_regime': data.get('forma_de_tributacao_ajustada'),
            'simples': simple if isinstance(simple, bool) else None,
            'mei': mei if isinstance(mei, bool) else None,
            'revenue_estimate': data.get('faturamento'),
            'group_revenue_estimate': data.get('faturamento_grupo'),
            'group_revenue_band': data.get('faixa_faturamento_grupo'),
            'segment': data.get('ramo_de_atividade') or data.get('segmento'),
            'cnae': data.get('cnae_principal_desc_subclasse'),
            'registration_status': data.get('situacao_cadastral'),
            'source_updated_at': data.get('data_atualizacao') or data.get('updated_at')}


def summarize(cnpjs, responses, at):
    records = [normalize_record(c, responses.get(c, {})) for c in sorted(set(cnpjs))]
    states = {r['non_simples'] for r in records}
    outside = next(iter(states)) if len(states) == 1 and None not in states else None
    conflict = any(r['status'] == 'conflict' for r in records) or (True in states and False in states)
    if conflict:
        outside = None
    regimes = {r['regime'] for r in records}
    regime = next(iter(regimes)) if len(regimes) == 1 and None not in regimes and not conflict else None
    segments = {r.get('segment') for r in records}
    # Não agrega faturamentos de CNPJs nem soma filiais/grupos, evitando dupla contagem.
    band = records[0].get('group_revenue_band') if len(records) == 1 else None
    summary = {'source': SOURCE, 'queried_at': at, 'cnpjs_total': len(records),
               'cnpjs_found': sum(r['status'] == 'enriched' for r in records),
               'status': 'missing_cnpj' if not records else 'conflict' if conflict else
               'enriched' if all(r['status'] == 'enriched' for r in records) else 'partial',
               'non_simples': outside, 'regime': regime, 'regime_conflict': conflict,
               'group_revenue_band': band, 'revenue_estimated': True,
               'segment': next(iter(segments)) if len(segments) == 1 and None not in segments else None}
    return summary, records


def build_patch(profile, cnpjs, responses, at):
    """Complementa lacunas; não substitui faturamento declarado nem origem da carteira."""
    summary, records = summarize(cnpjs, responses, at)
    patch = {'driva': summary}
    existing = normal(profile.get('regime'))
    new = normal(summary['regime'])
    conflict = summary['regime_conflict'] or bool(existing and new and existing != new)
    if not existing and summary['regime']:
        patch.update(regime=summary['regime'], regime_source=SOURCE, regime_at=at)
    if conflict:
        patch['regime_conflict'] = True
    if not profile.get('segment') and summary['segment']:
        patch.update(segment=summary['segment'], segment_source=SOURCE, segment_at=at)
    proof = profile.get('consultoria_origin') or {}
    if proof.get('status') == 'retroativa' and summary['non_simples'] is not None and not conflict:
        patch['consultoria_origin'] = {**proof, 'non_simples_confirmed': summary['non_simples'],
                                      'regime_source': SOURCE, 'regime_checked_at': at}
    return patch, records
