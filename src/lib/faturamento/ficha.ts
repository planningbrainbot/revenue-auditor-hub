// A Ficha do pedido (`/faturamento/pedido/$id`, contrato `docs/design/contratos/faturamento-pedido.md`):
// as ações por situação (uma `default`, as outras `outline`, desabilitadas com o motivo que o banco manda),
// a faixa da situação, os quatro números do resumo e as linhas "Onde está no Omie e no Pipefy?".
//
// Quem pode cada ação é o banco (`fat_pedido.acoes`, API.md §1.4); aqui só a ordem, o rótulo e a frase.
// Nada soma dinheiro: os valores do resumo vêm prontos da RPC (ARQUETIPOS §4).
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-ficha.test.mjs.
import type { AcaoFicha, EnvioOmie, EnvioPipefy, FichaPedido, Situacao } from "./tipos.ts";
import {
  dataCompleta,
  diaEHora,
  diaMes,
  diaSP,
  dinheiro,
  documento,
  horaSP,
  primeiroNome,
  rotuloMes,
} from "./formato.ts";

// ------------------------------------------------------------------ ações

const POR_SITUACAO: Record<Situacao, { principal?: AcaoFicha; outras: AcaoFicha[] }> = {
  rascunho: { principal: "editar", outras: [] },
  aguardando_ok: { principal: "aprovar", outras: ["devolver", "pedir_cancelamento"] },
  devolvido: { principal: "editar", outras: [] },
  na_fila_omie: { outras: ["atualizar_status", "pedir_cancelamento"] },
  erro_omie: { principal: "reenviar", outras: ["devolver", "pedir_cancelamento"] },
  simulado: { principal: "conferir", outras: ["faturar", "devolver"] },
  os_criada: { principal: "conferir", outras: ["faturar", "devolver", "pedir_cancelamento"] },
  em_conferencia: { principal: "faturar", outras: ["devolver", "pedir_cancelamento"] },
  faturado: { outras: ["pedir_cancelamento", "atualizar_status"] },
  em_atraso: { outras: ["pedir_cancelamento", "atualizar_status"] },
  recebido: { outras: ["pedir_cancelamento", "atualizar_status"] },
  cancelamento_pedido: { principal: "confirmar_cancelamento", outras: [] },
  cancelado: { outras: [] },
};

export interface BotaoAcao {
  chave: AcaoFicha;
  rotulo: string;
  principal: boolean;
  pode: boolean;
  /** A frase do botão desabilitado (N8). */
  motivo: string | null;
}

function rotuloDaAcao(chave: AcaoFicha, f: FichaPedido): string {
  const s = f.pedido.status;
  switch (chave) {
    case "editar":
      return s === "devolvido" ? "Corrigir" : "Continuar editando";
    case "aprovar":
      return "Dar OK e enviar ao Omie";
    case "devolver":
      return "Devolver";
    case "reenviar":
      return "Reenviar";
    case "conferir":
      return "Conferir";
    case "faturar":
      return f.pedido.simulacao || s === "simulado" ? "Faturar em simulação" : "Faturar";
    case "pedir_cancelamento":
      return "Pedir cancelamento";
    case "confirmar_cancelamento":
      return "Confirmar cancelamento";
    case "atualizar_status":
      return "Atualizar agora";
    case "descartar":
      return "Descartar";
    case "enviar":
      return "Enviar";
  }
}

/**
 * Os botões da Ficha para a situação do pedido (contrato, "Ações por situação"), na ordem: a `default`
 * primeiro. Quem vê o pedido e não tem o papel vê o botão desabilitado com o motivo, não escondido (N8).
 */
export function acoesDaFicha(f: FichaPedido): BotaoAcao[] {
  const regra = POR_SITUACAO[f.pedido.status] ?? { outras: [] };
  const chaves = [...(regra.principal ? [regra.principal] : []), ...regra.outras];
  return chaves.map((chave) => {
    const a = f.acoes?.[chave];
    return {
      chave,
      rotulo: rotuloDaAcao(chave, f),
      principal: chave === regra.principal,
      pode: !!a?.pode,
      motivo: a?.pode ? null : (a?.motivo ?? "Ação indisponível agora."),
    };
  });
}

