// Correções do conector da rodada de revisão (20/10/2026; e1/revisao-app-conector.md e e1/revisao-banco-seguranca.md,
// migration 20261020220000): modo efetivo da reserva (A1), ficha da reserva e prazo da rodada (achado 10, M1), 403 e
// 425 param a emissora entre rodadas (M3, B1), pix com parcela vencida (M4), 42501 na credencial (B4), Pipefy de
// pedido simulado (achado 5) e o reenvio do Pipefy pela tesouraria. A reserva usa o formato real do banco: `modo` é o
// efetivo, `emissora` traz `modo_omie`, e cada item traz `reserva` e `reservado_ate`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classificarErroOmie,
  criarOmie,
  ESCRITAS,
  LEITURAS,
  MIN_CHAMADA_MS,
  modoDoEnvio,
  processarEnvio,
  rodarFila,
} from "../supabase/functions/faturamento-omie/logica.ts";
import {
  criarPipefy,
  FASE,
  modoPipefy,
  processarPipefy,
  rodarFilaPipefy,
} from "../supabase/functions/faturamento-omie/pipefy.ts";
import { rodarFilaNotificacoes } from "../supabase/functions/faturamento-omie/notificacoes.ts";

const AGORA = new Date("2026-10-20T15:00:00Z");
const CRED = { app_key: "CHAVE-APP-123456", app_secret: "SEGREDO-APP-987654" };
const DOC = "c243b1d0-0000-4000-8000-000000000001";
const PAC = "c243b1d0-0000-4000-8000-000000000002";
const RESERVA = "7f0e0000-0000-4000-8000-0000000000aa";

const payload = (o = {}) => ({
  versao: 1,
  pedido: {
    id: "p-1",
    numero: "FAT-2026-000012",
    codigo_integracao: "FAT-2026-000012",
    valor: 1500,
    forma: "avulso",
    parcelas: 1,
    primeiro_vencimento: "2026-11-13",
    competencia: "2026-11-01",
    documento: "nf",
    meio: "boleto",
    descricao_nf: "Alteração contratual",
    projeto: "Projeto",
    departamento: null,
    observacoes: "obs",
    emails_envio: ["financeiro@cliente.com.br"],
    ...(o.pedido ?? {}),
  },
  emissora: { id: DOC, apelido: "DOC", cnpj: "49726267000150", conta_corrente_padrao: 11850365 },
  tomador: {
    tipo: "pj",
    documento: "11222333000181",
    nome: "CLIENTE EXEMPLO LTDA",
    municipio: "Curitiba",
    uf: "PR",
    emails: [],
    codigo_cliente_integracao: "11222333000181",
  },
  servico: {
    id: "s-1",
    codigo_omie: "6931061282",
    codigo: "SRV00001",
    descricao: "Serviço",
    categoria: "1.01.85",
    conta_corrente: 11850365,
  },
  parcelas: o.parcelas ?? [{ n: 1, vencimento: "2026-11-13", valor: 1500 }],
  omie_os_codigo: o.omie_os_codigo ?? null,
});

/** Envio no formato que fat_envio_proximos devolve depois da revisão. */
const envio = (operacao, o = {}) => ({
  id: o.id ?? `e-${operacao}`,
  emissora: { id: DOC, apelido: "DOC", modo_omie: "simular", ...(o.emissora ?? {}) },
  origem: "fat_pedido",
  origem_id: "p-1",
  operacao,
  codigo_integracao: "FAT-2026-000012",
  modo: o.modo ?? "simular",
  tentativas: 1,
  reserva: o.reserva ?? RESERVA,
  reservado_ate: "2026-10-20T15:10:00Z",
  payload: o.payload ?? payload(),
  cliente_omie: o.cliente_omie ?? null,
  dependencia: o.dependencia ?? null,
});

