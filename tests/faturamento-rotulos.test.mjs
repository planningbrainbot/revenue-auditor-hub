// Portal de Faturamento: rótulos, próximo passo, recorte, procedência e formatos
// (src/lib/faturamento/rotulos.ts e formato.ts). Contrato docs/design/contratos/faturamento.md §1.2, §2 e §3.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ETAPAS_EM_ABERTO,
  GRUPO_A_FATURAR,
  SITUACAO,
  fraseLeituraOmie,
  fraseRecorte,
  fraseSimulacao,
  linhasDeAtencao,
  linhasDeNovidades,
  podePedir,
  procedenciaFaturamento,
  proximaLeitura,
  proximoPasso,
  rotuloSituacao,
  rotuloSituacaoFiltro,
  tipoRecorteDoContexto,
  tomSituacao,
} from "../src/lib/faturamento/rotulos.ts";
import { SITUACOES } from "../src/lib/faturamento/tipos.ts";
import { buscaDoFiltro, filtroDaBusca } from "../src/lib/faturamento/filtro.ts";
import {
  contagem,
  dataCompleta,
  deslocarMes,
  diaEHora,
  diaMes,
  diaSP,
  dinheiro,
  documento,
  horaSP,
  listaNomes,
  mesCorrenteSP,
  primeiroNome,
  rotuloMes,
} from "../src/lib/faturamento/formato.ts";

const HOJE = "2026-10-22";

const passo = (o) => ({
  acao: null,
  quem: null,
  pessoa: null,
  voce: false,
  desde: null,
  data: null,
  tentar_em: null,
  ...o,
});

test("toda situação do banco tem rótulo e tom, e os tons são os do contrato §1.2", () => {
  assert.deepEqual(Object.keys(SITUACAO).sort(), [...SITUACOES].sort());
  const esperado = {
    rascunho: ["Rascunho", "info"],
    aguardando_ok: ["Aguardando OK", "atencao"],
    devolvido: ["Devolvido", "atencao"],
    na_fila_omie: ["Na fila do Omie", "neutro"],
    simulado: ["Simulado", "info"],
    erro_omie: ["Erro no Omie", "perigo"],
    os_criada: ["OS criada", "info"],
    em_conferencia: ["Em conferência", "info"],
    faturado: ["Faturado", "sucesso"],
    recebido: ["Recebido", "sucesso"],
    em_atraso: ["Em atraso", "perigo"],
    cancelamento_pedido: ["Cancelamento pedido", "atencao"],
    cancelado: ["Cancelado", "neutro"],
  };
  for (const [s, [rotulo, tom]] of Object.entries(esperado)) {
    assert.equal(rotuloSituacao(s), rotulo, s);
    assert.equal(tomSituacao(s), tom, s);
  }
});

test("situação desconhecida passa como veio, em tom neutro (nunca some)", () => {
  assert.equal(rotuloSituacao("nova_situacao"), "nova_situacao");
  assert.equal(tomSituacao("nova_situacao"), "neutro");
  assert.equal(rotuloSituacaoFiltro("a_faturar"), "A faturar");
});

test("simulado é informação, não alarme (§1.3)", () => {
  assert.equal(tomSituacao("simulado"), "info");
});

test("grupo A faturar e etapas em aberto seguem o API.md §1.2", () => {
  assert.deepEqual(GRUPO_A_FATURAR, [
    "aguardando_ok",
    "na_fila_omie",
    "erro_omie",
    "os_criada",
    "em_conferencia",
  ]);
  assert.ok(!GRUPO_A_FATURAR.includes("simulado"));
  assert.deepEqual(ETAPAS_EM_ABERTO, [
    "aguardando_ok",
    "devolvido",
    "na_fila_omie",
    "simulado",
    "erro_omie",
    "os_criada",
    "em_conferencia",
  ]);
});