// ------------------------------------------------------------------ faixa da situação

function ultimoEvento(f: FichaPedido, evento: string) {
  return f.eventos.find((e) => e.evento === evento) ?? null;
}

function motivoDoEvento(diff: FichaPedido["eventos"][number]["diff"]): string | null {
  const m = diff && typeof diff === "object" ? (diff as Record<string, unknown>).motivo : null;
  return typeof m === "string" && m.trim() ? m.trim() : null;
}

/**
 * A linha da faixa da situação, quando a situação pede algo de alguém (contrato, Anatomia item 3):
 * "Devolvido por Marina em 22/10: '…'", "Aguardando o OK de Hugo desde 21/10.", "O Omie recusou em
 * 22/10 às 10:12: '…'", "Simulado: nada foi gravado no Omie da DOC.". `null` quando não há o que dizer.
 */
export function faixaDaSituacao(f: FichaPedido): string | null {
  const p = f.pedido;
  const empresa = p.emissora.apelido;
  switch (p.status) {
    case "devolvido": {
      const e = ultimoEvento(f, "devolvido");
      const motivo = (e && motivoDoEvento(e.diff)) ?? p.motivo_status;
      const quem = e?.autor ? primeiroNome(e.autor.nome) : null;
      const quando = diaMes(e?.em ?? p.status_em);
      return `Devolvido${quem ? ` por ${quem}` : ""}${quando ? ` em ${quando}` : ""}${motivo ? `: '${motivo}'` : "."}`;
    }
    case "aguardando_ok": {
      const desde = diaMes(p.status_em);
      return `Aguardando o OK de ${primeiroNome(p.dono?.nome) || "o dono"}${desde ? ` desde ${desde}` : ""}.`;
    }
    case "erro_omie": {
      const quando = diaEHora(p.status_em);
      return `O Omie recusou${quando ? ` em ${quando}` : ""}${p.motivo_status ? `: '${p.motivo_status}'` : "."}`;
    }
    case "simulado":
      return `Simulado: nada foi gravado no Omie da ${empresa}.`;
    case "cancelamento_pedido": {
      const e = ultimoEvento(f, "cancelamento_pedido");
      const motivo = (e && motivoDoEvento(e.diff)) ?? p.motivo_status;
      const quem = e?.autor ? primeiroNome(e.autor.nome) : null;
      return `Cancelamento pedido${quem ? ` por ${quem}` : ""}${motivo ? `: '${motivo}'` : ""}. A tesouraria cancela no Omie e confirma aqui.`;
    }
    default:
      if (p.simulacao && ["faturado", "em_atraso", "recebido", "em_conferencia"].includes(p.status))
        return `Em simulação: nada foi gravado nem emitido no Omie da ${empresa}.`;
      return null;
  }
}

// ------------------------------------------------------------------ resumo (quatro números)

export type EstadoNumero = "ok" | "nao-apurado";

export interface NumeroFicha {
  rotulo: string;
  valor: string;
  nota: string;
  estado: EstadoNumero;
}

const COM_NOTA: Situacao[] = ["faturado", "em_atraso", "recebido"];