function omieFalso(handlers = {}) {
  const chamadas = [];
  const transporte = async (url, corpo, limiteMs) => {
    const req = JSON.parse(corpo);
    chamadas.push({ metodo: req.call, param: req.param[0], chave: req.app_key, limiteMs });
    let h = handlers[req.call];
    if (typeof h === "function") h = h(req.param[0], req.app_key);
    if (h === undefined)
      return {
        status: 500,
        texto: JSON.stringify({
          faultstring: "ERROR: OS não cadastrada para o Código de Integração [X] !",
          faultcode: "SOAP-ENV:Client-103",
        }),
      };
    if (h && h.http) return { status: h.http, texto: JSON.stringify(h.corpo ?? {}) };
    return { status: 200, texto: JSON.stringify(h) };
  };
  return {
    transporte,
    chamadas,
    escritas: () => chamadas.filter((c) => !LEITURAS.has(c.metodo)).map((c) => c.metodo),
  };
}
const TUDO_RESPONDE = {
  ConsultarCliente: { codigo_cliente_omie: 4214850, inativo: "N" },
  ConsultarCadastroServico: { cabecalho: {}, info: { inativo: "N" } },
  IncluirOS: { nCodOS: 3021, cNumOS: "1" },
  AlterarOS: { nCodOS: 3021 },
  FaturarOS: { cCodStatus: "0" },
  IncluirCliente: { codigo_cliente_omie: 1 },
  StatusOS: { nCodOS: 3021, cFaturada: "N", cCancelada: "N" },
};

function deps(f, o = {}) {
  const respostas = [];
  const bloqueios = [];
  let lotes = o.lotes ?? [[]];
  let i = 0;
  let t = o.t0 ?? AGORA.getTime();
  return {
    respostas,
    bloqueios,
    d: {
      reservar: async () => lotes[i++] ?? [],
      responder: async (e, r) => {
        respostas.push({ id: e.id, reserva: e.reserva, ...r });
      },
      bloquear: async (emissora, ate, motivo) => {
        bloqueios.push({ emissora, ate, motivo });
      },
      credencial: async (id) => (id === PAC ? { app_key: "k-PAC", app_secret: "s-PAC" } : CRED),
      statusAplicar: async () => null,
      servicosAplicar: async () => null,
      transporte: f.transporte,
      dormir: async (ms) => {
        t += ms;
      },
      relogio: () => t,
      pausaMs: 0,
      ...o.extra,
    },
    avancar: (ms) => {
      t += ms;
    },
  };
}

// ---------------------------------------------------------------------------------------------- 1. modo efetivo (A1)

test("A1: a emissora voltou para simular com o envio carimbado gravar na fila → nenhuma escrita", async () => {
  // a) O formato real: a reserva já devolve o modo efetivo (simular) e o modo_omie atual.
  const a = omieFalso(TUDO_RESPONDE);
  const da = deps(a, {
    lotes: [
      [
        envio("incluir_os", {
          modo: "simular",
          emissora: { modo_omie: "simular" },
          dependencia: { codigos: { codigo_cliente_omie: 1 } },
        }),
      ],
    ],
  });
  await rodarFila(da.d);
  assert.deepEqual(a.escritas(), []);
  assert.equal(da.respostas[0].status, "simulado");
  // b) Reserva inconsistente (modo gravar, emissora em simular): conflito, nada sai, nem leitura.
  for (const emissora of [{ modo_omie: "simular" }, { modo_omie: undefined }]) {
    const b = omieFalso(TUDO_RESPONDE);
    const db = deps(b, {
      lotes: [
        [
          envio("incluir_os", { modo: "gravar", emissora }),
          envio("faturar_os", {
            id: "e-f",
            modo: "gravar",
            emissora,
            payload: payload({ omie_os_codigo: 3021 }),
          }),
        ],
      ],
    });
    await rodarFila(db.d);
    assert.deepEqual(b.chamadas, [], "nenhuma chamada ao Omie");
    assert.ok(db.respostas.every((r) => r.status === "erro" && r.resposta.conflito === true));
  }
  assert.equal(modoDoEnvio({ modo: "gravar", emissora: { modo_omie: "gravar" } }), "gravar");
  assert.equal(modoDoEnvio({ modo: "gravar", emissora: {} }), "conflito");
  assert.equal(
    modoDoEnvio({ modo: "simular", emissora: { modo_omie: "gravar" } }),
    "simular",
    "pedido simulado: o banco manda simular",
  );
});

