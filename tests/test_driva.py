import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/monetizacao'))
from driva import summarize, build_patch, valid_cnpj

# Identificador público de exemplo da documentação do fornecedor, não cliente da carteira.
CNPJ = '35965725000107'
AT = '2026-09-16T18:00:00Z'
def reply(**data):
    return {'http': 200, 'queried_at': AT, 'data': {'cnpj': int(CNPJ), **data}}

class DrivaTests(unittest.TestCase):
    def test_missing_boolean_is_unknown(self):
        result, _ = summarize([CNPJ], {CNPJ: reply()}, AT)
        self.assertIsNone(result['non_simples'])

    def test_false_is_evidence_even_without_specific_regime(self):
        result, _ = summarize([CNPJ], {CNPJ: reply(opcao_pelo_simples=False, opcao_pelo_mei=False)}, AT)
        self.assertIs(result['non_simples'], True)
        self.assertIsNone(result['regime'])

    def test_simples_and_contradiction(self):
        result, _ = summarize([CNPJ], {CNPJ: reply(opcao_pelo_simples=True)}, AT)
        self.assertIs(result['non_simples'], False)
        result, _ = summarize([CNPJ], {CNPJ: reply(opcao_pelo_simples=True, forma_de_tributacao='LUCRO REAL')}, AT)
        self.assertIsNone(result['non_simples'])
        self.assertTrue(result['regime_conflict'])

    def test_identity_and_incomplete_group_never_approve(self):
        result, _ = summarize([CNPJ], {CNPJ: reply(cnpj=1, opcao_pelo_simples=False)}, AT)
        self.assertIsNone(result['non_simples'])
        result, _ = summarize([CNPJ, '00000000000191'], {CNPJ: reply(opcao_pelo_simples=False)}, AT)
        self.assertIsNone(result['non_simples'])
        self.assertFalse(valid_cnpj('12345678901234'))

    def test_enrichment_preserves_revenue_origin_and_existing_segment(self):
        profile = {'band': 'faixa declarada', 'segment': 'Indústria', 'old_base': True,
                   'consultoria_origin': {'status': 'retroativa', 'checked_at': AT}}
        patch, _ = build_patch(profile, [CNPJ], {CNPJ: reply(opcao_pelo_simples=False,
            forma_de_tributacao='LUCRO PRESUMIDO', faixa_faturamento_grupo='20M A 30M', segmento='SERVICOS')}, AT)
        self.assertNotIn('band', patch)
        self.assertNotIn('segment', patch)
        self.assertNotIn('old_base', patch)
        self.assertEqual(patch['regime'], 'Lucro Presumido')
        self.assertTrue(patch['consultoria_origin']['non_simples_confirmed'])
        self.assertTrue(patch['driva']['revenue_estimated'])
        self.assertEqual(patch['driva']['group_revenue_band'], '20M A 30M')

if __name__ == '__main__':
    unittest.main()