test("próximo passo: as frases do contrato §3", () => {
  // "OK de Hugo · desde 21/10" (o desde é momento UTC; 21/10 12:00 UTC = 21/10 em São Paulo)
  assert.deepEqual(
    proximoPasso(
      passo({
        acao: "dar_ok",
        quem: "pessoa",
        pessoa: { id: "h", nome: "Hugo Silva" },
        desde: "2026-10-21T12:00:00+00:00",
      }),
      HOJE,
    ),
    { quem: "Hugo", voce: false, texto: "OK de Hugo · desde 21/10" },
  );
  // "Você corrige · devolvido em 21/10"
  assert.deepEqual(
    proximoPasso(
      passo({ acao: "corrigir", quem: "pessoa", voce: true, desde: "2026-10-21T15:00:00+00:00" }),
      HOJE,
    ),
    { quem: "Você", voce: true, texto: "Você corrige · devolvido em 21/10" },
  );
  // "Tesouraria confere · vence 24/10"
  assert.equal(
    proximoPasso(passo({ acao: "conferir", quem: "tesouraria", data: "2026-10-24" }), HOJE).texto,
    "Tesouraria confere · vence 24/10",
  );
  // "Aguarda pagamento · vence 10/11"
  const pag = proximoPasso(
    passo({ acao: "aguardar_pagamento", quem: "cliente", data: "2026-11-10" }),
    HOJE,
  );
  assert.equal(pag.texto, "Aguarda pagamento · vence 10/11");
  assert.equal(pag.quem, "Cliente");
  // "Omie tenta de novo às 14:20" (17:20 UTC = 14:20 em São Paulo, no mesmo dia)
  assert.deepEqual(
    proximoPasso(
      passo({ acao: "aguardar_omie", quem: "omie", tentar_em: "2026-10-22T17:20:00+00:00" }),
      HOJE,
    ),
    {
      quem: "Omie",
      voce: false,
      texto: "Omie tenta de novo às 14:20",
    },
  );
});

test("próximo passo: data passada vira 'venceu', tentativa de outro dia leva a data, sem passo é travessão", () => {
  assert.equal(
    proximoPasso(passo({ acao: "aguardar_pagamento", quem: "cliente", data: "2026-10-10" }), HOJE)
      .texto,
    "Aguarda pagamento · venceu 10/10",
  );
  assert.equal(
    proximoPasso(
      passo({ acao: "aguardar_omie", quem: "omie", tentar_em: "2026-10-23T12:00:00+00:00" }),
      HOJE,
    ).texto,
    "Omie tenta de novo em 23/10 às 09:00",
  );
  assert.equal(
    proximoPasso(passo({ acao: "aguardar_omie", quem: "omie" }), HOJE).texto,
    "Na fila do Omie",
  );
  assert.deepEqual(proximoPasso(null, HOJE), { quem: null, texto: "—", voce: false });
  assert.deepEqual(proximoPasso(passo({ acao: null }), HOJE), {
    quem: null,
    texto: "—",
    voce: false,
  });
});

test("próximo passo: quem age pela tesouraria, reenvio e cancelamento", () => {
  assert.equal(
    proximoPasso(
      passo({ acao: "reenviar", quem: "tesouraria", desde: "2026-10-22T13:12:00+00:00" }),
      HOJE,
    ).texto,
    "Tesouraria reenvia · erro desde 22/10",
  );
  assert.equal(
    proximoPasso(
      passo({ acao: "faturar", quem: "tesouraria", voce: true, data: "2026-10-24" }),
      HOJE,
    ).texto,
    "Você fatura · vence 24/10",
  );
  assert.equal(
    proximoPasso(passo({ acao: "confirmar_cancelamento", quem: "tesouraria" }), HOJE).texto,
    "Tesouraria confirma o cancelamento",
  );
  // Dono sem nome cadastrado: o e-mail vira o primeiro nome.
  assert.equal(
    proximoPasso(
      passo({
        acao: "dar_ok",
        quem: "pessoa",
        pessoa: { id: "x", nome: "ana.carvalhais@planning.com.br" },
      }),
      HOJE,
    ).texto,
    "OK de ana.carvalhais",
  );
});

