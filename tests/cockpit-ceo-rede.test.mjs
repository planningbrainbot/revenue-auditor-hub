import test from "node:test";
import assert from "node:assert/strict";
import { resumirRedeUnidades } from "../src/lib/cockpit-ceo/rede.ts";
import { montarLeituraRede } from "../src/lib/cockpit-ceo/receita-fontes.ts";
import { resumirLeitura } from "../src/lib/cockpit-ceo/receita.ts";

const HOJE = "2026-09-22";
const unidades = [
  { id: 1, nome: "Unidade Um", tipo: "regional", inauguracao: "2025-01-01" },
  { id: 2, nome: "Unidade Dois", tipo: "regional", inauguracao: "2025-01-01" },
  { id: 3, nome: "Unidade Três", tipo: "regional", inauguracao: "2025-01-01" },
];
const ap = (unidade_id, mes, receita_base, royalties_valor, csc = 0) => ({
  unidade_id,
  mes,
  status: "confirmado",
  receita_base,
  receita_base_antiga: 0,
  royalties_valor,
  csc_valor_fixo: csc,
  csc_base_antiga_valor: 0,
});

test("Rede por unidade: janela de meses completos, participação soma 100%, concentração e take rate", () => {
  const leitura = montarLeituraRede({
    acesso: true,
    unidades,
    apuracoes: [
      // Fora da janela (maio tem só uma unidade apurada → parcial e quebra a janela).
      ap(1, "2026-05-01", 999, 99),
      ap(1, "2026-06-01", 600, 60, 10),
      ap(2, "2026-06-01", 300, 30),
      ap(3, "2026-06-01", 100, 10),
      ap(1, "2026-07-01", 600, 60, 10),
      ap(2, "2026-07-01", 300, 30),
      ap(3, "2026-07-01", 100, 10),
      ap(1, "2026-08-01", 600, 60, 10),
      ap(2, "2026-08-01", 300, 30),
      ap(3, "2026-08-01", 100, 10),
    ],
  });
  const r = resumirRedeUnidades(leitura, resumirLeitura(leitura, HOJE));
  assert.deepEqual(r.janela, { de: "2026-06", ate: "2026-08", meses: 3 });
  assert.deepEqual(
    r.linhas.map((l) => [l.unidade, l.faturamento, l.royaltiesCsc]),
    [
      ["Unidade Um", 1800, 210],
      ["Unidade Dois", 900, 90],
      ["Unidade Três", 300, 30],
    ],
  );
  assert.ok(Math.abs(r.somaParticipacoes - 1) < 1e-12);
  assert.ok(Math.abs(r.top1 - 0.6) < 1e-12);
  assert.ok(Math.abs(r.top3 - 1) < 1e-12);
  assert.ok(Math.abs(r.hhi - (0.36 + 0.09 + 0.01)) < 1e-12);
  assert.ok(Math.abs(r.linhas[0].takeRate - 210 / 1800) < 1e-12);
  assert.equal(r.estado, "parcial", "3 de 12 meses");
});

test("Sem janela de meses completos, nada de participação inventada", () => {
  const leitura = montarLeituraRede({ acesso: false, unidades: [], apuracoes: [] });
  const r = resumirRedeUnidades(leitura, resumirLeitura(leitura, HOJE));
  assert.equal(r.estado, "acesso_insuficiente");
  assert.deepEqual(r.linhas, []);
  assert.equal(r.top1, null);
  assert.equal(r.hhi, null);
});