test("A1: alterar ou faturar uma OS real com a emissora em simulação vira erro legível, sem chamar o Omie", async () => {
  for (const operacao of ["alterar_os", "faturar_os"]) {
    const f = omieFalso(TUDO_RESPONDE);
    const omie = criarOmie({
      transporte: f.transporte,
      credencial: CRED,
      modo: "simular",
      dormir: async () => {},
      pausaMs: 0,
    });
    const r = await processarEnvio(
      envio(operacao, { payload: payload({ omie_os_codigo: 3021 }) }),
      {
        omie,
        modo: "simular",
        agora: () => AGORA,
        dormir: async () => {},
        departamentos: new Map(),
        statusAplicar: async () => null,
        servicosAplicar: async () => null,
      },
    );
    assert.equal(r.status, "erro", operacao);
    assert.match(
      r.erro_legivel,
      new RegExp(
        `^A DOC está em simulação: ${operacao === "faturar_os" ? "o faturamento" : "a alteração"} da OS 3021 não foi feito no Omie\\. Reenvie quando a gravação voltar\\.$`,
      ),
    );
    assert.deepEqual(f.chamadas, []);
  }
  // Pedido simulado (sem OS real) segue simulando o faturamento, com a leitura que prova que nada existe.
  const f = omieFalso({});
  const omie = criarOmie({
    transporte: f.transporte,
    credencial: CRED,
    modo: "simular",
    dormir: async () => {},
    pausaMs: 0,
  });
  const r = await processarEnvio(envio("faturar_os"), {
    omie,
    modo: "simular",
    agora: () => AGORA,
    dormir: async () => {},
    departamentos: new Map(),
    statusAplicar: async () => null,
    servicosAplicar: async () => null,
  });
  assert.equal(r.status, "simulado");
  assert.deepEqual(
    f.chamadas.map((c) => c.metodo),
    ["StatusOS"],
  );
});

// ---------------------------------------------------------------------------------------------- 2. ficha e prazo

test("ficha: todo resultado leva a reserva que a reserva entregou", async () => {
  const f = omieFalso(TUDO_RESPONDE);
  const x = deps(f, {
    lotes: [
      [
        envio("garantir_cliente", { reserva: "r-1" }),
        envio("garantir_cliente", {
          id: "e-2",
          reserva: "r-2",
          emissora: { id: PAC, apelido: "PAC", modo_omie: "simular" },
        }),
      ],
    ],
  });
  await rodarFila(x.d);
  assert.deepEqual(
    x.respostas.map((r) => [r.id, r.reserva]),
    [
      ["e-garantir_cliente", "r-1"],
      ["e-2", "r-2"],
    ],
  );
});

test("prazo: chamada que não cabe antes do fim da rodada não sai; o envio volta na hora e a rodada para", async () => {
  const f = omieFalso(TUDO_RESPONDE);
  const x = deps(f, {
    lotes: [
      [envio("garantir_cliente"), envio("garantir_cliente", { id: "e-2" })],
      [envio("garantir_cliente", { id: "e-3" })],
    ],
    extra: { prazo: AGORA.getTime() + 3 * MIN_CHAMADA_MS },
  });
  // A primeira chamada leva quase todo o tempo que sobra.
  const lento = f.transporte;
  x.d.transporte = async (u, c, l) => {
    x.avancar(2 * MIN_CHAMADA_MS);
    return lento(u, c, l);
  };
  const resumo = await rodarFila(x.d);
  assert.equal(f.chamadas.length, 1);
  assert.ok(
    f.chamadas[0].limiteMs <= 3 * MIN_CHAMADA_MS - 1000,
    "o tempo limite da chamada é o que sobra da rodada",
  );
  assert.equal(x.respostas[0].status, "simulado");
  assert.equal(x.respostas[1].status, "pendente");
  assert.equal(x.respostas[1].resposta.liberado, "fim do tempo da rodada");
  assert.equal(resumo.reservados, 2, "não reserva mais depois do prazo");
  // Leitura que repetiria (passageiro) também respeita o prazo: sem tempo, para em vez de repetir.
  const g = omieFalso({ ConsultarCliente: { http: 502, corpo: {} } });
  let t = 0;
  const omie = criarOmie({
    transporte: async (u, c, l) => {
      t += MIN_CHAMADA_MS;
      return g.transporte(u, c, l);
    },
    credencial: CRED,
    modo: "simular",
    dormir: async (ms) => {
      t += ms;
    },
    relogio: () => t,
    pausaMs: 0,
    prazo: MIN_CHAMADA_MS * 1.5,
  });
  await assert.rejects(
    omie.chamar("geral/clientes", "ConsultarCliente", {}),
    (e) => e.classe === "tempo",
  );
  assert.equal(g.chamadas.length, 1, "não repetiu sem tempo");
});

test("o ritmo da emissora é compartilhado na execução (pausa vale também fora da fila)", async () => {
  const f = omieFalso(TUDO_RESPONDE);
  const ritmos = new Map();
  const x = deps(f, { lotes: [[envio("garantir_cliente")]], extra: { ritmos } });
  await rodarFila(x.d);
  assert.ok(ritmos.get(DOC)?.ultima > 0);
});

