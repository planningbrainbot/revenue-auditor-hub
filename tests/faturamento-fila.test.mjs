// Portal de Faturamento: a Fila da tesouraria e a Configuração (src/lib/faturamento/fila.ts e config.ts).
// Contratos docs/design/contratos/faturamento-tesouraria.md e faturamento-configuracao.md; formato de
// ops.fat_fila_tesouraria e ops.fat_config conferido no banco em 20/10/2026.
import test from "node:test";
import assert from "node:assert/strict";
import {
  botaoDaLinha,
  emissoraPadrao,
  fichaEmCurso,
  filaEmCurso,
  filtroDaFila,
  gruposPorDia,
  HIGIENES,
  hrefFila,
  lerBuscaFila,
  rotuloDoDia,
  temFiltroFila,
  textoDocumento,
  textoOndeParou,
  textoProximaAcao,
} from "../src/lib/faturamento/fila.ts";
import {
  filtrarEmpresas,
  fraseDesativar,
  lerBuscaConfig,
  pessoasPorPapel,
  resumoDoPapel,
  seloOmie,
  substitutoPadrao,
} from "../src/lib/faturamento/config.ts";

const HOJE = "2026-10-22";
const AGORA = new Date("2026-10-22T17:00:00Z");
const PEDIDO = "11111111-2222-4333-8444-555555555555";

const item = (o = {}) => ({
  id: "i1",
  numero: "FAT-2026-000009",
  chegou_em: "2026-10-21T13:00:00Z",
  dia: "2026-10-21",
  emissora: { id: "e1", apelido: "DOC" },
  tomador: { nome: "CLIENTE", documento: "11222333000181", situacao_conferida: true },
  servico: { descricao: "Alteração", codigo: "SRV00001" },
  projeto: "P",
  documento: "nf",
  forma: "parcelado",
  parcelas: 3,
  valor: 1500,
  primeiro_vencimento: "2026-10-24",
  status: "os_criada",
  simulacao: false,
  faturando: false,
  conferido_por: null,
  erro_legivel: null,
  onde_parou: { evento: "omie_os_criada", em: "2026-10-22T13:12:00Z", autor: null, motivo: null },
  proxima_acao: {
    acao: "conferir",
    data: "2026-10-24",
    desde: "2026-10-22T13:12:00Z",
    tentar_em: null,
  },
  higiene: { erro: false, vence_2d: true, parado_1du: false },
  ...o,
});

test("lerBuscaFila guarda só o que é válido", () => {
  assert.deepEqual(lerBuscaFila({}), {});
  assert.deepEqual(
    lerBuscaFila({
      emissora: "pac sp",
      situacao: "para_faturar",
      higiene: "erro",
      dia: "hoje",
      busca: " x ",
      pedido: PEDIDO.toUpperCase(),
    }),
    {
      emissora: "PAC SP",
      situacao: "para_faturar",
      higiene: "erro",
      dia: "hoje",
      busca: "x",
      pedido: PEDIDO,
    },
  );
  assert.deepEqual(lerBuscaFila({ emissora: "Todas" }), { emissora: "todas" });
  // Prazos da Ana (21/10/2026): vence em até 2 dias; o link guardado com o nome antigo cai no filtro novo.
  assert.deepEqual(lerBuscaFila({ higiene: "vence_2d" }), { higiene: "vence_2d" });
  assert.deepEqual(lerBuscaFila({ higiene: "vence_3d" }), { higiene: "vence_2d" });
  assert.deepEqual(
    HIGIENES.map((h) => h.rotulo),
    ["Erro no Omie", "Vence em até 2 dias sem nota", "Parado há mais de 1 dia útil"],
  );
  assert.deepEqual(lerBuscaFila({ situacao: "lixo", higiene: "x", dia: "ontem", pedido: "x" }), {});
  assert.deepEqual(
    filtroDaFila({ emissora: "DOC", situacao: "faturado", dia: "hoje", pedido: PEDIDO }),
    { situacao: "faturado", dia: "hoje" },
  );
  assert.equal(temFiltroFila({ emissora: "DOC", pedido: PEDIDO }), false);
  assert.equal(
    hrefFila({ emissora: "todas", higiene: "erro", pedido: PEDIDO }),
    "/faturamento/tesouraria?emissora=todas&higiene=erro",
  );
});