/** Os quatro números da faixa de resumo (contrato, "Resumo"), lidos de `fat_pedido.resumo`. */
export function resumoDaFicha(f: FichaPedido): NumeroFicha[] {
  const p = f.pedido;
  const r = f.resumo;
  const temNota = !!p.omie.nf_numero || COM_NOTA.includes(p.status);
  const ausente = p.simulacao ? "simulado" : !temNota ? "sem nota ainda" : null;
  const forma =
    p.forma === "avulso"
      ? "à vista"
      : p.forma === "parcelado" && p.parcelas
        ? `${p.parcelas} parcelas`
        : "—";
  const prox = r.proximo_vencimento;
  return [
    { rotulo: "Valor", valor: dinheiro(r.valor ?? p.valor), nota: forma, estado: "ok" },
    ausente
      ? { rotulo: "Recebido", valor: "—", nota: ausente, estado: "nao-apurado" }
      : {
          rotulo: "Recebido",
          valor: dinheiro(r.recebido),
          nota: `${r.parcelas_pagas} de ${r.parcelas_total} ${r.parcelas_total === 1 ? "parcela" : "parcelas"}`,
          estado: "ok",
        },
    ausente
      ? { rotulo: "Em atraso", valor: "—", nota: ausente, estado: "nao-apurado" }
      : {
          rotulo: "Em atraso",
          valor: dinheiro(r.em_atraso),
          nota: "vencidas e não pagas",
          estado: "ok",
        },
    prox
      ? {
          rotulo: "Próximo vencimento",
          valor: dataCompleta(prox.data) ?? "—",
          nota: prox.previsto || prox.valor === null ? "previsto" : dinheiro(prox.valor),
          estado: "ok",
        }
      : {
          rotulo: "Próximo vencimento",
          valor: "—",
          nota: "nenhuma parcela a vencer",
          estado: "nao-apurado",
        },
  ];
}

// ------------------------------------------------------------------ Omie e Pipefy

export interface LinhaIntegracao {
  chave: "cliente" | "os" | "nota" | "pipefy" | "leitura";
  titulo: string;
  texto: string;
  /** Erro legível do Omie ou do Pipefy: a linha leva o tom de perigo. */
  erro: boolean;
  link?: { href: string; rotulo: string };
}

function ultimoEnvio(envios: EnvioOmie[], operacoes: string[]): EnvioOmie | null {
  const daOperacao = envios.filter((e) => operacoes.includes(e.operacao));
  return daOperacao.length ? daOperacao[daOperacao.length - 1] : null;
}

function quando(momento: string | null | undefined, hoje: string): string {
  if (!momento) return "";
  return diaSP(momento) === hoje ? `às ${horaSP(momento)}` : `em ${diaEHora(momento)}`;
}

function codigo(e: EnvioOmie | null, chave: string): unknown {
  return e?.codigos && typeof e.codigos === "object"
    ? (e.codigos as Record<string, unknown>)[chave]
    : undefined;
}

function linhaPendente(e: EnvioOmie, hoje: string, rotulo: string): string {
  return e.proxima_tentativa_em
    ? `${rotulo}: o Omie tenta ${quando(e.proxima_tentativa_em, hoje)}`
    : `${rotulo}.`;
}

/**
 * "Onde está no Omie e no Pipefy?" (contrato, mesma seção): uma linha por etapa do envio, em português.
 * @param hoje `AAAA-MM-DD` em São Paulo.
 */
