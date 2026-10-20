// Portal de Faturamento: a Ficha do pedido e a linha do tempo (src/lib/faturamento/ficha.ts e eventos.ts).
// Contrato docs/design/contratos/faturamento-pedido.md; formato de ops.fat_pedido conferido no banco em
// 20/10/2026 (API.md §1.4 e Mudanças 4, 5 e 7).
import test from "node:test";
import assert from "node:assert/strict";
import {
  acoesDaFicha,
  faixaDaSituacao,
  linhasIntegracao,
  oQueIriaAoOmie,
  resumoDaFicha,
} from "../src/lib/faturamento/ficha.ts";
import { eventoLegivel, mudancasDoDiff } from "../src/lib/faturamento/eventos.ts";

const HOJE = "2026-10-22";
const sim = { pode: true, motivo: null, codigo: null };
const nao = (motivo, codigo = "42501") => ({ pode: false, motivo, codigo });

function ficha(o = {}) {
  const { pedido = {}, ...resto } = o;
  return {
    pedido: {
      id: "p1",
      numero: "FAT-2026-000012",
      status: "aguardando_ok",
      simulacao: false,
      motivo_status: null,
      status_em: "2026-10-21T12:00:00+00:00",
      emissora: {
        id: "e1",
        apelido: "DOC",
        razao_social: "PLANNING DOC",
        modo_omie: "simular",
        pipefy_sync: false,
      },
      dono: { id: "d1", nome: "Hugo Silva" },
      solicitante: { id: "s1", nome: "Rafael" },
      enviado_por: { id: "s1", nome: "Rafael" },
      conferido_por: null,
      tomador: {
        tipo: "pj",
        documento: "11222333000181",
        nome: "CLIENTE",
        municipio: "Curitiba",
        uf: "PR",
        situacao: "ATIVA",
        situacao_conferida: true,
      },
      emails_envio: ["fin@cliente.com.br"],
      projeto: "Projeto",
      servico: {
        id: "sv",
        codigo_omie: "69",
        codigo: "SRV00001",
        descricao: "Alteração contratual",
      },
      descricao_nf: "Alteração contratual · Projeto",
      valor: 1500,
      forma: "parcelado",
      parcelas: 3,
      primeiro_vencimento: "2026-11-13",
      competencia: "2026-11-01",
      documento: "nf",
      meio: "boleto",
      departamento: null,
      observacoes: "Obs",
      confirmou_emissora: false,
      contratos_outra_emissora: [],
      omie: {
        os_codigo: null,
        os_etapa: null,
        nf_numero: null,
        nf_link: null,
        nf_emitida_em: null,
        lido_em: null,
      },
      criado_em: "2026-10-20T12:00:00+00:00",
      enviado_em: "2026-10-21T12:00:00+00:00",
      na_fila_em: null,
      faturado_em: null,
      atualizado_em: "2026-10-21T12:00:00+00:00",
      ...pedido,
    },
    resumo: {
      valor: 1500,
      recebido: 0,
      em_atraso: 0,
      parcelas_pagas: 0,
      parcelas_total: 3,
      proximo_vencimento: { data: "2026-11-13", valor: null, previsto: true },
    },
    parcelas: [],
    eventos: [],
    omie: { envios: [], leitura_pendente: null },
    pipefy: { envios: [] },
    papel: {
      autor: false,
      enviou: false,
      dono: true,
      substituto: false,
      gestor: false,
      tesouraria: false,
      controladoria: false,
    },
    acoes: {
      editar: nao("Pedido em Aguardando OK: só volta a ser editável se for devolvido.", "55000"),
      enviar: nao("x", "55000"),
      descartar: nao("x", "55000"),
      aprovar: sim,
      devolver: sim,
      reenviar: nao("Só pedido com erro no Omie se reenvia.", "55000"),
      pedir_cancelamento: sim,
      confirmar_cancelamento: nao("Não há cancelamento pedido.", "55000"),
      conferir: nao("Quem confere é a tesouraria."),
      faturar: nao("Quem fatura é a tesouraria."),
      atualizar_status: nao("Ainda não há OS no Omie para ler.", "55000"),
    },
    ...resto,
  };
}