// ---------------------------------------------------------------------------------------------- 3. 403 e 425 (M3, B1)

test("403 bloqueia a emissora por 1 hora pela passagem, e 425 pelo prazo do Omie mais folga; a outra emissora segue", async () => {
  const f = omieFalso({
    ConsultarCliente: (_p, chave) =>
      chave === "k-PAC"
        ? { codigo_cliente_omie: 9 }
        : {
            http: 403,
            corpo: {
              faultstring: "A chave de acesso está inválida ou o aplicativo está suspenso",
              faultcode: "SOAP-ENV:Server",
            },
          },
  });
  const x = deps(f, {
    lotes: [
      [
        envio("garantir_cliente"),
        envio("garantir_cliente", { id: "e-2" }),
        envio("garantir_cliente", {
          id: "e-p",
          emissora: { id: PAC, apelido: "PAC", modo_omie: "simular" },
        }),
      ],
    ],
  });
  await rodarFila(x.d);
  assert.deepEqual(
    x.bloqueios.map((b) => [b.emissora, b.ate]),
    [[DOC, new Date(AGORA.getTime() + 3600_000).toISOString()]],
  );
  assert.match(x.bloqueios[0].motivo, /^A chave do Omie da DOC está suspensa ou inválida/);
  assert.deepEqual(
    f.chamadas.map((c) => c.chave),
    [CRED.app_key, "k-PAC"],
    "a DOC não é chamada de novo",
  );
  assert.deepEqual(
    x.respostas.map((r) => r.status),
    ["erro", "erro", "simulado"],
  );

  const g = omieFalso({
    ConsultarCliente: {
      http: 425,
      corpo: { faultstring: "MISUSE_API_PROCESS: Tente novamente em 200 segundos." },
    },
  });
  const y = deps(g, {
    lotes: [[envio("garantir_cliente"), envio("garantir_cliente", { id: "e-2" })]],
  });
  await rodarFila(y.d);
  assert.equal(y.bloqueios.length, 1);
  assert.equal(y.bloqueios[0].ate, new Date(AGORA.getTime() + 230_000).toISOString());
  assert.equal(g.chamadas.length, 1);
});

test("B1: todo HTTP 425 é bloqueio e não se repete, mesmo sem o texto do MISUSE", async () => {
  assert.equal(classificarErroOmie(425, "").classe, "bloqueio");
  assert.equal(classificarErroOmie(425, "<html>Too Early</html>").classe, "bloqueio");
  const f = omieFalso({ ConsultarCliente: { http: 425, corpo: "" } });
  const omie = criarOmie({
    transporte: f.transporte,
    credencial: CRED,
    modo: "simular",
    dormir: async () => {},
    pausaMs: 0,
  });
  await assert.rejects(
    omie.chamar("geral/clientes", "ConsultarCliente", {}),
    (e) => e.classe === "bloqueio",
  );
  assert.equal(f.chamadas.length, 1, "uma chamada só");
});

test("B4: 42501 ao ler a credencial é falha do servidor (volta para a fila), não chave fora do cofre", async () => {
  const f = omieFalso(TUDO_RESPONDE);
  const x = deps(f, {
    lotes: [[envio("garantir_cliente")]],
    extra: {
      credencial: async () => {
        throw Object.assign(new Error("Só o conector"), { code: "42501" });
      },
    },
  });
  await rodarFila(x.d);
  assert.equal(x.respostas[0].status, "pendente");
  assert.ok(!/cofre/.test(x.respostas[0].erro_legivel ?? ""));
  assert.equal(x.bloqueios.length, 0);
});

// ---------------------------------------------------------------------------------------------- 4. pix vencido (M4)

