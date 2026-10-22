// Carga do faturamento do SPED: senha do dia, retomada da carga e conversão da página em linhas.
import test from "node:test";
import assert from "node:assert/strict";
import {
  decidirCarga,
  diaSP,
  linhasDaPagina,
  senhaDoDia,
  ultimaCompetencia,
} from "../supabase/functions/faturamento-sped/logica.ts";

test("senha do dia segue a regra do Silas, no dia de São Paulo", () => {
  // 22/10/2026 às 12h de Brasília: sufixo 23 + 9, como no exemplo do Silas.
  assert.equal(senhaDoDia("BASE", new Date("2026-10-22T15:00:00Z")), "BASE239");
  // 01/01: dia 2, mês 0, sem zero à esquerda.
  assert.equal(senhaDoDia("BASE", new Date("2027-01-01T12:00:00Z")), "BASE20");
  // 31/03: dia 32.
  assert.equal(senhaDoDia("BASE", new Date("2026-03-31T12:00:00Z")), "BASE322");
  // 02h UTC de 23/10 ainda é 22/10 em São Paulo.
  assert.equal(senhaDoDia("BASE", new Date("2026-10-23T02:00:00Z")), "BASE239");
  assert.equal(diaSP(new Date("2026-10-23T02:00:00Z")).data, "2026-10-22");
});

test("carga: nova, continua no mesmo dia, fecha quando já terminou", () => {
  const agora = new Date("2026-10-22T07:00:00Z");
  assert.deepEqual(decidirCarga(null, agora), { acao: "nova", pagina: 1 });
  assert.deepEqual(
    decidirCarga({ id: 5, iniciada_em: "2026-10-22T06:00:00Z", status: "rodando", proxima_pagina: 12 }, agora),
    { acao: "continuar", pagina: 12 },
  );
  assert.deepEqual(
    decidirCarga({ id: 5, iniciada_em: "2026-10-22T06:00:00Z", status: "erro", proxima_pagina: 30 }, agora),
    { acao: "continuar", pagina: 30 },
  );
  assert.equal(
    decidirCarga({ id: 5, iniciada_em: "2026-10-22T06:00:00Z", status: "ok", proxima_pagina: 67 }, agora).acao,
    "feita",
  );
  // Carga de ontem que não terminou: fica interrompida e começa outra.
  assert.deepEqual(
    decidirCarga({ id: 4, iniciada_em: "2026-10-21T06:00:00Z", status: "rodando", proxima_pagina: 40 }, agora),
    { acao: "nova", pagina: 1, interromper: 4 },
  );
  assert.deepEqual(
    decidirCarga({ id: 4, iniciada_em: "2026-10-21T06:00:00Z", status: "ok", proxima_pagina: 67 }, agora),
    { acao: "nova", pagina: 1 },
  );
});

test("página vira linhas: só ok e aguardando, CNPJ de 14 dígitos, competência no dia 1", () => {
  const linhas = linhasDaPagina(
    [
      {
        cnpj: "11222333000181",
        raiz: "11222333",
        meses: [
          {
            competencia: "2026-08",
            status: "ok",
            vendas: 812345.67,
            devolucoes: 12345,
            servicos: 54000,
            faturamento: 854000.67,
            fontes: ["efd_icms_ipi", "efd_contribuicoes"],
            entregue_em: "2026-09-18",
            baixado_em: "2026-09-22",
            retificado: false,
          },
          { competencia: "2026-09", status: "aguardando_entrega" },
          { competencia: "2025-03", status: "aguardando_entrega" },
          { competencia: "2026-07", status: "sped_fora_base_motivo_diverso" },
          { competencia: "2026-13", status: "ok", faturamento: 1 },
        ],
      },
      { cnpj: "123", raiz: "123", meses: [{ competencia: "2026-08", status: "ok", faturamento: 1 }] },
    ],
    9,
    "2026-09",
  );
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas[0], {
    cnpj: "11222333000181",
    raiz: "11222333",
    competencia: "2026-08-01",
    status: "ok",
    vendas: 812345.67,
    devolucoes: 12345,
    servicos: 54000,
    faturamento: 854000.67,
    fontes: ["efd_icms_ipi", "efd_contribuicoes"],
    entregue_em: "2026-09-18",
    baixado_em: "2026-09-22",
    retificado: false,
    carga_id: 9,
  });
  // Mês aguardando vira linha sem valor: nunca zero.
  assert.equal(linhas[1].status, "aguardando_entrega");
  assert.equal(linhas[1].faturamento, null);
});

test("última competência é o mês anterior ao de São Paulo", () => {
  assert.equal(ultimaCompetencia(new Date("2026-10-22T15:00:00Z")), "2026-09");
  assert.equal(ultimaCompetencia(new Date("2027-01-10T12:00:00Z")), "2026-12");
  // 01/11 às 01h UTC ainda é 31/10 em São Paulo.
  assert.equal(ultimaCompetencia(new Date("2026-11-01T01:00:00Z")), "2026-09");
});
