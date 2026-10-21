// Notificações do Portal de Faturamento (T6, RF-P12, 20/10/2026): o e-mail de cada evento (OK pendente, devolvido,
// faturado, em atraso, erro no Omie) e de cada papel, sem CPF/CNPJ completo, o link do pedido, a simulação sem envio
// (FATURAMENTO_EMAIL desligado ou pedido simulado) e o envio pelo SendGrid quando ligado. Quem recebe e o "não repetir"
// por destinatário e transição ficam no banco (gate supabase/gates/20261020_portal_faturamento_notificacoes.sql); aqui
// a rodada não processa duas vezes o mesmo id.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  corpoSendgrid,
  linkDoPedido,
  montarEmail,
  processarNotificacao,
  REMETENTE,
  rodarFilaNotificacoes,
  semDocumento,
} from "../supabase/functions/faturamento-omie/notificacoes.ts";

const PEDIDO = "6f1c2d3e-0000-4000-8000-00000000abcd";
const notif = (evento, o = {}) => ({
  id: `n-${evento}`,
  evento,
  papel: o.papel ?? "dono",
  pedido_id: PEDIDO,
  emissora: { id: "e", apelido: "DOC" },
  tentativas: 1,
  destinatario: {
    id: "u",
    nome: "Hugo Silva",
    email: "Hugo.Silva@planning.com.br",
    ativo: true,
    ...(o.destinatario ?? {}),
  },
  dados: {
    numero: "FAT-2026-000012",
    emissora: "DOC",
    tomador_nome: "CLIENTE EXEMPLO LTDA",
    tomador_tipo: "pj",
    valor: 1500,
    projeto: "Alteração contratual 2026",
    primeiro_vencimento: "2026-11-13",
    parcelas: 1,
    documento: "nf",
    motivo: null,
    nf_numero: null,
    nf_link: null,
    simulacao: false,
    ...(o.dados ?? {}),
  },
});

test("OK pendente: assunto, link da página do pedido e o texto por papel (dono, substituto, gestor)", () => {
  const e = montarEmail(notif("ok_pendente"));
  assert.equal(e.para, "hugo.silva@planning.com.br");
  assert.equal(e.assunto, "OK pendente: FAT-2026-000012 (DOC)");
  assert.ok(e.html.includes(`href="https://planningbrain.com.br/faturamento/pedido/${PEDIDO}"`));
  assert.ok(
    e.html.includes("PORTAL DE FATURAMENTO") && e.html.includes("Hugo, um pedido espera o seu OK"),
  );
  assert.match(e.texto, /só vai para o Omie depois do seu OK/);
  assert.match(e.texto, /R\$ 1\.500,00/);
  assert.match(
    montarEmail(notif("ok_pendente", { papel: "substituto" })).texto,
    /Você é substituto\(a\) do dono/,
  );
  assert.match(
    montarEmail(notif("ok_pendente", { papel: "gestor" })).texto,
    /gestor\(a\) da DOC e o pedido está sem dono ativo/,
  );
  assert.equal(linkDoPedido("a b"), "https://planningbrain.com.br/faturamento/pedido/a%20b");
});

test("devolvido leva o motivo; faturado leva número e link da nota; em atraso e erro no Omie", () => {
  const dev = montarEmail(
    notif("devolvido", { papel: "autor", dados: { motivo: "Falta o projeto certo" } }),
  );
  assert.equal(dev.assunto, "Pedido devolvido: FAT-2026-000012");
  assert.match(dev.texto, /Motivo: Falta o projeto certo/);
  const fat = montarEmail(
    notif("faturado", { dados: { nf_numero: "4521", nf_link: "https://nfse.exemplo/4521" } }),
  );
  assert.equal(fat.assunto, "Pedido faturado: FAT-2026-000012 · NF 4521");
  assert.ok(fat.html.includes('href="https://nfse.exemplo/4521"'));
  assert.match(fat.texto, /com a nota 4521/);
  const atraso = montarEmail(notif("em_atraso"));
  assert.equal(atraso.assunto, "Em atraso: FAT-2026-000012");
  assert.match(atraso.texto, /1º vencimento: 13\/11\/2026/);
  const erro = montarEmail(
    notif("erro_omie", {
      papel: "tesouraria",
      dados: { motivo: "O Omie da DOC recusou a ordem de serviço: Tag inválida." },
    }),
  );
  assert.equal(erro.assunto, "Erro no Omie: FAT-2026-000012 (DOC)");
  assert.match(
    erro.texto,
    /O que o Omie disse: O Omie da DOC recusou a ordem de serviço: Tag inválida\./,
  );
  assert.match(erro.texto, /na fila da tesouraria/);
  assert.match(
    montarEmail(notif("erro_omie", { papel: "autor" })).texto,
    /Corrija o que o Omie pediu ou reenvie/,
  );
});