test("M4: pix com parcela vencida fatura; a recusa de vencido vale só para boleto", async () => {
  const vencida = [{ n: 1, vencimento: "2026-10-01", valor: 1500 }];
  const gravar = (p) => {
    const f = omieFalso({
      StatusOS: (() => {
        let n = 0;
        return () =>
          n++ === 0
            ? { nCodOS: 3021, cFaturada: "N", cCancelada: "N" }
            : { nCodOS: 3021, cFaturada: "S", dDtFat: "20/10/2026" };
      })(),
      FaturarOS: { cCodStatus: "0" },
      PesquisarLancamentos: { titulosEncontrados: [] },
    });
    const omie = criarOmie({
      transporte: f.transporte,
      credencial: CRED,
      modo: "gravar",
      dormir: async () => {},
      pausaMs: 0,
    });
    return {
      f,
      run: processarEnvio(
        envio("faturar_os", { modo: "gravar", emissora: { modo_omie: "gravar" }, payload: p }),
        {
          omie,
          modo: "gravar",
          agora: () => AGORA,
          dormir: async () => {},
          departamentos: new Map(),
          statusAplicar: async () => null,
          servicosAplicar: async () => null,
        },
      ),
    };
  };
  const pix = gravar(payload({ omie_os_codigo: 3021, pedido: { meio: "pix" }, parcelas: vencida }));
  assert.equal((await pix.run).status, "ok");
  assert.ok(pix.f.chamadas.some((c) => c.metodo === "FaturarOS"));
  const boleto = gravar(
    payload({ omie_os_codigo: 3021, pedido: { meio: "boleto" }, parcelas: vencida }),
  );
  const r = await boleto.run;
  assert.equal(r.status, "erro");
  assert.match(r.erro_legivel, /o Omie não fatura boleto vencido/);
  assert.ok(!boleto.f.chamadas.some((c) => c.metodo === "FaturarOS"));
  assert.ok(ESCRITAS.has("FaturarOS"));
});

// ---------------------------------------------------------------------------------------------- 5. Pipefy

const PAYLOAD_CARD = {
  ...payload(),
  status: "na_fila_omie",
  solicitante: { email: "rafael@planning.com.br" },
  dono: { email: "hugo@planning.com.br" },
};
const COLABS = new Map([
  ["rafael@planning.com.br", "401"],
  ["hugo@planning.com.br", "402"],
  ["flavia@planning.com.br", "403"],
]);
const envioPipefy = (operacao, o = {}) => ({
  id: o.id ?? `pf-${operacao}`,
  emissora: { id: DOC, apelido: "DOC", modo_omie: o.modo_omie ?? "gravar" },
  pipefy_sync: o.pipefy_sync ?? true,
  origem_id: "p-1",
  operacao,
  card_id: o.card_id ?? null,
  tentativas: o.tentativas ?? 1,
  reserva: o.reserva ?? "rp-1",
  reservado_ate: "2026-10-20T15:10:00Z",
  payload: o.payload ?? PAYLOAD_CARD,
});
function pipefyFalso(respostas = {}) {
  const chamadas = [];
  const transporte = async (corpo, limiteMs) => {
    const { query, variables } = JSON.parse(corpo);
    const nome = /^\s*(query|mutation)\s+(\w+)/.exec(query)[2];
    chamadas.push({ nome, mutacao: /^\s*mutation/.test(query), variables, limiteMs });
    let h = respostas[nome];
    if (typeof h === "function") h = h(variables);
    return { status: 200, texto: JSON.stringify(h ?? { data: {} }) };
  };
  return { transporte, chamadas };
}
const COLAB_RESP = {
  data: {
    table_records: {
      pageInfo: { hasNextPage: false },
      edges: [...COLABS].map(([e, id]) => ({
        node: { id, record_fields: [{ field: { id: "e_mail_comercial" }, value: e }] },
      })),
    },
  },
};

test("Pipefy: pedido simulado no Omie nunca cria card real, mesmo com pipefy_sync verdadeiro na reserva", async () => {
  assert.equal(
    modoPipefy({ pipefy_sync: true, emissora: { modo_omie: "gravar" } }, false),
    "gravar",
  );
  assert.equal(
    modoPipefy({ pipefy_sync: true, emissora: { modo_omie: "simular" } }, false),
    "simular",
  );
  assert.equal(
    modoPipefy({ pipefy_sync: true, emissora: { modo_omie: "gravar" } }, true),
    "simular",
  );
  assert.equal(
    modoPipefy({ pipefy_sync: "true", emissora: { modo_omie: "gravar" } }, false),
    "simular",
  );
  const f = pipefyFalso({ Colaboradores: COLAB_RESP });
  const respostas = [];
  let i = 0;
  await rodarFilaPipefy({
    reservar: async () =>
      i++
        ? []
        : [
            envioPipefy("criar_card"),
            envioPipefy("mover_fase", {
              id: "pf-m",
              payload: { de: "os_criada", para: "em_conferencia", pedido: { id: "p-1" } },
            }),
          ],
    responder: async (e, r) => {
      respostas.push({ id: e.id, reserva: e.reserva, ...r });
    },
    contexto: async () => ({
      pedido: { id: "p-1", simulacao: true },
      responsavel_ticket: { email: "flavia@planning.com.br" },
    }),
    transporte: f.transporte,
    orcamentoMs: 60_000,
    agora: () => AGORA,
  });
  assert.deepEqual(
    f.chamadas.filter((c) => c.mutacao),
    [],
    "nenhuma mutation",
  );
  assert.deepEqual(
    respostas.map((r) => [r.status, r.reserva]),
    [
      ["simulado", "rp-1"],
      ["simulado", "rp-1"],
    ],
  );
  assert.equal(respostas[0].resposta.modo, "simular");
});