test("recorte: o mais largo vale (API.md §1.2)", () => {
  const e = (papeis) => ({ meus_papeis: papeis });
  assert.equal(
    tipoRecorteDoContexto({
      papeis: { tesouraria: true, controladoria: true },
      emissoras: [e(["dono"])],
    }),
    "tesouraria",
  );
  assert.equal(
    tipoRecorteDoContexto({ papeis: { tesouraria: false, controladoria: true }, emissoras: [] }),
    "controladoria",
  );
  assert.equal(
    tipoRecorteDoContexto({
      papeis: { tesouraria: false, controladoria: false },
      emissoras: [e(["dono"]), e(["gestor"])],
    }),
    "gestor",
  );
  assert.equal(
    tipoRecorteDoContexto({
      papeis: { tesouraria: false, controladoria: false },
      emissoras: [e(["solicitante"])],
    }),
    "pessoal",
  );
});

test("universo da descrição, por papel (contrato §2)", () => {
  assert.equal(
    fraseRecorte("pessoal", ["DOC", "PIS"]),
    "Seus pedidos como dono ou solicitante · DOC e PIS",
  );
  assert.equal(fraseRecorte("gestor", ["DOC"]), "Todos os pedidos da DOC (você é gestor)");
  assert.equal(
    fraseRecorte("gestor", ["DOC", "PIS"]),
    "Todos os pedidos de DOC e PIS (você é gestor)",
  );
  assert.equal(
    fraseRecorte("tesouraria", ["DOC", "PIS", "PRJ"]),
    "Todas as empresas do seu recorte (tesouraria) · DOC, PIS e PRJ",
  );
  assert.equal(
    fraseRecorte("controladoria", ["A", "B", "C", "D", "E"]),
    "Todas as empresas do seu recorte (controladoria) · 5 empresas",
  );
  assert.equal(fraseRecorte("pessoal", []), "Seus pedidos como dono ou solicitante");
});

test("simulação na procedência (§1.3)", () => {
  assert.equal(fraseSimulacao(["DOC", "PIS"]), "DOC e PIS em simulação: nada é gravado no Omie");
  assert.equal(fraseSimulacao(["DOC"]), "DOC em simulação: nada é gravado no Omie");
  assert.equal(fraseSimulacao([]), null);
});

test("leitura do Omie: lida, falhou depois, parada há mais de 8 h em dia útil, nunca lida", () => {
  const agora = new Date("2026-10-22T17:00:00Z"); // quinta, 14:00 em São Paulo
  const omie = (ok, falha) => ({
    omie: {
      indisponivel: false,
      motivo: null,
      bloqueada_ate: null,
      ultimo_ok_em: ok,
      ultima_falha_em: falha,
    },
  });
  assert.equal(fraseLeituraOmie([omie(null, null)], agora), "situação do Omie ainda não lida");
  assert.equal(
    fraseLeituraOmie(
      [omie("2026-10-22T15:00:00Z", null), omie("2026-10-22T13:00:00Z", null)],
      agora,
    ),
    "situação do Omie lida às 12:00",
  );
  assert.equal(
    fraseLeituraOmie([omie("2026-10-22T13:00:00Z", "2026-10-22T16:00:00Z")], agora),
    "situação do Omie de 22/10 às 10:00, a leitura seguinte falhou",
  );
  assert.equal(
    fraseLeituraOmie([omie("2026-10-21T20:00:00Z", null)], agora),
    "situação do Omie de 21/10 às 17:00, sem leitura há mais de 8 h",
  );
  // Sábado não conta como dia útil: só diz quando foi lida.
  assert.equal(
    fraseLeituraOmie([omie("2026-10-23T20:00:00Z", null)], new Date("2026-10-24T17:00:00Z")),
    "situação do Omie lida em 23/10 às 17:00",
  );
  assert.equal(
    fraseLeituraOmie([omie(null, "2026-10-22T16:00:00Z")], agora),
    "a leitura do Omie falhou às 13:00",
  );
});