test("nada de CPF ou CNPJ completo: o motivo é mascarado e o documento não vem nos dados", () => {
  const e = montarEmail(
    notif("erro_omie", {
      dados: {
        motivo: "CNPJ/CPF inválido [11.222.333/0001-81] e CPF 529.982.247-25, alfa 12ABC34501DE35",
      },
    }),
  );
  assert.ok(!e.texto.includes("11.222.333/0001-81") && !e.html.includes("11.222.333/0001-81"));
  assert.ok(!e.texto.includes("529.982.247-25") && !e.texto.includes("12ABC34501DE35"));
  assert.match(e.texto, /11\.\*\*\*\.\*\*\*\/\*\*\*\*-81/);
  assert.equal(semDocumento("22.333.444/0001-55"), "22.***.***/****-55");
  assert.equal(semDocumento("52998224725"), "***.***.***-25");
  assert.equal(semDocumento("NFS-e 4521 · OS 3021"), "NFS-e 4521 · OS 3021", "número curto fica");
});

test("HTML escapa o que vem do pedido", () => {
  const e = montarEmail(
    notif("devolvido", { dados: { tomador_nome: "<script>x</script> & Cia", motivo: '"aspas"' } }),
  );
  assert.ok(!e.html.includes("<script>x</script>"));
  assert.ok(e.html.includes("&lt;script&gt;x&lt;/script&gt; &amp; Cia"));
});

// ---------------------------------------------------------------------------------------------- simulação e envio

test("sem FATURAMENTO_EMAIL=sim, nada sai: simulado com o e-mail pronto", async () => {
  let chamadas = 0;
  const enviar = async () => {
    chamadas++;
    return { status: 202, texto: "" };
  };
  const r = await processarNotificacao(notif("faturado"), { ligado: false, enviar });
  assert.equal(r.status, "simulado");
  assert.equal(chamadas, 0);
  assert.equal(r.email, "hugo.silva@planning.com.br");
  assert.equal(r.assunto, "Pedido faturado: FAT-2026-000012");
  assert.ok(r.corpo.startsWith("<!doctype html>"));
  assert.equal(r.resposta.simulado, "FATURAMENTO_EMAIL desligado");
  assert.match(r.resposta.texto, /^Hugo,/);
});

test("pedido simulado no Omie nunca manda e-mail, nem com a variável ligada", async () => {
  let chamadas = 0;
  const r = await processarNotificacao(notif("faturado", { dados: { simulacao: true } }), {
    ligado: true,
    enviar: async () => {
      chamadas++;
      return { status: 202, texto: "" };
    },
  });
  assert.equal(r.status, "simulado");
  assert.equal(chamadas, 0);
  assert.match(r.assunto, /^\[Simulação\] /);
  assert.equal(r.resposta.simulado, "pedido simulado no Omie");
});

test("ligado: 202 enviado (remetente noreply), 429 volta para a fila, 400 vira erro; sem e-mail ativo não envia", async () => {
  const pedidos = [];
  const ok = await processarNotificacao(notif("em_atraso"), {
    ligado: true,
    enviar: async (e) => {
      pedidos.push(corpoSendgrid(e));
      return { status: 202, texto: "" };
    },
  });
  assert.equal(ok.status, "enviado");
  assert.deepEqual(pedidos[0].from, REMETENTE);
  assert.equal(REMETENTE.email, "noreply@planningbrain.com.br");
  assert.deepEqual(pedidos[0].personalizations, [
    { to: [{ email: "hugo.silva@planning.com.br" }] },
  ]);
  assert.deepEqual(
    pedidos[0].content.map((c) => c.type),
    ["text/plain", "text/html"],
  );
  assert.equal(
    (
      await processarNotificacao(notif("em_atraso"), {
        ligado: true,
        enviar: async () => ({ status: 429, texto: "" }),
      })
    ).status,
    "pendente",
  );
  const ruim = await processarNotificacao(notif("em_atraso"), {
    ligado: true,
    enviar: async () => ({ status: 400, texto: "bad" }),
  });
  assert.equal(ruim.status, "erro");
  assert.match(ruim.erro_legivel, /SendGrid recusou o e-mail \(HTTP 400\)/);
  let chamou = false;
  const semEmail = await processarNotificacao(
    notif("em_atraso", { destinatario: { email: null } }),
    {
      ligado: true,
      enviar: async () => {
        chamou = true;
        return { status: 202, texto: "" };
      },
    },
  );
  assert.equal(semEmail.status, "erro");
  assert.equal(chamou, false);
  assert.match(semEmail.erro_legivel, /não tem e-mail ativo/);
});

test("rodada: cada notificação uma vez, mesmo repetida na reserva; simulação não chama o SendGrid", async () => {
  const lotes = [
    [notif("ok_pendente"), notif("devolvido", { papel: "autor" }), notif("ok_pendente")],
    [],
  ];
  let i = 0;
  const respostas = [];
  let envios = 0;
  const resumo = await rodarFilaNotificacoes({
    reservar: async () => lotes[i++] ?? [],
    responder: async (id, r) => {
      respostas.push({ id, status: r.status });
    },
    ligado: false,
    enviar: async () => {
      envios++;
      return { status: 202, texto: "" };
    },
    orcamentoMs: 10_000,
  });
  assert.deepEqual(respostas, [
    { id: "n-ok_pendente", status: "simulado" },
    { id: "n-devolvido", status: "simulado" },
  ]);
  assert.equal(envios, 0);
  assert.deepEqual(resumo.por_status, { simulado: 2 });
});