test("ações por situação: uma default, as outras outline, desabilitadas com o motivo do banco", () => {
  assert.deepEqual(
    acoesDaFicha(ficha()).map((b) => [b.chave, b.rotulo, b.principal, b.pode]),
    [
      ["aprovar", "Dar OK e enviar ao Omie", true, true],
      ["devolver", "Devolver", false, true],
      ["pedir_cancelamento", "Pedir cancelamento", false, true],
    ],
  );
  // Quem enviou não dá o OK no próprio pedido: o botão fica, desabilitado, com a frase do banco.
  const autor = ficha({
    acoes: { ...ficha().acoes, aprovar: nao("Quem enviou não dá o OK no próprio pedido.") },
  });
  assert.deepEqual(acoesDaFicha(autor)[0], {
    chave: "aprovar",
    rotulo: "Dar OK e enviar ao Omie",
    principal: true,
    pode: false,
    motivo: "Quem enviou não dá o OK no próprio pedido.",
  });
  assert.deepEqual(
    acoesDaFicha(ficha({ pedido: { status: "simulado", simulacao: true } })).map((b) => b.rotulo),
    ["Conferir", "Faturar em simulação", "Devolver"],
  );
  assert.deepEqual(
    acoesDaFicha(ficha({ pedido: { status: "devolvido" } })).map((b) => b.rotulo),
    ["Corrigir"],
  );
  assert.deepEqual(
    acoesDaFicha(ficha({ pedido: { status: "rascunho" } })).map((b) => b.rotulo),
    ["Continuar editando"],
  );
  assert.deepEqual(acoesDaFicha(ficha({ pedido: { status: "cancelado" } })), []);
  assert.deepEqual(
    acoesDaFicha(ficha({ pedido: { status: "faturado" } })).map((b) => b.chave),
    ["pedir_cancelamento", "atualizar_status"],
  );
});

test("faixa da situação: devolvido, aguardando OK, erro, simulado", () => {
  assert.equal(faixaDaSituacao(ficha()), "Aguardando o OK de Hugo desde 21/10.");
  assert.equal(
    faixaDaSituacao(
      ficha({
        pedido: { status: "devolvido", motivo_status: "Falta o e-mail." },
        eventos: [
          {
            id: 3,
            evento: "devolvido",
            de: "os_criada",
            para: "devolvido",
            diff: { motivo: "Falta o e-mail do financeiro." },
            autor: { id: "m", nome: "Marina Souza" },
            em: "2026-10-22T13:00:00+00:00",
          },
        ],
      }),
    ),
    "Devolvido por Marina em 22/10: 'Falta o e-mail do financeiro.'",
  );
  assert.equal(
    faixaDaSituacao(
      ficha({
        pedido: {
          status: "erro_omie",
          status_em: "2026-10-22T13:12:00+00:00",
          motivo_status: "Chave do Omie da MAROX suspensa.",
        },
      }),
    ),
    "O Omie recusou em 22/10 às 10:12: 'Chave do Omie da MAROX suspensa.'",
  );
  assert.equal(
    faixaDaSituacao(ficha({ pedido: { status: "simulado", simulacao: true } })),
    "Simulado: nada foi gravado no Omie da DOC.",
  );
  assert.equal(faixaDaSituacao(ficha({ pedido: { status: "os_criada" } })), null);
});