test("a fila abre na empresa com mais trabalho; todas quando é uma só ou ninguém tem trabalho", () => {
  assert.equal(
    emissoraPadrao([
      { apelido: "DOC", trabalho: 2 },
      { apelido: "PIS", trabalho: 5 },
    ]),
    "PIS",
  );
  assert.equal(
    emissoraPadrao([
      { apelido: "DOC", trabalho: 3 },
      { apelido: "PIS", trabalho: 3 },
    ]),
    "DOC",
  );
  assert.equal(
    emissoraPadrao([
      { apelido: "DOC", trabalho: 0 },
      { apelido: "PIS", trabalho: 0 },
    ]),
    "todas",
  );
  assert.equal(emissoraPadrao([{ apelido: "DOC", trabalho: 9 }]), "todas");
});

test("agrupa por dia de chegada na ordem do banco", () => {
  const g = gruposPorDia(
    [
      item({ id: "a", dia: "2026-10-20" }),
      item({ id: "b", dia: "2026-10-21" }),
      item({ id: "c", dia: "2026-10-21" }),
      item({ id: "d", dia: "2026-10-22" }),
    ],
    HOJE,
  );
  assert.deepEqual(
    g.map((x) => [x.rotulo, x.itens.map((i) => i.id)]),
    [
      ["20/10/2026", ["a"]],
      ["Ontem · 21/10", ["b", "c"]],
      ["Hoje · 22/10", ["d"]],
    ],
  );
  assert.equal(rotuloDoDia("2026-01-01", "2026-01-02"), "Ontem · 01/01");
});

test("colunas: documento, onde parou, próxima ação e o botão da linha", () => {
  assert.equal(textoDocumento(item()), "Nota · 3x");
  assert.equal(
    textoDocumento(item({ documento: "recibo", forma: "avulso", parcelas: 1 })),
    "Recibo · à vista",
  );
  assert.equal(textoDocumento(item({ documento: "nd", parcelas: 2 })), "ND · 2x");
  assert.equal(textoOndeParou(item(), HOJE), "Omie criou a OS às 10:12");
  assert.equal(
    textoOndeParou(item({ status: "erro_omie", erro_legivel: "Chave suspensa." }), HOJE),
    "Omie recusou: 'Chave suspensa.'",
  );
  assert.equal(
    textoOndeParou(
      item({ status: "em_conferencia", conferido_por: { id: "m", nome: "Marina Souza" } }),
      HOJE,
    ),
    "Em conferência por Marina",
  );
  assert.equal(textoProximaAcao(item(), HOJE, AGORA), "Conferir · vence 24/10");
  assert.equal(
    textoProximaAcao(
      item({
        status: "erro_omie",
        proxima_acao: {
          acao: "reenviar",
          data: null,
          desde: "2026-10-21T13:12:00Z",
          tentar_em: null,
        },
      }),
      HOJE,
      AGORA,
    ),
    "Reenviar · erro desde 21/10 às 10:12 · há mais de 24 h",
  );
  assert.equal(
    textoProximaAcao(
      item({
        status: "na_fila_omie",
        proxima_acao: {
          acao: "aguardar_omie",
          data: null,
          desde: null,
          tentar_em: "2026-10-22T17:20:00Z",
        },
      }),
      HOJE,
      AGORA,
    ),
    "O Omie tenta às 14:20",
  );
  assert.equal(
    textoProximaAcao(
      item({
        faturando: true,
        proxima_acao: { acao: "aguardar_omie", data: null, desde: null, tentar_em: null },
      }),
      HOJE,
      AGORA,
    ),
    "Faturando…",
  );
  assert.equal(botaoDaLinha(item()), "conferir");
  assert.equal(botaoDaLinha(item({ status: "simulado" })), "conferir");
  assert.equal(botaoDaLinha(item({ status: "em_conferencia" })), "faturar");
  assert.equal(botaoDaLinha(item({ status: "erro_omie" })), "reenviar");
  assert.equal(botaoDaLinha(item({ status: "cancelamento_pedido" })), "confirmar_cancelamento");
  assert.equal(botaoDaLinha(item({ status: "na_fila_omie" })), null);
  assert.equal(botaoDaLinha(item({ status: "em_conferencia", faturando: true })), null);
  // O Pipefy saiu do portal (call de 27/10/2026): um erro antigo de card não vira botão nem próxima ação.
  const faturadoComErro = item({
    status: "faturado",
    pipefy_erro: "Campo obrigatório: Vencimento",
    proxima_acao: null,
  });
  assert.equal(botaoDaLinha(faturadoComErro), null);
  assert.equal(textoProximaAcao(faturadoComErro, HOJE, AGORA), "Faturado");
  assert.equal(botaoDaLinha(item({ pipefy_erro: "x" })), "conferir");
});