test("Pipefy: reenvio pela tesouraria retoma de onde o card está, sem card nem movimento repetido", async () => {
  // criar_card reenviado: a tentativa anterior criou o card e caiu antes de gravar o id → acha e não cria outro.
  const f = pipefyFalso({
    CardsPeloProjeto: {
      data: {
        cards: {
          edges: [
            {
              node: {
                id: "555",
                url: "u",
                fields: [
                  {
                    field: { id: "particularidades" },
                    value: "Pedido FAT-2026-000012 do Portal de Faturamento. …",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    PreencherCampos: { data: { updateFieldsValues: { success: true, userErrors: [] } } },
  });
  const ctx = (tr) => ({
    pipefy: criarPipefy({ transporte: tr, modo: "gravar" }),
    modo: "gravar",
    agora: () => AGORA,
    colaboradores: async () => COLABS,
    contexto: async () => ({
      pedido: { id: "p-1" },
      responsavel_ticket: { email: "flavia@planning.com.br" },
      card_id: "555",
    }),
  });
  const r1 = await processarPipefy(envioPipefy("criar_card"), ctx(f.transporte));
  assert.equal(r1.card_id, "555");
  assert.ok(!f.chamadas.some((c) => c.nome === "CriarCardDoPedido"));
  // mover_fase (faturado) reenviado depois de cair no meio: o card já está em APROVADO → só termina o caminho.
  const g = pipefyFalso({
    CardDoPedido: {
      data: {
        card: {
          id: "555",
          current_phase: { id: FASE.APROVADO },
          fields: [
            { field: { id: "conex_o_de_database" }, value: '["F"]' },
            { field: { id: "cpf_cnpj_do_cliente_conferido" }, value: '["C"]' },
          ],
        },
      },
    },
    PreencherCampos: { data: { updateFieldsValues: { success: true, userErrors: [] } } },
    MoverCard: (v) => ({
      data: {
        moveCardToPhase: {
          card: { id: "555", current_phase: { id: v.input.destination_phase_id } },
        },
      },
    }),
  });
  const r2 = await processarPipefy(
    envioPipefy("mover_fase", {
      card_id: "555",
      payload: {
        de: "em_conferencia",
        para: "faturado",
        pedido: { id: "p-1", omie_nf_numero: "4521" },
      },
    }),
    ctx(g.transporte),
  );
  assert.equal(r2.status, "ok", r2.erro_legivel);
  assert.deepEqual(
    g.chamadas
      .filter((c) => c.nome === "MoverCard")
      .map((c) => c.variables.input.destination_phase_id),
    [FASE.REALIZADO],
  );
});

test("Pipefy e e-mail respeitam o prazo da rodada", async () => {
  const f = pipefyFalso({});
  const pf = criarPipefy({
    transporte: f.transporte,
    modo: "simular",
    relogio: () => 1000,
    prazo: 3000,
  });
  await assert.rejects(pf.consulta("query Colaboradores { x }", {}), (e) => e.classe === "tempo");
  assert.equal(f.chamadas.length, 0);
  let envios = 0;
  const r = await rodarFilaNotificacoes({
    reservar: async () => [
      {
        id: "n1",
        evento: "devolvido",
        pedido_id: "p",
        destinatario: { email: "a@b.com", ativo: true },
        dados: {},
      },
    ],
    responder: async () => {},
    ligado: true,
    enviar: async () => {
      envios++;
      return { status: 202, texto: "" };
    },
    orcamentoMs: 10_000,
    relogio: () => 0,
    prazo: 5_000,
  });
  assert.equal(r.reservados, 0, "sem tempo para enviar, nem reserva");
  assert.equal(envios, 0);
});