export function linhasIntegracao(f: FichaPedido, hoje: string): LinhaIntegracao[] {
  const p = f.pedido;
  const empresa = p.emissora.apelido;
  const envios = f.omie.envios ?? [];
  const linhas: LinhaIntegracao[] = [];

  // Cliente
  const cli = ultimoEnvio(envios, ["garantir_cliente"]);
  let textoCli = "Ainda não enviado ao Omie.";
  let erroCli = false;
  if (cli) {
    const existia = codigo(cli, "cliente_existia");
    if (cli.status === "erro") {
      textoCli = cli.erro_legivel ?? "O Omie recusou o cliente.";
      erroCli = true;
    } else if (cli.status === "simulado")
      textoCli = existia === true ? "Já existe" : "Seria cadastrado";
    else if (cli.status === "ok")
      textoCli =
        existia === true
          ? "Já existia"
          : `Cadastrado pelo portal em ${dataCompleta(cli.atualizado_em)}, com os dados da Receita e o e-mail do pedido`;
    else textoCli = linhaPendente(cli, hoje, "Na fila");
  }
  linhas.push({
    chave: "cliente",
    titulo: `Cliente no Omie da ${empresa}`,
    texto: textoCli,
    erro: erroCli,
  });

  // OS
  const os = ultimoEnvio(envios, ["incluir_os", "alterar_os"]);
  let textoOs = "Ainda não enviada ao Omie.";
  let erroOs = false;
  if (p.omie.os_codigo) {
    textoOs = `OS ${p.omie.os_codigo}${p.omie.os_etapa ? ` · etapa ${p.omie.os_etapa}` : ""}`;
  } else if (os?.status === "simulado" || (p.simulacao && !os)) {
    textoOs = `Seria criada com o código ${p.numero}`;
    if (codigo(os, "servico_existe") === false)
      textoOs += `; o envio daria erro: serviço não encontrado no Omie da ${empresa}`;
  } else if (os?.status === "erro") {
    textoOs = os.erro_legivel ?? "O Omie recusou a OS.";
    erroOs = true;
  } else if (os) {
    textoOs = linhaPendente(os, hoje, "Na fila");
  }
  linhas.push({ chave: "os", titulo: "OS", texto: textoOs, erro: erroOs });

  // Nota
  const fat = ultimoEnvio(envios, ["faturar_os"]);
  const noOmie = f.eventos.find((e) => e.evento === "faturado_no_omie");
  let textoNota = "Ainda não emitida.";
  let erroNota = false;
  let linkNota: LinhaIntegracao["link"];
  if (p.omie.nf_numero) {
    textoNota = noOmie
      ? `Faturada direto no Omie: NFS-e ${p.omie.nf_numero} (lida ${quando(noOmie.em, hoje)})`
      : `NFS-e ${p.omie.nf_numero}${p.omie.nf_emitida_em ? ` emitida em ${dataCompleta(p.omie.nf_emitida_em)}` : ""}`;
    if (p.omie.nf_link) linkNota = { href: p.omie.nf_link, rotulo: "Abrir a nota" };
  } else if (p.simulacao && COM_NOTA.includes(p.status)) {
    textoNota = "Faturada em simulação: nenhuma nota emitida.";
  } else if (fat && (fat.status === "pendente" || fat.status === "processando")) {
    textoNota = linhaPendente(fat, hoje, "Faturando");
  } else if (fat?.status === "erro") {
    textoNota = fat.erro_legivel ?? "O Omie recusou o faturamento.";
    erroNota = true;
  }
  linhas.push({ chave: "nota", titulo: "Nota", texto: textoNota, erro: erroNota, link: linkNota });

  // Pipefy
  const cards = f.pipefy.envios ?? [];
  const ultimo: EnvioPipefy | null = cards.length ? cards[cards.length - 1] : null;
  const cardUrl = [...cards].reverse().find((c) => c.card_url)?.card_url ?? null;
  let textoPipefy = "Ainda não há card: ele nasce quando o pedido entra na fila do Omie.";
  let erroPipefy = false;
  if (ultimo) {
    if (ultimo.status === "erro") {
      textoPipefy = ultimo.erro_legivel ?? "O Pipefy recusou o card.";
      erroPipefy = true;
    } else if (
      ultimo.status === "simulado" ||
      (!p.emissora.pipefy_sync && ultimo.status !== "ok")
    ) {
      textoPipefy = ultimo.fase
        ? `Card montado e guardado, não enviado. Iria para a fase ${ultimo.fase}.`
        : "Card montado e guardado, não enviado (o Pipefy está desligado para a empresa).";
    } else if (ultimo.status === "ok") {
      textoPipefy = ultimo.fase
        ? `Fase ${ultimo.fase} no pipe Contas a Receber`
        : "Card no pipe Contas a Receber";
    } else {
      textoPipefy = "Na fila do Pipefy.";
    }
  }
  linhas.push({
    chave: "pipefy",
    titulo: "Card no Pipefy",
    texto: textoPipefy,
    erro: erroPipefy,
    link: cardUrl ? { href: cardUrl, rotulo: "Abrir card" } : undefined,
  });

  // Última leitura
  const lido = p.omie.lido_em;
  const proxima = f.omie.leitura_pendente?.tentar_em ?? null;
  const textoLeitura = p.simulacao
    ? "Pedido simulado: não há situação no Omie para ler."
    : [
        lido
          ? `Situação lida do Omie ${quando(lido, hoje)}`
          : "A situação ainda não foi lida do Omie",
        proxima ? `a próxima é ${quando(proxima, hoje)}` : null,
      ]
        .filter(Boolean)
        .join("; ") + ".";
  linhas.push({ chave: "leitura", titulo: "Última leitura", texto: textoLeitura, erro: false });
  return linhas;
}