const pessoa = (id, nome, papel, o = {}) => ({
  id: `fd-${id}`,
  pessoa: { id, nome },
  email: `${id}@planning.com.br`,
  papel,
  substituto: null,
  ativo: true,
  desde: "2026-10-20T12:00:00Z",
  abre_faturamento: true,
  ...o,
});

const empresa = (apelido, o = {}) => ({
  id: apelido,
  apelido,
  razao_social: `PLANNING ${apelido}`,
  cnpj: "49726267000150",
  ativa: true,
  fatura_por: "ambos",
  modo_omie: "simular",
  pipefy_sync: false,
  conta_corrente_padrao: null,
  tem_chave: true,
  tem_pedido: false,
  omie: {
    indisponivel: false,
    motivo: null,
    bloqueada_ate: null,
    ultimo_ok_em: null,
    ultima_falha_em: null,
  },
  pessoas: [],
  contagem: { donos: 0, gestores: 0, solicitantes: 0 },
  servicos: [],
  servicos_liberados: 0,
  servicos_total: 0,
  sincronizacao: null,
  ...o,
});

test("configuração: busca por empresa ou pessoa, inativas só com o filtro, com pedido primeiro", () => {
  const lista = [
    empresa("PIS"),
    empresa("DOC", { tem_pedido: true }),
    empresa("AGRO", { ativa: false }),
    empresa("PRJ", { pessoas: [pessoa("hugo", "Hugo Silva", "dono")] }),
  ];
  assert.deepEqual(
    filtrarEmpresas(lista, {}).map((e) => e.apelido),
    ["DOC", "PIS", "PRJ"],
  );
  assert.deepEqual(
    filtrarEmpresas(lista, { inativas: "sim" }).map((e) => e.apelido),
    ["DOC", "PIS", "PRJ", "AGRO"],
  );
  assert.deepEqual(
    filtrarEmpresas(lista, { busca: "hugo" }).map((e) => e.apelido),
    ["PRJ"],
  );
  assert.deepEqual(
    filtrarEmpresas(lista, { busca: "planning doc" }).map((e) => e.apelido),
    ["DOC"],
  );
  assert.deepEqual(
    lerBuscaConfig({ busca: " x ", inativas: "sim", empresa: "pac sp", secao: "omie", lixo: 1 }),
    {
      busca: "x",
      inativas: "sim",
      empresa: "PAC SP",
      secao: "omie",
    },
  );
});

test("selo do Omie da empresa", () => {
  assert.deepEqual(seloOmie(empresa("PAI", { tem_chave: false })), {
    rotulo: "Sem chave",
    tom: "neutro",
    detalhe: null,
  });
  assert.deepEqual(
    seloOmie(
      empresa("MAROX", {
        omie: { indisponivel: true, motivo: "Aplicativo suspenso.", bloqueada_ate: null },
      }),
    ),
    { rotulo: "Indisponível", tom: "perigo", detalhe: "Aplicativo suspenso." },
  );
  assert.equal(seloOmie(empresa("DOC", { modo_omie: "gravar" })).rotulo, "Gravando");
  assert.equal(seloOmie(empresa("DOC")).rotulo, "Simulação");
});