test("resumo: antes da nota, recebido e atraso são não apurados; o próximo vencimento é previsto", () => {
  assert.deepEqual(
    resumoDaFicha(ficha()).map((n) => [n.rotulo, n.valor, n.nota, n.estado]),
    [
      ["Valor", "R$ 1.500,00", "3 parcelas", "ok"],
      ["Recebido", "—", "sem nota ainda", "nao-apurado"],
      ["Em atraso", "—", "sem nota ainda", "nao-apurado"],
      ["Próximo vencimento", "13/11/2026", "previsto", "ok"],
    ],
  );
  const faturado = ficha({
    pedido: {
      status: "faturado",
      omie: {
        os_codigo: 3021,
        os_etapa: "60",
        nf_numero: "4521",
        nf_link: "https://nf",
        nf_emitida_em: "2026-10-22T13:00:00Z",
        lido_em: null,
      },
    },
    resumo: {
      valor: 1500,
      recebido: 500,
      em_atraso: 0,
      parcelas_pagas: 1,
      parcelas_total: 3,
      proximo_vencimento: { data: "2026-12-13", valor: 500, previsto: false },
    },
  });
  assert.deepEqual(
    resumoDaFicha(faturado).map((n) => [n.valor, n.nota]),
    [
      ["R$ 1.500,00", "3 parcelas"],
      ["R$ 500,00", "1 de 3 parcelas"],
      ["R$ 0,00", "vencidas e não pagas"],
      ["13/12/2026", "R$ 500,00"],
    ],
  );
  assert.equal(
    resumoDaFicha(ficha({ pedido: { status: "faturado", simulacao: true } }))[1].nota,
    "simulado",
  );
});

test("Omie e Pipefy em simulação: o que iria, sem OS e card só montado", () => {
  const f = ficha({
    pedido: { status: "simulado", simulacao: true },
    omie: {
      envios: [
        {
          id: "a",
          operacao: "garantir_cliente",
          status: "simulado",
          modo: "simular",
          tentativas: 1,
          proxima_tentativa_em: null,
          erro_legivel: null,
          codigos: { cliente_existia: false },
          criado_em: "x",
          atualizado_em: "x",
        },
        {
          id: "b",
          operacao: "incluir_os",
          status: "simulado",
          modo: "simular",
          tentativas: 1,
          proxima_tentativa_em: null,
          erro_legivel: null,
          codigos: { cliente_existe: false, servico_existe: false },
          criado_em: "x",
          atualizado_em: "x",
        },
      ],
      leitura_pendente: null,
    },
    pipefy: {
      envios: [
        {
          id: "c",
          operacao: "criar_card",
          status: "simulado",
          card_id: null,
          fase: "Faturar",
          card_url: null,
          erro_legivel: null,
          criado_em: "x",
        },
      ],
    },
  });
  const linhas = Object.fromEntries(linhasIntegracao(f, HOJE).map((l) => [l.chave, l.texto]));
  assert.equal(linhas.cliente, "Seria cadastrado");
  assert.equal(
    linhas.os,
    "Seria criada com o código FAT-2026-000012; o envio daria erro: serviço não encontrado no Omie da DOC",
  );
  assert.equal(linhas.pipefy, "Card montado e guardado, não enviado. Iria para a fase Faturar.");
  assert.equal(linhas.leitura, "Pedido simulado: não há situação no Omie para ler.");
  const iria = Object.fromEntries(oQueIriaAoOmie(f).map((l) => [l.rotulo, l.valor]));
  assert.equal(iria["Código do pedido no Omie"], "FAT-2026-000012");
  assert.equal(iria.Cliente, "CLIENTE · 11.222.333/0001-81 · seria cadastrado no Omie");
  assert.match(iria["Serviço"], /o envio daria erro: serviço não encontrado no Omie da DOC/);
});

test("Omie de verdade: OS, nota com link, erro legível e próxima tentativa", () => {
  const comOs = ficha({
    pedido: {
      status: "faturado",
      omie: {
        os_codigo: 3021,
        os_etapa: "60",
        nf_numero: "4521",
        nf_link: "https://nf/4521",
        nf_emitida_em: "2026-10-22T13:00:00Z",
        lido_em: "2026-10-22T17:00:00Z",
      },
    },
    omie: { envios: [], leitura_pendente: { tentar_em: "2026-10-22T21:00:00Z" } },
  });
  const l = Object.fromEntries(linhasIntegracao(comOs, HOJE).map((x) => [x.chave, x]));
  assert.equal(l.os.texto, "OS 3021 · etapa 60");
  assert.equal(l.nota.texto, "NFS-e 4521 emitida em 22/10/2026");
  assert.deepEqual(l.nota.link, { href: "https://nf/4521", rotulo: "Abrir a nota" });
  assert.equal(l.leitura.texto, "Situação lida do Omie às 14:00; a próxima é às 18:00.");
  const erro = ficha({
    pedido: { status: "erro_omie" },
    omie: {
      envios: [
        {
          id: "b",
          operacao: "incluir_os",
          status: "erro",
          modo: "gravar",
          tentativas: 2,
          proxima_tentativa_em: null,
          erro_legivel: "Chave do Omie da MAROX suspensa.",
          codigos: null,
          criado_em: "x",
          atualizado_em: "x",
        },
      ],
      leitura_pendente: null,
    },
  });
  const os = linhasIntegracao(erro, HOJE).find((x) => x.chave === "os");
  assert.deepEqual([os.texto, os.erro], ["Chave do Omie da MAROX suspensa.", true]);
});