// ------------------------------------------------------------------ o que iria ao Omie (simulação)

const DOCUMENTO: Record<string, string> = {
  nf: "Nota fiscal",
  recibo: "Recibo",
  nd: "Nota de débito",
};

/**
 * "Isto é o que iria" (contrato, simulação): a lista legível do envio, montada só com o que a pessoa já vê
 * na Ficha. O envio completo (payload) fica nos "Detalhes técnicos", que só a tesouraria e a controladoria
 * recebem do banco.
 */
export function oQueIriaAoOmie(f: FichaPedido): { rotulo: string; valor: string }[] {
  const p = f.pedido;
  const os = ultimoEnvio(f.omie.envios ?? [], ["incluir_os", "alterar_os"]);
  const cli = ultimoEnvio(f.omie.envios ?? [], ["garantir_cliente"]);
  const clienteExiste = codigo(os, "cliente_existe") ?? codigo(cli, "cliente_existia");
  const servicoExiste = codigo(os, "servico_existe");
  const parcelas = f.parcelas.length
    ? f.parcelas
        .map((x) => `${x.n}ª ${dataCompleta(x.vencimento)} · ${dinheiro(x.valor)}`)
        .join("; ")
    : "—";
  return [
    { rotulo: "Empresa", valor: `${p.emissora.apelido} · ${p.emissora.razao_social}` },
    {
      rotulo: "Cliente",
      valor: [
        p.tomador.nome ?? "—",
        documento(p.tomador.documento),
        clienteExiste === true
          ? "já existe no Omie"
          : clienteExiste === false
            ? "seria cadastrado no Omie"
            : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      rotulo: "Serviço",
      valor: p.servico
        ? [
            p.servico.descricao,
            p.servico.codigo,
            servicoExiste === false
              ? `o envio daria erro: serviço não encontrado no Omie da ${p.emissora.apelido}`
              : servicoExiste === true
                ? "existe no Omie"
                : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "—",
    },
    { rotulo: "Código do pedido no Omie", valor: p.numero },
    { rotulo: "Documento", valor: p.documento ? (DOCUMENTO[p.documento] ?? p.documento) : "—" },
    { rotulo: "Descrição da nota", valor: p.descricao_nf ?? "—" },
    { rotulo: "Valor", valor: dinheiro(p.valor) },
    { rotulo: "Parcelas e vencimentos", valor: parcelas },
    { rotulo: "Competência", valor: rotuloMes(p.competencia) ?? "—" },
    { rotulo: "E-mails de envio", valor: p.emails_envio.length ? p.emails_envio.join(", ") : "—" },
    { rotulo: "Cobrança", valor: p.meio === "pix" ? "Pix" : p.meio === "boleto" ? "Boleto" : "—" },
  ];
}

// ------------------------------------------------------------------ o alvo das ações

/** O que os diálogos precisam saber do pedido. A Ficha e a linha da fila montam isto. */
export interface AlvoPedido {
  id: string;
  numero: string;
  status: Situacao;
  apelido: string;
  cliente: string | null;
  valor: number | null;
  parcelas: number | null;
  simulacao: boolean;
  osCodigo: number | null;
  /** Quem escreveu o pedido: para quem a devolução volta. */
  autor: string | null;
}

export type AcaoExecutavel =
  | "aprovar"
  | "devolver"
  | "reenviar"
  | "conferir"
  | "faturar"
  | "pedir_cancelamento"
  | "confirmar_cancelamento"
  | "atualizar_status";

export function alvoDaFicha(f: FichaPedido): AlvoPedido {
  return {
    id: f.pedido.id,
    numero: f.pedido.numero,
    status: f.pedido.status,
    apelido: f.pedido.emissora.apelido,
    cliente: f.pedido.tomador.nome,
    valor: f.pedido.valor,
    parcelas: f.pedido.parcelas,
    simulacao: f.pedido.simulacao || f.pedido.status === "simulado",
    osCodigo: f.pedido.omie.os_codigo,
    autor: f.pedido.solicitante?.nome ?? null,
  };
}