test("próxima leitura do Omie: 8h, 12h e 16h de São Paulo, só em dia útil", () => {
  // 22/10/2026 é quinta-feira; São Paulo é UTC-3.
  assert.equal(proximaLeitura(new Date("2026-10-22T10:30:00Z")), "às 08:00");
  assert.equal(proximaLeitura(new Date("2026-10-22T11:00:00Z")), "às 12:00");
  assert.equal(proximaLeitura(new Date("2026-10-22T15:00:00Z")), "às 16:00");
  // Depois das 16h passa para o dia seguinte; na sexta à noite, para a segunda.
  assert.equal(proximaLeitura(new Date("2026-10-22T19:01:00Z")), "em 23/10 às 08:00");
  assert.equal(proximaLeitura(new Date("2026-10-23T20:00:00Z")), "em 26/10 às 08:00");
  assert.equal(proximaLeitura(new Date("2026-10-24T13:00:00Z")), "em 26/10 às 08:00");
});

test("o que pede atenção: ordem, papéis e só pendência com pedido (contrato §2, item 3)", () => {
  const pend = (q, f) => ({ quantidade: q, filtro: f });
  const pendencias = {
    ok_a_dar: pend(2, { pendencia: "ok" }),
    devolvidos: pend(1, { pendencia: "devolvido" }),
    erro_omie: pend(1, { pendencia: "erro" }),
    para_faturar: pend(4, { situacao: ["os_criada", "simulado", "em_conferencia"] }),
  };
  const quemPede = linhasDeAtencao({ papeis: { pede: true, tesouraria: true }, pendencias });
  assert.deepEqual(
    quemPede.map((l) => l.chave),
    ["erro_omie", "ok_a_dar", "devolvidos"],
  );
  assert.deepEqual(quemPede[1].filtro, { pendencia: "ok" });

  const soTesouraria = linhasDeAtencao({ papeis: { pede: false, tesouraria: true }, pendencias });
  // Só tesouraria: o erro no Omie abre a Fila em "Todas" com a higiene de erro (o total bate); quem pede, Pedidos.
  assert.deepEqual(soTesouraria[0].fila, { emissora: "todas", higiene: "erro" });
  assert.equal(quemPede[0].fila, undefined);
  assert.deepEqual(
    soTesouraria.map((l) => l.chave),
    ["erro_omie", "para_faturar"],
  );
  // "Para faturar" abre a Fila com o grupo Em conferência: o total da Fila bate com OS criada + Simulado +
  // Em conferência, a definição de fat_contexto (revisão da E1, §3).
  assert.equal(soTesouraria[1].acao, "Abrir a fila");
  assert.deepEqual(soTesouraria[1].fila, {
    emissora: "todas",
    situacao: "para_faturar",
    incluir: "em_conferencia",
  });

  const nada = linhasDeAtencao({
    papeis: { pede: true, tesouraria: false },
    pendencias: {
      ok_a_dar: pend(0, {}),
      devolvidos: pend(0, {}),
      erro_omie: pend(0, {}),
      para_faturar: null,
    },
  });
  assert.deepEqual(nada, []);
});

test("formatos: dinheiro com centavos e travessão para ausência (N4)", () => {
  assert.equal(dinheiro(1500), "R$ 1.500,00");
  assert.equal(dinheiro(33.33), "R$ 33,33");
  assert.equal(dinheiro(0), "R$ 0,00");
  assert.equal(dinheiro(null), "—");
  assert.equal(dinheiro(undefined), "—");
  assert.equal(dinheiro(Number.NaN), "—");
  assert.equal(contagem(1, "pedido"), "1 pedido");
  assert.equal(contagem(3, "parcela"), "3 parcelas");
  assert.equal(contagem(1200, "nota"), "1.200 notas");
});

test("formatos: datas no fuso de São Paulo; data pura não muda de dia", () => {
  assert.equal(diaSP("2026-10-21"), "2026-10-21");
  assert.equal(diaSP("2026-10-22T02:00:00Z"), "2026-10-21"); // 23:00 do dia 21 em São Paulo
  assert.equal(diaMes("2026-11-13"), "13/11");
  assert.equal(dataCompleta("2026-11-13"), "13/11/2026");
  assert.equal(horaSP("2026-10-22T17:20:00+00:00"), "14:20");
  assert.equal(horaSP("2026-10-22"), null);
  assert.equal(diaEHora("2026-10-22T13:12:00+00:00"), "22/10 às 10:12");
  assert.equal(diaMes(null), null);
  assert.equal(mesCorrenteSP(new Date("2026-11-01T01:00:00Z")), "2026-10"); // ainda 31/10 em São Paulo
});