test("linha do tempo: o catálogo de eventos em português, com quem fez", () => {
  const e = (evento, diff = null, autor = { id: "h", nome: "Hugo Silva" }, o = {}) =>
    eventoLegivel({
      id: 1,
      evento,
      de: null,
      para: null,
      diff,
      autor,
      em: "2026-10-22T13:00:00Z",
      ...o,
    });
  assert.equal(e("aprovado").texto, "Hugo deu o OK");
  assert.equal(e("aprovado").quem, "Hugo");
  assert.equal(
    e("devolvido", { motivo: "Falta o e-mail." }, { id: "t", nome: "Tesouraria" }).texto,
    "Tesouraria devolveu: 'Falta o e-mail.'",
  );
  assert.equal(
    e("omie_os_criada", { omie_os_codigo: { de: null, para: 3021 } }, null).texto,
    "Omie criou a OS 3021",
  );
  assert.equal(e("omie_os_criada", null, null).quem, "Portal");
  assert.equal(
    e("omie_erro", { motivo: "Chave suspensa", operacao: "incluir_os" }, null).texto,
    "Omie recusou: 'Chave suspensa'",
  );
  assert.equal(e("faturado", { omie_nf_numero: "4521" }, null).texto, "Nota 4521 emitida");
  assert.equal(
    e("parcela_paga", { parcela: 1, de_parcelas: 3, valor: 500 }, null).texto,
    "Parcela 1 de 3 paga (R$ 500,00)",
  );
  assert.equal(
    e("cancelamento_pedido", { motivo: "Duplicado" }).texto,
    "Cancelamento pedido por Hugo: 'Duplicado'",
  );
  assert.equal(
    e("enviado", null, undefined, { para: "aguardando_ok" }).texto,
    "Hugo enviou para o OK do dono",
  );
  assert.equal(
    e("enviado", null, undefined, { para: "na_fila_omie" }).texto,
    "Hugo enviou ao Omie",
  );
  assert.equal(e("faturar_pedido", { modo: "simular" }).texto, "Hugo faturou em simulação");
  assert.equal(
    e("omie_cliente", { modo: "gravar", cliente_existia: false }, null).texto,
    "Omie: cliente cadastrado pelo portal",
  );
  assert.equal(
    e("faturado_no_omie", { omie_nf_numero: "77" }, null).texto,
    "Faturado direto no Omie: nota 77",
  );
  assert.equal(e("evento_novo").texto, "evento_novo");
});

test("diferenças de um evento alterado (RF-P10)", () => {
  assert.deepEqual(
    mudancasDoDiff({
      valor: { de: 7500, para: 5000 },
      forma: { de: "avulso", para: "parcelado" },
      servico_id: { de: "a", para: "b" },
      competencia: { de: "2026-10-01", para: "2026-11-01" },
      confirmou_emissora: { de: false, para: true },
    }),
    [
      "Serviço trocado",
      "Valor: R$ 7.500,00 → R$ 5.000,00",
      "À vista ou parcelado: à vista → parcelado",
      "Competência: out/2026 → nov/2026",
      "Empresa confirmada: não → sim",
    ],
  );
  assert.deepEqual(mudancasDoDiff(null), []);
});