test("pessoas por papel, substituto padrão, resumo e a frase de desativar", () => {
  const e = empresa("DOC", {
    pessoas: [
      pessoa("hugo", "Hugo Silva", "dono", { aguardando_ok: 2 }),
      pessoa("paula", "Paula Lima", "gestor"),
      pessoa("rafa", "Rafael", "solicitante"),
      pessoa("velho", "Antigo", "solicitante", { ativo: false }),
    ],
  });
  const p = pessoasPorPapel(e);
  assert.deepEqual([p.dono.length, p.gestor.length, p.solicitante.length], [1, 1, 1]);
  assert.equal(substitutoPadrao(e, "hugo"), "paula");
  assert.equal(substitutoPadrao(e, "paula"), null);
  assert.equal(resumoDoPapel(p.dono), "1 · Hugo");
  assert.equal(resumoDoPapel([]), "—");
  assert.equal(
    fraseDesativar(p.dono[0], "DOC"),
    "Hugo Silva deixa de ser dono na DOC. 2 pedidos esperam o OK dele; o gestor da empresa continua podendo dar o OK.",
  );
  assert.equal(fraseDesativar(p.gestor[0], "DOC"), "Paula Lima deixa de ser gestor na DOC.");
});

test("fila: Em conferência só junto com Para faturar, busca numérica de link compartilhado e o href", () => {
  assert.deepEqual(
    lerBuscaFila({ emissora: "todas", situacao: "para_faturar", incluir: "em_conferencia" }),
    { emissora: "todas", situacao: "para_faturar", incluir: "em_conferencia" },
  );
  // Sem Para faturar, o `incluir` cai (não há o que somar).
  assert.deepEqual(lerBuscaFila({ situacao: "erro_omie", incluir: "em_conferencia" }), {
    situacao: "erro_omie",
  });
  assert.deepEqual(lerBuscaFila({ incluir: "outra" }), {});
  // "?busca=2026" chega como número.
  assert.deepEqual(lerBuscaFila({ busca: 2026 }), { busca: "2026" });
  // O `incluir` não vai ao p_filtro da fila: o grupo Em conferência é uma segunda leitura.
  assert.deepEqual(filtroDaFila({ situacao: "para_faturar", incluir: "em_conferencia" }), {
    situacao: "para_faturar",
  });
  assert.equal(
    hrefFila({ emissora: "DOC", situacao: "para_faturar", incluir: "em_conferencia" }),
    "/faturamento/tesouraria?emissora=DOC&situacao=para_faturar&incluir=em_conferencia",
  );
});

test("releitura: Fila e Ficha releem sozinhas só enquanto há algo faturando ou na fila do Omie", () => {
  assert.equal(filaEmCurso(undefined), false);
  assert.equal(filaEmCurso({ itens: [] }), false);
  assert.equal(filaEmCurso({ itens: [{ faturando: false, status: "os_criada" }] }), false);
  assert.equal(filaEmCurso({ itens: [{ faturando: true, status: "em_conferencia" }] }), true);
  assert.equal(filaEmCurso({ itens: [{ faturando: false, status: "na_fila_omie" }] }), true);

  const ficha = (status, omie = {}) => ({
    pedido: { status },
    omie: { envios: [], leitura_pendente: null, ...omie },
  });
  assert.equal(fichaEmCurso(undefined), false);
  assert.equal(fichaEmCurso(ficha("faturado")), false);
  assert.equal(fichaEmCurso(ficha("na_fila_omie")), true);
  assert.equal(fichaEmCurso(ficha("faturado", { leitura_pendente: { tentar_em: "x" } })), true);
  assert.equal(
    fichaEmCurso(ficha("em_conferencia", { envios: [{ status: "processando" }] })),
    true,
  );
  assert.equal(fichaEmCurso(ficha("em_conferencia", { envios: [{ status: "pendente" }] })), true);
  assert.equal(
    fichaEmCurso(ficha("os_criada", { envios: [{ status: "ok" }, { status: "erro" }] })),
    false,
  );
});

test("configuração: busca numérica de link compartilhado vale", () => {
  assert.deepEqual(lerBuscaConfig({ busca: 8120 }), { busca: "8120" });
  assert.deepEqual(lerBuscaConfig({ busca: "  Hugo " }), { busca: "Hugo" });
  assert.deepEqual(lerBuscaConfig({ busca: "" }), {});
});