test("formatos: competência, meses, documento e nomes", () => {
  assert.equal(rotuloMes("2026-10-01"), "out/2026");
  assert.equal(rotuloMes("2026-01"), "jan/2026");
  assert.equal(rotuloMes("lixo"), null);
  assert.equal(deslocarMes("2026-12", 1), "2027-01");
  assert.equal(deslocarMes("2026-01", -1), "2025-12");
  assert.equal(deslocarMes("2026-10", 12), "2027-10");
  assert.equal(documento("11222333000181"), "11.222.333/0001-81");
  assert.equal(documento("12345678909"), "123.456.789-09");
  assert.equal(documento("123"), "123");
  assert.equal(listaNomes(["DOC"]), "DOC");
  assert.equal(listaNomes(["DOC", "PIS", "PRJ"]), "DOC, PIS e PRJ");
  assert.equal(primeiroNome("Hugo Silva"), "Hugo");
  assert.equal(primeiroNome(null), "");
});

test("procedência da página e quem pode pedir", () => {
  const agora = new Date("2026-10-22T17:00:00Z");
  const ctx = {
    emissoras: [
      {
        pode_pedir: false,
        omie: {
          indisponivel: false,
          motivo: null,
          bloqueada_ate: null,
          ultimo_ok_em: "2026-10-22T15:00:00Z",
          ultima_falha_em: null,
        },
      },
    ],
    simulacao: ["DOC", "PIS"],
    lido_em: "2026-10-22T17:00:00+00:00",
  };
  assert.deepEqual(procedenciaFaturamento(ctx, agora), {
    fonte:
      "Portal de Faturamento · situação do Omie lida às 12:00; a próxima leitura é às 16:00 (a cada 4 h em dia útil) · DOC e PIS em simulação: nada é gravado no Omie",
    atualizadoEm: "2026-10-22T17:00:00+00:00",
  });
  assert.deepEqual(procedenciaFaturamento(undefined, agora), { fonte: "Portal de Faturamento" });
  assert.equal(podePedir(ctx), false);
  assert.equal(podePedir({ emissoras: [{ pode_pedir: false }, { pode_pedir: true }] }), true);
  assert.equal(podePedir(undefined), false);
});

test("RF-P12 na tela: o que virou nota no mês e o que atrasou, sem simulados, e o destino bate", () => {
  const refs = [
    { id: "11111111-1111-4111-8111-111111111111", apelido: "DOC" },
    { id: "22222222-2222-4222-8222-222222222222", apelido: "PIS" },
  ];
  const linhas = linhasDeNovidades("2026-10");
  assert.deepEqual(
    linhas.map((l) => [l.chave, l.titulo, l.acao, l.tom]),
    [
      ["faturados", "Viraram nota em out/2026", "Ver as notas", "sucesso"],
      ["em_atraso", "Com parcela em atraso", "Ver os atrasados", "perigo"],
    ],
  );
  assert.deepEqual(linhas[0].filtro, { regua: "nota", mes: "2026-10", simulacao: false });
  assert.deepEqual(linhas[1].filtro, { regua: "atraso", simulacao: false });
  // Com o filtro de empresa da tela, as duas linhas vão com as empresas.
  const soDoc = linhasDeNovidades("2026-10", [refs[0].id]);
  assert.deepEqual(soDoc[1].filtro.emissoras, [refs[0].id]);
  // O link de Pedidos, lido de volta, dá o mesmo filtro da contagem (N2: o destino bate).
  for (const l of [...linhas, ...soDoc]) {
    const busca = buscaDoFiltro(l.filtro, refs);
    const { filtro } = filtroDaBusca(busca, refs);
    const { pagina, por_pagina, ...semPagina } = filtro;
    assert.deepEqual(semPagina, l.filtro, JSON.stringify(busca));
  }
});
