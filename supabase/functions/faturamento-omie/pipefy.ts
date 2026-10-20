/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipefy e do banco chega sem tipo. */
// Pipefy do Portal de Faturamento (T3 da E1, 20/10/2026): o card do pipe 307098392 (Contas a Receber [FIN][MATRIZ])
// nasce quando o pedido entra na fila do Omie e anda a cada mudança de situação, servindo de painel (decisão da Ana,
// spec §13.3 item 4). Lógica pura, sem API do Deno: testada no Node em tests/faturamento-pipefy.test.mjs.
//
// Fontes: e1/pipefy-307098392-mapa.md (§1.3 status → fase, §2 campos, §3 Colaboradores, §7 mutations e a "Mudança de
// 20/10"), o schema gerado em pipefy-307098392.ts e a fila da T1b (integracoes.pipefy_envios, API.md §2.7 e §2.8).
//
// Travas:
// 1. **pipefy_sync = false** (todas as emissoras hoje): monta as mutations, valida contra o schema e grava `simulado`
//    com elas prontas. O cliente GraphQL recusa qualquer `mutation` antes da rede; consulta (leitura da Table
//    Colaboradores) passa, para a mutation sair com os ids certos.
// 2. Só `pipefy_sync === true` grava. Mesmo assim, nada sai se a validação contra o schema falhar.
// 3. O token fica no servidor (index.ts): esta lógica não o vê.
//
// Fases (mapa §1.3, com as decisões de 20/10):
// - na_fila_omie, na primeira vez: createCard (cai em SOLICITAÇÃO ABERTA) e o checklist cpf_cnpj_do_cliente_conferido
//   marcado pelo portal, que já validou o documento. Nas voltas à fila (reenvio), o card não muda.
// - em_conferencia: Responsável pelo ticket = quem conferiu na tesouraria; → VALIDAÇÃO DE DADOS.
// - faturado: → APROVADO (Status do faturamento = Faturado, data e nº/link da NFS-e) → FATURAMENTO REALIZADO, com o
//   PDF da NFS-e no "Upload do e-mail" (destrava a saída de lá).
// - devolvido: volta a SOLICITAÇÃO ABERTA com "A demanda possui todas as informações" = Não e o motivo.
// - cancelado: até ARQUIVADO pelos caminhos permitidos.
// - simulado, os_criada, erro_omie, em_atraso, cancelamento_pedido e recebido: o card fica onde está. Recebido não vai
//   para FINALIZADO, que hoje quer dizer "e-mail anexado", e o pipe não tem campo de pagamento: só se registra.

import {
  CAMPOS_INICIO,
  FASES,
  OPCAO_CONFERIDO,
  PIPE,
  type CampoPipefy,
} from "./pipefy-307098392.ts";
import {
  centavos,
  cortar,
  dataBr,
  documento,
  documentoFormatado,
  hojeSP,
  listaEmails,
} from "./logica.ts";

export const VERSAO_PIPEFY = "faturamento-pipefy-v1-2026-10-20";
export const PIPEFY_URL = "https://api.pipefy.com/graphql";
export const MAX_TENTATIVAS_PIPEFY = 6;
export const MAX_POR_RODADA_PIPEFY = 20;

export const FASE = {
  ABERTA: "342815180",
  VALIDACAO: "342815181",
  APROVADO: "342815669",
  REALIZADO: "342866194",
  FINALIZADO: "342815182",
  ARQUIVADO: "342815683",
} as const;
export const nomeFase = (id: string | null | undefined) => (id ? (FASES[id]?.nome ?? id) : null);

/** Situação do portal → fase em que o card deve ficar (null = não move). */
export const ALVO: Record<string, string | null> = {
  na_fila_omie: null,
  simulado: null,
  erro_omie: null,
  os_criada: null,
  em_conferencia: FASE.VALIDACAO,
  faturado: FASE.REALIZADO,
  em_atraso: null,
  recebido: null,
  devolvido: FASE.ABERTA,
  cancelamento_pedido: null,
  cancelado: FASE.ARQUIVADO,
};
/** Onde o card está depois de cada situação, para estimar a fase em simulação (sem card de verdade). */
const FASE_DEPOIS: Record<string, string> = {
  na_fila_omie: FASE.ABERTA,
  simulado: FASE.ABERTA,
  os_criada: FASE.ABERTA,
  erro_omie: FASE.ABERTA,
  devolvido: FASE.ABERTA,
  cancelamento_pedido: FASE.ABERTA,
  em_conferencia: FASE.VALIDACAO,
  faturado: FASE.REALIZADO,
  em_atraso: FASE.REALIZADO,
  recebido: FASE.REALIZADO,
  cancelado: FASE.ARQUIVADO,
};
/** Por que a situação não move o card (vai para a resposta). */
const SEM_MOVIMENTO: Record<string, string> = {
  na_fila_omie: "Pedido de volta à fila do Omie (reenvio): o card já existe e fica onde está.",
  simulado:
    "Pedido simulado no Omie: o card fica em SOLICITAÇÃO ABERTA (o pipe não tem fase de simulação).",
  os_criada: "OS criada: o card espera a conferência da tesouraria em SOLICITAÇÃO ABERTA.",
  erro_omie: "Erro no Omie: o card fica onde está; o erro aparece no portal.",
  em_atraso:
    "Em atraso: o pipe não tem fase nem etiqueta de atraso; o card fica em FATURAMENTO REALIZADO.",
  recebido:
    "Recebido: FINALIZADO hoje quer dizer 'e-mail anexado', não 'pago', e o pipe não tem campo de pagamento. " +
    "O card fica em FATURAMENTO REALIZADO e o recebimento fica registrado só no portal.",
  cancelamento_pedido: "Cancelamento pedido: o card fica onde está até a tesouraria efetivar.",
};

export const Q = {
  criarCard:
    "mutation CriarCardDoPedido($input: CreateCardInput!) { createCard(input: $input) { card { id url current_phase { id name } } } }",
  campos:
    "mutation PreencherCampos($input: UpdateFieldsValuesInput!) { updateFieldsValues(input: $input) { success userErrors { field message } } }",
  mover:
    "mutation MoverCard($input: MoveCardToPhaseInput!) { moveCardToPhase(input: $input) { card { id current_phase { id name } } } }",
  urlAnexo:
    "mutation UrlDoAnexo($input: CreatePresignedUrlInput!) { createPresignedUrl(input: $input) { url downloadUrl } }",
  colaboradores:
    "query Colaboradores($tabela: ID!, $depois: String) { table_records(table_id: $tabela, first: 50, after: $depois) { pageInfo { hasNextPage endCursor } edges { node { id record_fields { field { id } value } } } } }",
  card: "query CardDoPedido($id: ID!) { card(id: $id) { id url current_phase { id name } fields { field { id } value } } }",
  cardsPorTitulo:
    "query CardsPeloProjeto($pipe: ID!, $titulo: String!) { cards(pipe_id: $pipe, first: 30, search: { title: $titulo }) { edges { node { id url current_phase { id } fields { field { id } value } } } } }",
};

export type Mutacao = { nome: string; query: string; variables: any };
export type ResultadoPipefy = {
  status: "ok" | "simulado" | "erro" | "pendente";
  resposta: any;
  erro_legivel: string | null;
  card_id: string | null;
};

const texto = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
const MARCADOR = /^«.*»$/;
const marcadorColaborador = (email: string) => `«id de ${email} em Colaboradores»`;

// ---------------------------------------------------------------------------------------------------- validação

/** Erro do valor para o tipo do campo do Pipefy, ou null. Aceita valor simples ou lista de um item (updateFieldsValues). */
export function erroDoValor(
  def: CampoPipefy,
  valor: unknown,
  aceitarMarcador = false,
): string | null {
  const lista = Array.isArray(valor) ? valor.map((x) => String(x)) : null;
  const unico = lista
    ? lista.length === 1
      ? lista[0]
      : null
    : valor == null
      ? null
      : String(valor);
  switch (def.tipo) {
    case "connector":
      if (!lista || !lista.length) return "precisa de uma lista com o id do registro";
      if (lista.every((x) => /^[0-9]+$/.test(x) || (aceitarMarcador && MARCADOR.test(x))))
        return null;
      return "id de registro inválido";
    case "checklist_vertical":
    case "checklist_horizontal":
      if (!lista || !lista.length) return "precisa de uma lista de opções";
      return lista.every((x) => def.opcoes?.includes(x))
        ? null
        : `opção fora da lista (${lista.join(", ")})`;
    case "attachment":
      if (!lista || !lista.length) return "precisa da lista com o caminho do arquivo";
      return lista.every((x) => x.trim() !== "") ? null : "caminho vazio";
  }
  if (unico == null || unico.trim() === "") return "vazio";
  switch (def.tipo) {
    case "select":
    case "radio_horizontal":
    case "radio_vertical":
      return def.opcoes?.includes(unico) ? null : `"${unico}" não é uma das opções`;
    case "short_text":
      return unico.length <= 255 ? null : "passa de 255 caracteres";
    case "long_text":
      return null;
    case "email":
      return /^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$/.test(unico) ? null : "e-mail inválido";
    case "cnpj":
      return /^[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-[0-9]{2}$/.test(unico)
        ? null
        : "CNPJ fora da máscara";
    case "cpf":
      return /^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$/.test(unico) ? null : "CPF fora da máscara";
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(unico)) return "data fora do formato AAAA-MM-DD";
      const d = new Date(`${unico}T12:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === unico
        ? null
        : "data inexistente";
    }
    case "currency":
      return /^[0-9]+\.[0-9]{2}$/.test(unico) ? null : "valor fora do formato 1500.00";
    case "number":
      return /^[0-9]+$/.test(unico) ? null : "número inválido";
    default:
      return null;
  }
}

/** createCard contra o schema: pipe, campos do formulário, obrigatórios, opções e tipos. */
export function validarCriarCard(input: any, aceitarMarcador = false): string[] {
  const erros: string[] = [];
  if (String(input?.pipe_id) !== PIPE.id)
    erros.push(`pipe_id ${input?.pipe_id} não é o ${PIPE.id}`);
  for (const k of ["phase_id", "title", "submitterEmail"]) {
    if (input && k in input) erros.push(`${k} não vai no createCard (mapa §7.1)`);
  }
  const vistos = new Set<string>();
  for (const f of Array.isArray(input?.fields_attributes) ? input.fields_attributes : []) {
    const def = CAMPOS_INICIO[f.field_id];
    if (!def) {
      erros.push(`campo ${f.field_id} não existe no formulário`);
      continue;
    }
    if (vistos.has(f.field_id)) erros.push(`campo ${f.field_id} repetido`);
    vistos.add(f.field_id);
    const e = erroDoValor(def, f.field_value, aceitarMarcador);
    if (e) erros.push(`${def.label}: ${e}`);
  }
  for (const [id, def] of Object.entries(CAMPOS_INICIO)) {
    if (def.obrigatorio && !vistos.has(id)) erros.push(`${def.label}: obrigatório e não veio`);
  }
  return erros;
}

/** updateFieldsValues de uma fase: o campo é da fase (ou do formulário), a operação é REPLACE e o valor bate com o tipo. */
export function validarCampos(fase: string, values: any[], aceitarMarcador = false): string[] {
  const erros: string[] = [];
  for (const v of values) {
    const def = FASES[fase]?.campos[v.fieldId] ?? CAMPOS_INICIO[v.fieldId];
    if (!def) {
      erros.push(`campo ${v.fieldId} não existe em ${nomeFase(fase)}`);
      continue;
    }
    if (v.operation !== "REPLACE") erros.push(`${def.label}: operação ${v.operation}`);
    const e = erroDoValor(def, v.value, aceitarMarcador);
    if (e) erros.push(`${def.label}: ${e}`);
  }
  return erros;
}

export const podeMover = (de: string, para: string) => !!FASES[de]?.pode_ir_para.includes(para);

/**
 * Caminho de fases permitido (cards_can_be_moved_to_phases), o mais curto. FATURAMENTO REALIZADO e FINALIZADO só
 * servem de passagem quando o card já está numa delas: cancelar um card não faturado não passa por "faturado".
 */
export function rota(de: string, para: string): string[] | null {
  if (de === para) return [de];
  const posFaturamento = new Set<string>([FASE.REALIZADO, FASE.FINALIZADO]);
  const evitar = posFaturamento.has(de) ? new Set<string>() : posFaturamento;
  const anterior = new Map<string, string>([[de, ""]]);
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const prox of FASES[atual]?.pode_ir_para ?? []) {
      if (anterior.has(prox)) continue;
      if (prox !== para && evitar.has(prox)) continue;
      anterior.set(prox, atual);
      if (prox === para) {
        const caminho = [para];
        let p = atual;
        while (p) {
          caminho.unshift(p);
          p = anterior.get(p) || "";
        }
        return caminho;
      }
      fila.push(prox);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------- montagem do card

/** Opção exata de "Empresa de faturamento" pelo CNPJ da emissora (mapa §2.1). */
export function opcaoEmpresa(cnpj: unknown): string | null {
  const f = documentoFormatado(cnpj);
  return (CAMPOS_INICIO.empresa_de_faturamento.opcoes ?? []).find((o) => o.includes(f)) ?? null;
}

const mesAno = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ""));
  return m ? { a: Number(m[1]), m: Number(m[2]) } : null;
};
/** Competência em relação ao mês do envio: "Mês do faturamento", "Mês anterior ao faturamento" ou "Outro". */
export function opcaoCompetencia(
  competencia: string | null | undefined,
  hoje: string,
): string | null {
  const c = mesAno(competencia);
  const h = mesAno(hoje);
  if (!c || !h) return null;
  const d = h.a * 12 + h.m - (c.a * 12 + c.m);
  return d === 0 ? "Mês do faturamento" : d === 1 ? "Mês anterior ao faturamento" : "Outro";
}

const reais = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Texto de Observações (particularidades): o que o card não tem campo próprio, abrindo com o aviso ao Financeiro. */
export function observacoes(payload: any) {
  const ped = payload?.pedido ?? {};
  const parcelas = [...(payload?.parcelas ?? [])].sort((a: any, b: any) => a.n - b.n);
  const emails = listaEmails(ped.emails_envio);
  const comp = mesAno(ped.competencia);
  const linhas = [
    `Pedido ${ped.numero} do Portal de Faturamento. A OS é criada pelo portal: não lançar no Omie.`,
    texto(ped.descricao_nf) && `Descrição da NF: ${texto(ped.descricao_nf)}`,
    comp && `Competência: ${String(comp.m).padStart(2, "0")}/${comp.a}`,
    ped.documento === "nd" &&
      "Documento: nota de débito (o pipe não tem a opção; vai como Recibo, por OS no Omie).",
    parcelas.length > 1 &&
      `Parcelas: ${parcelas.map((p: any) => `${p.n}/${parcelas.length} em ${dataBr(p.vencimento)} R$ ${reais(centavos(p.valor))}`).join("; ")}`,
    emails.length > 1 && `Outros e-mails de envio: ${emails.slice(1).join(", ")}`,
    texto(ped.observacoes) && `Observações do solicitante: ${String(ped.observacoes).trim()}`,
  ];
  return linhas.filter(Boolean).join("\n");
}

/**
 * createCard do pedido (mapa §2 e §7.1): os 17 obrigatórios do formulário, a partir da foto do pedido.
 * - Responsável pela solicitação e Coordenação responsável (o dono) pela Table Colaboradores, casada pelo e-mail
 *   comercial. Sem par, a falta diz qual e-mail cadastrar.
 * - À vista manda "1" em Número de parcelas (obrigatório e escondido).
 * - Vigências por aproximação: a competência (dia 1) e o vencimento da última parcela.
 * `colaborador(email)` devolve o id, null (não cadastrado) ou undefined (lista não lida).
 */
export function montarCriarCard(
  payload: any,
  o: { colaborador: (email: string) => string | null | undefined; agora: Date },
) {
  const ped = payload?.pedido ?? {};
  const t = payload?.tomador ?? {};
  const s = payload?.servico ?? {};
  const parcelas = [...(payload?.parcelas ?? [])].sort((a: any, b: any) => a.n - b.n);
  const n = parcelas.length || Number(ped.parcelas) || 1;
  const doc = documento(t.documento);
  const pj = t.tipo ? t.tipo === "pj" : doc.length === 14;
  const emails = listaEmails(ped.emails_envio);
  const faltas: string[] = [];
  const avisos: string[] = [];
  const fields: Array<{ field_id: string; field_value: any }> = [];
  const add = (field_id: string, field_value: any) => fields.push({ field_id, field_value });

  const pessoa = (quem: any, papel: string, obrigatorio: boolean) => {
    const email = texto(quem?.email).toLowerCase();
    if (!email) {
      if (obrigatorio)
        faltas.push(`O ${papel} do pedido não tem e-mail no Brain para casar com Colaboradores.`);
      return null;
    }
    const id = o.colaborador(email);
    if (id) return id;
    if (id === null) {
      (obrigatorio ? faltas : avisos).push(
        `O e-mail ${email} (${papel}) não está na tabela Colaboradores do Pipefy: cadastre para o card ${obrigatorio ? "sair" : "levar o " + papel}.`,
      );
      return obrigatorio ? marcadorColaborador(email) : null;
    }
    avisos.push(
      `A tabela Colaboradores não foi lida: o id de ${email} (${papel}) entra na gravação.`,
    );
    return marcadorColaborador(email);
  };
  const solicitante = pessoa(payload?.solicitante, "solicitante", true);
  if (solicitante) add("respons_vel_pela_solicita_o_1", [solicitante]);
  const dono = pessoa(payload?.dono, "dono", false);
  if (dono) add("coordena_o_respons_vel", [dono]);

  const empresa = opcaoEmpresa(payload?.emissora?.cnpj);
  add("empresa_de_faturamento", empresa ?? "");
  if (!empresa) {
    faltas.push(
      `A ${texto(payload?.emissora?.apelido) || "emissora"} não tem opção no campo "Empresa Planning que irá faturar" do pipe: ` +
        "falta a Ana incluir a opção.",
    );
  }
  add("raz_o_social_do_cliente", cortar(t.nome, 255));
  add("o_cliente_pessoa_f_sica_ou_jur_dica", pj ? "Pessoa jurídica (CNPJ)" : "Pessoa física (CPF)");
  add(pj ? "cnpj_cliente_1" : "cpf_do_cliente", documentoFormatado(doc));
  if (pj && /[A-Z]/.test(doc))
    avisos.push("CNPJ alfanumérico: o campo CNPJ do Pipefy ainda não foi testado com letras.");
  add("e_mail_para_envio", emails[0] ?? "");
  const ultima = parcelas[parcelas.length - 1]?.vencimento ?? ped.primeiro_vencimento;
  const inicio = /^\d{4}-\d{2}/.test(String(ped.competencia ?? ""))
    ? `${String(ped.competencia).slice(0, 7)}-01`
    : `${String(ped.primeiro_vencimento ?? "").slice(0, 7)}-01`;
  add("vig_ncia_inicial", inicio);
  add("vig_ncia_final", String(ultima ?? ""));
  add("nome_do_projeto", cortar(ped.projeto, 255));
  add("qual_o_servi_o", cortar(`${s.codigo_omie ?? ""} · ${texto(s.descricao)}`, 255));
  add("copy_of_valor_folha", centavos(ped.valor).toFixed(2));
  const deps = CAMPOS_INICIO.departamento.opcoes ?? [];
  if (texto(ped.departamento)) {
    if (deps.includes(texto(ped.departamento))) add("departamento", texto(ped.departamento));
    else
      avisos.push(
        `O departamento "${texto(ped.departamento)}" não é opção do pipe: o card vai sem departamento.`,
      );
  }
  add("tipo_de_emiss_o_de_documento", ped.documento === "nf" ? "Nota Fiscal" : "Recibo");
  if (ped.documento === "nd")
    avisos.push("Nota de débito vai como Recibo: o pipe não tem a opção (e1/mapa §2).");
  add("tipo_de_faturamento", "Avulso");
  add("condi_es_de_pagamento_vista_ou_parcelado", n > 1 ? "Parcelado" : "À vista");
  add("n_mero_de_parcelas", String(n));
  add("tipo_de_recebimento", ped.meio === "pix" ? "Pix" : "Boleto");
  add("vencimento", String(ped.primeiro_vencimento ?? ""));
  const comp = opcaoCompetencia(ped.competencia, hojeSP(o.agora));
  if (comp) add("compet_ncia_do_servi_o", comp);
  add("particularidades", observacoes(payload));
  if (emails.length > 1)
    avisos.push("O pipe guarda um e-mail de envio: os outros foram para Observações.");

  return { input: { pipe_id: PIPE.id, fields_attributes: fields }, faltas, avisos };
}

/** Marca do portal no checklist da SOLICITAÇÃO ABERTA (Mudança de 20/10): o documento já foi validado. */
export const valorConferido = () => ({
  fieldId: "cpf_cnpj_do_cliente_conferido",
  value: [OPCAO_CONFERIDO],
  operation: "REPLACE",
});

// ---------------------------------------------------------------------------------------------------- plano de fases

export type Passo =
  | {
      tipo: "campos";
      fase: string;
      values: Array<{ fieldId: string; value: any; operation: "REPLACE" }>;
    }
  | { tipo: "mover"; de: string; para: string }
  | { tipo: "anexo"; fase: string; fieldId: string };

/** Campos que o portal já teria preenchido no card depois de cada situação (estimativa em simulação). */
export function preenchidosEstimados(de: string): Set<string> {
  const s = new Set<string>(["cpf_cnpj_do_cliente_conferido"]);
  if (["em_conferencia", "faturado", "em_atraso", "recebido"].includes(de)) {
    s.add("conex_o_de_database");
    s.add("a_demanda_possui_todas_as_informa_es_necess_rias");
  }
  if (["faturado", "em_atraso", "recebido"].includes(de)) {
    s.add("status_do_faturamento");
    s.add("upload_do_e_mail");
  }
  return s;
}

export function faseEstimada(de: string | null | undefined) {
  return FASE_DEPOIS[String(de ?? "")] ?? FASE.ABERTA;
}

const dataDaNota = (emitida: string | null | undefined, agora: Date) => {
  if (emitida) {
    const d = new Date(emitida);
    if (!Number.isNaN(d.getTime())) return hojeSP(d);
  }
  return hojeSP(agora);
};

/**
 * Passos para levar o card à fase da nova situação: preencher o que a fase pede (na chegada e para destravar a saída)
 * e mover pelos caminhos permitidos. `preenchidos` = campos com valor no card (lidos em gravação; estimados em
 * simulação). As faltas impedem gravar; os avisos não.
 */
export function planejar(o: {
  para: string;
  atual: string;
  motivo?: string | null;
  responsavelId?: string | null;
  responsavelFalta?: string | null;
  nf?: {
    numero?: string | null;
    link?: string | null;
    emitida_em?: string | null;
    os?: number | string | null;
  } | null;
  preenchidos: Set<string>;
  agora: Date;
}) {
  const passos: Passo[] = [];
  const faltas: string[] = [];
  const avisos: string[] = [];
  const alvo = ALVO[o.para];
  const registro =
    alvo === undefined || alvo === null
      ? (SEM_MOVIMENTO[o.para] ?? `Situação ${o.para}: o card não muda.`)
      : null;
  let caminho: string[] | null;
  if (o.para === "faturado") {
    caminho =
      o.atual === FASE.REALIZADO || o.atual === FASE.FINALIZADO
        ? [o.atual]
        : (() => {
            const a = rota(o.atual, FASE.APROVADO);
            return a ? [...a, FASE.REALIZADO] : null;
          })();
  } else if (!alvo) {
    caminho = [o.atual];
  } else {
    caminho = rota(o.atual, alvo);
  }
  if (!caminho) {
    faltas.push(`Não há caminho permitido no pipe de ${nomeFase(o.atual)} para ${nomeFase(alvo)}.`);
    return { passos, faltas, avisos, alvo: alvo ?? null, caminho: [o.atual], registro };
  }
  const feitos = new Set(o.preenchidos);
  for (let i = 0; i < caminho.length; i++) {
    const fase = caminho[i];
    const ultima = i === caminho.length - 1;
    const values: Array<{ fieldId: string; value: any; operation: "REPLACE" }> = [];
    const por = (fieldId: string, value: any) => {
      values.push({ fieldId, value, operation: "REPLACE" });
      feitos.add(fieldId);
    };
    // Chegada.
    if (o.para === "faturado" && fase === FASE.APROVADO) {
      por("status_do_faturamento", ["Faturado"]);
      por("data", [dataDaNota(o.nf?.emitida_em, o.agora)]);
      const obs = [
        o.nf?.numero ? `NFS-e ${o.nf.numero}` : "Faturado pelo Portal de Faturamento",
        o.nf?.link ? String(o.nf.link) : null,
        o.nf?.os ? `OS ${o.nf.os}` : null,
      ].filter(Boolean);
      por("observa_o", [obs.join(" · ")]);
    }
    if (o.para === "devolvido" && fase === FASE.ABERTA && ultima) {
      por("a_demanda_possui_todas_as_informa_es_necess_rias", ["Não"]);
      por("quais_informa_es_est_o_faltando_na_solicita_o", [
        texto(o.motivo) || "Devolvido pela tesouraria no portal.",
      ]);
    }
    // Saída: os obrigatórios da fase travam o movimento.
    if (!ultima) {
      if (fase === FASE.ABERTA) {
        if (!feitos.has("conex_o_de_database")) {
          if (o.responsavelId) por("conex_o_de_database", [o.responsavelId]);
          else
            faltas.push(
              o.responsavelFalta ??
                "Falta o Responsável pelo ticket: ninguém da tesouraria conferiu o pedido.",
            );
        }
        if (!feitos.has("cpf_cnpj_do_cliente_conferido")) {
          values.push({ ...(valorConferido() as any) });
          feitos.add("cpf_cnpj_do_cliente_conferido");
        }
        if (
          caminho[caminho.length - 1] !== FASE.ARQUIVADO &&
          !feitos.has("a_demanda_possui_todas_as_informa_es_necess_rias")
        ) {
          por("a_demanda_possui_todas_as_informa_es_necess_rias", ["Sim"]);
        }
      }
      if (fase === FASE.APROVADO && !feitos.has("status_do_faturamento")) {
        faltas.push(
          "O card está em APROVADO PARA FATURAMENTO sem o Status do faturamento: preencha no Pipefy para ele sair.",
        );
      }
      if (fase === FASE.REALIZADO && !feitos.has("upload_do_e_mail")) {
        faltas.push(
          "O card está em FATURAMENTO REALIZADO sem o anexo: anexe o PDF da NFS-e no Pipefy para ele sair.",
        );
      }
    }
    if (values.length) passos.push({ tipo: "campos", fase, values });
    if (o.para === "faturado" && fase === FASE.REALIZADO && !feitos.has("upload_do_e_mail")) {
      passos.push({ tipo: "anexo", fase, fieldId: "upload_do_e_mail" });
      feitos.add("upload_do_e_mail");
    }
    if (!ultima) {
      const prox = caminho[i + 1];
      if (!podeMover(fase, prox))
        faltas.push(`O pipe não deixa mover de ${nomeFase(fase)} para ${nomeFase(prox)}.`);
      passos.push({ tipo: "mover", de: fase, para: prox });
    }
  }
  return { passos, faltas, avisos, alvo: alvo ?? null, caminho, registro };
}

/** As mutations dos passos, como iriam ao Pipefy (o anexo vira createPresignedUrl + PUT + updateFieldsValues). */
export function mutacoesDosPassos(
  cardId: string,
  passos: Passo[],
  arquivo: { nome: string; caminho: string },
) {
  const out: Mutacao[] = [];
  for (const p of passos) {
    if (p.tipo === "campos") {
      out.push({
        nome: "updateFieldsValues",
        query: Q.campos,
        variables: { input: { nodeId: cardId, values: p.values } },
      });
    } else if (p.tipo === "mover") {
      out.push({
        nome: "moveCardToPhase",
        query: Q.mover,
        variables: { input: { card_id: cardId, destination_phase_id: p.para } },
      });
    } else {
      out.push({
        nome: "createPresignedUrl",
        query: Q.urlAnexo,
        variables: {
          input: {
            organizationId: PIPE.organizacao,
            fileName: arquivo.nome,
            contentType: "application/pdf",
          },
        },
      });
      out.push({
        nome: "updateFieldsValues",
        query: Q.campos,
        variables: {
          input: {
            nodeId: cardId,
            values: [{ fieldId: p.fieldId, value: [arquivo.caminho], operation: "REPLACE" }],
          },
        },
      });
    }
  }
  return out;
}

/** Valida cada mutation dos passos contra o schema (campos da fase em que o card estará, movimentos permitidos). */
export function validarPassos(passos: Passo[], aceitarMarcador = false) {
  const erros: string[] = [];
  for (const p of passos) {
    if (p.tipo === "campos") erros.push(...validarCampos(p.fase, p.values, aceitarMarcador));
    else if (p.tipo === "mover" && !podeMover(p.de, p.para))
      erros.push(`movimento ${nomeFase(p.de)} → ${nomeFase(p.para)} não permitido`);
    else if (p.tipo === "anexo" && FASES[p.fase]?.campos[p.fieldId]?.tipo !== "attachment")
      erros.push(`${p.fieldId} não é anexo em ${nomeFase(p.fase)}`);
  }
  return erros;
}

// ---------------------------------------------------------------------------------------------------- cliente GraphQL

export class ErroPipefy extends Error {
  classe: string;
  http: number | null;
  constructor(classe: string, http: number | null, mensagem: string) {
    super(mensagem);
    this.name = "ErroPipefy";
    this.classe = classe;
    this.http = http;
  }
}
export class MutacaoBloqueada extends Error {
  constructor(nome: string) {
    super(`Mutation ${nome} recusada: Pipefy em simulação`);
    this.name = "MutacaoBloqueada";
  }
}

/** POST ao GraphQL do Pipefy. `limiteMs` = o tempo que a chamada pode levar (preso ao que sobra da rodada). */
export type TransportePipefy = (
  corpo: string,
  limiteMs?: number,
) => Promise<{ status: number; texto: string }>;
/** Tempo mínimo para começar uma chamada ao Pipefy antes do fim da rodada, e o teto de uma chamada. */
export const MIN_CHAMADA_PIPEFY_MS = 5_000;
export const MAX_CHAMADA_PIPEFY_MS = 30_000;

/**
 * Modo do Pipefy para um envio: grava só com o pipefy_sync EFETIVO da reserva (pipefy_sync ligado, emissora em gravar e
 * pedido não simulado, calculado pelo banco), a emissora em "gravar" e, conferido aqui também, o pedido não simulado.
 */
export function modoPipefy(
  envio: any,
  pedidoSimulado: boolean | null | undefined,
): "simular" | "gravar" {
  return envio?.pipefy_sync === true &&
    envio?.emissora?.modo_omie === "gravar" &&
    pedidoSimulado !== true
    ? "gravar"
    : "simular";
}

/**
 * Cliente GraphQL do Pipefy para um envio. Em modo diferente de "gravar", toda `mutation` é recusada antes da rede.
 * `chamadas` guarda operação, HTTP e duração (sem variáveis).
 */
export function criarPipefy(o: {
  transporte: TransportePipefy | null;
  modo: "simular" | "gravar";
  relogio?: () => number;
  /** Momento (ms) em que a rodada precisa ter terminado. */
  prazo?: number;
}) {
  const relogio = o.relogio ?? (() => Date.now());
  const chamadas: Array<{ operacao: string; http: number | null; ms: number; erro?: string }> = [];
  async function chamar(query: string, variables: any) {
    const nome = /^\s*(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? "anonima";
    const mutacao = /^\s*mutation\b/.test(query);
    if (mutacao && o.modo !== "gravar") throw new MutacaoBloqueada(nome);
    if (!o.transporte) throw new ErroPipefy("sem_token", null, "PIPEFY_TOKEN ausente no servidor");
    const resta = o.prazo != null ? o.prazo - relogio() : MAX_CHAMADA_PIPEFY_MS;
    if (resta < MIN_CHAMADA_PIPEFY_MS) {
      chamadas.push({ operacao: nome, http: null, ms: 0, erro: "tempo" });
      throw new ErroPipefy("tempo", null, "fim do tempo da rodada");
    }
    const t0 = relogio();
    let http: number | null = null;
    let corpo: any = null;
    try {
      const r = await o.transporte(
        JSON.stringify({ query, variables }),
        Math.min(MAX_CHAMADA_PIPEFY_MS, resta - 1_000),
      );
      http = r.status;
      try {
        corpo = JSON.parse(r.texto);
      } catch {
        corpo = null;
      }
    } catch (e) {
      chamadas.push({ operacao: nome, http, ms: relogio() - t0, erro: "rede" });
      throw new ErroPipefy("passageiro", null, cortar((e as Error)?.message ?? e, 200));
    }
    const msg = cortar(
      (corpo?.errors ?? [])
        .map((x: any) => x?.message)
        .filter(Boolean)
        .join("; "),
      300,
    );
    if (
      http === 401 ||
      http === 403 ||
      /permiss|not authorized|unauthori|acesso negado|access denied/i.test(msg)
    ) {
      chamadas.push({ operacao: nome, http, ms: relogio() - t0, erro: "acesso" });
      throw new ErroPipefy("acesso", http, msg || `HTTP ${http}`);
    }
    if (http === 429 || (http != null && http >= 500) || (http === 200 && !corpo)) {
      chamadas.push({ operacao: nome, http, ms: relogio() - t0, erro: "passageiro" });
      throw new ErroPipefy("passageiro", http, msg || `HTTP ${http}`);
    }
    if (http !== 200 || msg) {
      chamadas.push({ operacao: nome, http, ms: relogio() - t0, erro: "recusa" });
      throw new ErroPipefy("recusa", http, msg || `HTTP ${http}`);
    }
    chamadas.push({ operacao: nome, http, ms: relogio() - t0 });
    return corpo.data;
  }
  return { consulta: chamar, mutacao: chamar, chamadas, modo: o.modo };
}
export type Pipefy = ReturnType<typeof criarPipefy>;

/** E-mail comercial → id do registro na Table Colaboradores (até 5 páginas de 50). */
export async function lerColaboradores(pf: Pipefy): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  let depois: string | null = null;
  for (let pagina = 0; pagina < 5; pagina++) {
    const d: any = await pf.consulta(Q.colaboradores, {
      tabela: PIPE.colaboradores.tabela,
      depois,
    });
    const tr = d?.table_records;
    for (const e of tr?.edges ?? []) {
      const campo = (e?.node?.record_fields ?? []).find(
        (f: any) => f?.field?.id === PIPE.colaboradores.email,
      );
      const email = texto(campo?.value).toLowerCase();
      if (email && e?.node?.id && !mapa.has(email)) mapa.set(email, String(e.node.id));
    }
    if (!tr?.pageInfo?.hasNextPage) break;
    depois = tr.pageInfo.endCursor;
  }
  return mapa;
}

const temValor = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s !== "" && s !== "[]" && s !== "null";
};

// ---------------------------------------------------------------------------------------------------- envio

export type ContextoPipefy = {
  pipefy: Pipefy;
  modo: "simular" | "gravar";
  agora: () => Date;
  /** E-mail → id em Colaboradores, ou null se a tabela não pôde ser lida. */
  colaboradores: () => Promise<Map<string, string> | null>;
  /** ops.fat_conector_pipefy_contexto (responsável da tesouraria, card_id, nota). */
  contexto: (pedido: string) => Promise<any>;
  /** PDF da NFS-e do pedido (gravação; lido do Omie). Nulo se não houver. */
  pdfDaNota?: (envio: any, contexto: any) => Promise<{ nome: string; bytes: Uint8Array } | null>;
  /** PUT do arquivo na URL assinada do Pipefy. */
  subir?: (url: string, bytes: Uint8Array) => Promise<void>;
};

const fim = (
  ctx: ContextoPipefy,
  resposta: any,
  card_id: string | null = null,
): ResultadoPipefy => ({
  status: ctx.modo === "gravar" ? "ok" : "simulado",
  resposta,
  erro_legivel: null,
  card_id,
});
const erroP = (resposta: any, erro_legivel: string): ResultadoPipefy => ({
  status: "erro",
  resposta,
  erro_legivel,
  card_id: null,
});

function colaboradorDe(mapa: Map<string, string> | null) {
  return (email: string) => (mapa ? (mapa.get(email.toLowerCase()) ?? null) : undefined);
}

async function criarCard(envio: any, ctx: ContextoPipefy): Promise<ResultadoPipefy> {
  const payload = envio?.payload ?? {};
  let mapa: Map<string, string> | null = null;
  let avisoLeitura: string | null = null;
  try {
    mapa = await ctx.colaboradores();
  } catch (e) {
    avisoLeitura = `A tabela Colaboradores não pôde ser lida: ${cortar((e as Error)?.message ?? e, 200)}.`;
  }
  const { input, faltas, avisos } = montarCriarCard(payload, {
    colaborador: colaboradorDe(mapa),
    agora: ctx.agora(),
  });
  if (avisoLeitura) avisos.unshift(avisoLeitura);
  const conferido = {
    fieldId: valorConferido().fieldId,
    value: valorConferido().value,
    operation: "REPLACE" as const,
  };
  // Marcador («id de … em Colaboradores») vale na validação: ele já virou falta ou aviso, e nunca chega a uma mutation
  // (em gravação, falta de cadastro ou lista não lida voltam para a fila antes de criar).
  const erros = [
    ...validarCriarCard(input, true),
    ...validarCampos(FASE.ABERTA, [conferido], false),
  ];
  const mutacoes: Mutacao[] = [
    { nome: "createCard", query: Q.criarCard, variables: { input } },
    {
      nome: "updateFieldsValues",
      query: Q.campos,
      variables: { input: { nodeId: "«card.id do createCard»", values: [conferido] } },
    },
  ];
  const base = {
    operacao: "criar_card",
    leituras: { colaboradores_lidos: mapa ? mapa.size : null },
    fase: nomeFase(FASE.ABERTA),
    mutacoes,
    validacao: { ok: !erros.length, erros },
    faltas,
    avisos,
  };
  const semEmpresa = opcaoEmpresa(payload?.emissora?.cnpj)
    ? null
    : faltas.find((f) => f.includes("Empresa Planning que irá faturar"));
  if (ctx.modo !== "gravar") {
    if (erros.length || semEmpresa) {
      return erroP(
        base,
        `Em gravação o Pipefy recusaria o card: ${[...(semEmpresa ? [semEmpresa] : []), ...erros].join(" ")}`.trim(),
      );
    }
    return fim(ctx, base);
  }
  if (avisoLeitura) {
    return {
      status: "pendente",
      resposta: base,
      erro_legivel: `${avisoLeitura} O card é criado na próxima tentativa.`,
      card_id: null,
    };
  }
  if (erros.length || semEmpresa)
    return erroP(
      base,
      `O card não foi criado: ${[...(semEmpresa ? [semEmpresa] : []), ...erros].join(" ")}`,
    );
  if (faltas.length || JSON.stringify(input).includes("«")) {
    // Falta de cadastro em Colaboradores: volta para a fila e cria sozinho depois do cadastro.
    return { status: "pendente", resposta: base, erro_legivel: faltas.join(" "), card_id: null };
  }
  // Idempotência: tentativa anterior pode ter criado o card e caído antes de gravar o id. Procura pelo título (projeto)
  // e pelo número do pedido em Observações antes de criar de novo.
  const numero = String(payload?.pedido?.numero ?? "");
  const titulo = String(
    input.fields_attributes.find((f: any) => f.field_id === "nome_do_projeto")?.field_value ?? "",
  );
  let cardId: string | null = null;
  let url: string | null = null;
  if (numero && titulo) {
    const d = await ctx.pipefy.consulta(Q.cardsPorTitulo, { pipe: PIPE.id, titulo });
    for (const e of d?.cards?.edges ?? []) {
      const obs = (e?.node?.fields ?? []).find(
        (f: any) => f?.field?.id === "particularidades",
      )?.value;
      if (String(obs ?? "").includes(`Pedido ${numero} `)) {
        cardId = String(e.node.id);
        url = e.node.url ?? null;
        break;
      }
    }
  }
  const jaExistia = !!cardId;
  if (!cardId) {
    const d = await ctx.pipefy.mutacao(Q.criarCard, { input });
    cardId = d?.createCard?.card?.id ? String(d.createCard.card.id) : null;
    url = d?.createCard?.card?.url ?? null;
    if (!cardId)
      return erroP(
        base,
        "O Pipefy não devolveu o id do card criado: confira o pipe antes de reenviar.",
      );
  }
  const r = await ctx.pipefy.mutacao(Q.campos, { input: { nodeId: cardId, values: [conferido] } });
  const ue = r?.updateFieldsValues?.userErrors ?? [];
  if (ue.length)
    avisos.push(
      `O checklist de documento conferido não foi marcado: ${cortar(ue.map((x: any) => x.message).join("; "), 200)}.`,
    );
  return fim(ctx, { ...base, card_url: url, ja_existia: jaExistia }, cardId);
}

async function moverFase(envio: any, ctx: ContextoPipefy): Promise<ResultadoPipefy> {
  const payload = envio?.payload ?? {};
  const para = String(payload?.para ?? "");
  const contexto = envio?.origem_id ? await ctx.contexto(String(envio.origem_id)) : null;
  const cardId: string | null = envio?.card_id ?? contexto?.card_id ?? null;
  const ped = { ...(contexto?.pedido ?? {}), ...(payload?.pedido ?? {}) };
  const base: Record<string, any> = { operacao: "mover_fase", de: payload?.de ?? null, para };

  if (ctx.modo === "gravar" && !cardId) {
    return erroP(
      base,
      "Este pedido não tem card no Pipefy: ele entrou na fila com o Pipefy desligado. Crie o card antes de seguir.",
    );
  }
  // Fase atual e campos preenchidos: lidos do card em gravação, estimados pelo histórico em simulação.
  let atual = faseEstimada(payload?.de);
  let preenchidos = preenchidosEstimados(String(payload?.de ?? ""));
  let url: string | null = null;
  if (ctx.modo === "gravar") {
    const d = await ctx.pipefy.consulta(Q.card, { id: cardId });
    if (!d?.card?.current_phase?.id)
      return erroP(base, `O card ${cardId} não foi achado no Pipefy: confira se foi apagado.`);
    atual = String(d.card.current_phase.id);
    url = d.card.url ?? null;
    preenchidos = new Set(
      (d.card.fields ?? [])
        .filter((f: any) => temValor(f?.value))
        .map((f: any) => String(f.field.id)),
    );
  } else {
    base.fase_atual_estimada = nomeFase(atual);
  }

  const resp = contexto?.responsavel_ticket ?? null;
  let responsavelId: string | null = null;
  let responsavelFalta: string | null = null;
  // O responsável só é lido quando o card vai sair de onde está (é ele que destrava SOLICITAÇÃO ABERTA).
  const sai =
    para === "faturado"
      ? ![FASE.REALIZADO, FASE.FINALIZADO].includes(atual as any)
      : !!ALVO[para] && ALVO[para] !== atual;
  const avisos: string[] = [];
  if (sai) {
    if (!resp?.email) {
      responsavelFalta =
        "Falta o Responsável pelo ticket: ninguém da tesouraria conferiu nem agiu no pedido.";
    } else {
      let mapa: Map<string, string> | null = null;
      try {
        mapa = await ctx.colaboradores();
      } catch (e) {
        avisos.push(
          `A tabela Colaboradores não pôde ser lida: ${cortar((e as Error)?.message ?? e, 200)}.`,
        );
      }
      if (ctx.modo === "gravar" && mapa === null) {
        return {
          status: "pendente",
          resposta: { ...base, avisos },
          erro_legivel:
            "A tabela Colaboradores do Pipefy não pôde ser lida agora; o envio volta para a fila sozinho.",
          card_id: null,
        };
      }
      base.leituras = { colaboradores_lidos: mapa ? mapa.size : null };
      const id = colaboradorDe(mapa)(resp.email);
      if (id) responsavelId = id;
      else if (id === null)
        responsavelFalta = `O e-mail ${resp.email} (responsável pelo ticket) não está na tabela Colaboradores do Pipefy: cadastre para o card andar.`;
      else {
        responsavelId = marcadorColaborador(resp.email);
        avisos.push(`O id de ${resp.email} (responsável pelo ticket) entra na gravação.`);
      }
    }
  }
  const plano = planejar({
    para,
    atual,
    motivo: payload?.motivo ?? ped?.motivo_status ?? null,
    responsavelId,
    responsavelFalta,
    nf: {
      numero: ped?.omie_nf_numero,
      link: ped?.omie_nf_link,
      emitida_em: ped?.omie_nf_emitida_em,
      os: ped?.omie_os_codigo,
    },
    preenchidos,
    agora: ctx.agora(),
  });
  avisos.push(...plano.avisos);
  const nomeArquivo = `NFSe-${ped?.omie_nf_numero ?? ped?.numero ?? "pedido"}.pdf`;
  const mutacoes = mutacoesDosPassos(cardId ?? "«card_id do criar_card»", plano.passos, {
    nome: nomeArquivo,
    caminho: "«caminho do PDF da NFS-e depois do upload»",
  });
  const erros = validarPassos(plano.passos, ctx.modo !== "gravar");
  Object.assign(base, {
    fase: nomeFase(plano.caminho[plano.caminho.length - 1]),
    caminho: plano.caminho.map(nomeFase),
    registro: plano.registro,
    mutacoes,
    validacao: { ok: !erros.length, erros },
    faltas: plano.faltas,
    avisos,
    responsavel_ticket: resp ? { origem: resp.origem ?? null, email: resp.email ?? null } : null,
  });
  if (ctx.modo !== "gravar") {
    if (erros.length)
      return erroP(base, `Em gravação o Pipefy recusaria o movimento: ${erros.join(" ")}`);
    if (plano.faltas.length) avisos.push(...plano.faltas.map((f) => `Em gravação: ${f}`));
    return fim(ctx, base);
  }
  if (erros.length) return erroP(base, `O card não foi movido: ${erros.join(" ")}`);
  if (plano.faltas.length) {
    const cadastro = plano.faltas.some((f) => f.includes("Colaboradores"));
    return {
      status: cadastro ? "pendente" : "erro",
      resposta: base,
      erro_legivel: plano.faltas.join(" "),
      card_id: null,
    };
  }
  // Executa na ordem. Um passo que falha para tudo; a próxima tentativa relê a fase do card e segue de onde ficou.
  const feitos: string[] = [];
  for (const p of plano.passos) {
    if (p.tipo === "campos") {
      const r = await ctx.pipefy.mutacao(Q.campos, { input: { nodeId: cardId, values: p.values } });
      const ue = r?.updateFieldsValues?.userErrors ?? [];
      if (ue.length || r?.updateFieldsValues?.success === false) {
        return erroP(
          { ...base, feitos },
          `O Pipefy recusou os campos de ${nomeFase(p.fase)}: ${cortar(ue.map((x: any) => x.message).join("; "), 300)}`,
        );
      }
      feitos.push(`campos em ${nomeFase(p.fase)}`);
    } else if (p.tipo === "mover") {
      await ctx.pipefy.mutacao(Q.mover, {
        input: { card_id: cardId, destination_phase_id: p.para },
      });
      feitos.push(`→ ${nomeFase(p.para)}`);
    } else {
      const pdf = ctx.pdfDaNota ? await ctx.pdfDaNota(envio, contexto) : null;
      if (!pdf || !ctx.subir) {
        avisos.push(
          "O PDF da NFS-e ainda não está disponível no Omie: o card ficou em FATURAMENTO REALIZADO sem o anexo.",
        );
        continue;
      }
      const u = await ctx.pipefy.mutacao(Q.urlAnexo, {
        input: {
          organizationId: PIPE.organizacao,
          fileName: pdf.nome,
          contentType: "application/pdf",
        },
      });
      const alvoUrl = u?.createPresignedUrl?.url;
      if (!alvoUrl)
        return erroP(
          { ...base, feitos },
          "O Pipefy não devolveu a URL para anexar o PDF da NFS-e.",
        );
      await ctx.subir(alvoUrl, pdf.bytes);
      const caminho = new URL(alvoUrl).pathname.replace(/^\/+/, "");
      const r = await ctx.pipefy.mutacao(Q.campos, {
        input: {
          nodeId: cardId,
          values: [{ fieldId: p.fieldId, value: [caminho], operation: "REPLACE" }],
        },
      });
      if ((r?.updateFieldsValues?.userErrors ?? []).length) {
        return erroP({ ...base, feitos }, "O Pipefy recusou o anexo do PDF da NFS-e.");
      }
      feitos.push("PDF da NFS-e anexado");
    }
  }
  return fim(ctx, { ...base, feitos, avisos, card_url: url }, cardId);
}

/** O que fazer com um erro do Pipefy. */
export function decidirPipefy(e: ErroPipefy, envio: any): ResultadoPipefy {
  const resposta = { erro: { classe: e.classe, http: e.http, pipefy: cortar(e.message, 300) } };
  if (e.classe === "tempo") {
    return { status: "pendente", resposta, erro_legivel: null, card_id: null };
  }
  if (e.classe === "passageiro") {
    const t = Number(envio?.tentativas ?? 1);
    if (t >= MAX_TENTATIVAS_PIPEFY) {
      return erroP(
        resposta,
        `O Pipefy não respondeu em ${t} tentativas. Reenvie mais tarde; nada foi duplicado.`,
      );
    }
    return {
      status: "pendente",
      resposta,
      erro_legivel: "O Pipefy não respondeu agora; o envio volta para a fila sozinho.",
      card_id: null,
    };
  }
  if (e.classe === "acesso" || e.classe === "sem_token") {
    return erroP(
      resposta,
      `O token do Pipefy do Brain não tem acesso ao pipe ${PIPE.id} (Contas a Receber): ${cortar(e.message, 200)}`,
    );
  }
  return erroP(
    resposta,
    `O Pipefy recusou ${envio?.operacao === "criar_card" ? "o card" : "o movimento do card"}: ${cortar(e.message, 300)}`,
  );
}

/** Processa um envio do Pipefy. Nunca lança. */
export async function processarPipefy(envio: any, ctx: ContextoPipefy): Promise<ResultadoPipefy> {
  const cabeca = {
    versao: VERSAO_PIPEFY,
    modo: ctx.modo,
    pipefy_sync: envio?.pipefy_sync === true,
  };
  let r: ResultadoPipefy;
  try {
    if (envio?.operacao === "criar_card") r = await criarCard(envio, ctx);
    else if (envio?.operacao === "mover_fase") r = await moverFase(envio, ctx);
    else r = erroP({}, `Operação ${String(envio?.operacao)} não é do conector do Pipefy.`);
  } catch (e) {
    if (e instanceof ErroPipefy) r = decidirPipefy(e, envio);
    else if (e instanceof MutacaoBloqueada) {
      r = erroP(
        { barrado: e.message },
        "O conector tentou gravar no Pipefy com a emissora em simulação e foi barrado: nada foi gravado. Avise o time do Brain.",
      );
    } else {
      r = erroP(
        { falha: cortar((e as Error)?.message ?? e, 300) },
        "Falha interna do conector do Pipefy: nada foi gravado. Avise o time do Brain.",
      );
    }
  }
  if (ctx.modo !== "gravar" && r.status === "ok") r = { ...r, status: "simulado" };
  if (ctx.modo !== "gravar") r = { ...r, card_id: null };
  return { ...r, resposta: { ...cabeca, ...(r.resposta ?? {}), chamadas: ctx.pipefy.chamadas } };
}

// ---------------------------------------------------------------------------------------------------- fila

export type DependenciasPipefy = {
  reservar: (limite: number) => Promise<any[]>;
  /** fat_conector_pipefy_resultado com a ficha da reserva (envio.reserva). */
  responder: (envio: any, r: ResultadoPipefy) => Promise<any>;
  /** Momento (ms) em que a rodada precisa ter terminado. */
  prazo?: number;
  contexto: (pedido: string) => Promise<any>;
  transporte: TransportePipefy | null;
  pdfDaNota?: ContextoPipefy["pdfDaNota"];
  subir?: ContextoPipefy["subir"];
  agora?: () => Date;
  relogio?: () => number;
  orcamentoMs: number;
  maxEnvios?: number;
};

/** Uma rodada da fila do Pipefy: modo por envio (pipefy_sync da emissora), Colaboradores lido uma vez. */
export async function rodarFilaPipefy(d: DependenciasPipefy) {
  const relogio = d.relogio ?? (() => Date.now());
  const agora = d.agora ?? (() => new Date(relogio()));
  const inicio = relogio();
  const max = d.maxEnvios ?? MAX_POR_RODADA_PIPEFY;
  const resumo = {
    versao: VERSAO_PIPEFY,
    reservados: 0,
    por_status: {} as Record<string, number>,
    envios: [] as Array<Record<string, any>>,
    erros_banco: [] as Array<Record<string, any>>,
  };
  let colabs: Promise<Map<string, string> | null> | null = null;
  const leitor = criarPipefy({
    transporte: d.transporte,
    modo: "simular",
    relogio,
    prazo: d.prazo,
  });
  const colaboradores = () => {
    if (!d.transporte) return Promise.resolve(null);
    colabs ??= lerColaboradores(leitor);
    return colabs;
  };
  const temTempo = () =>
    relogio() - inicio < d.orcamentoMs &&
    (d.prazo == null || d.prazo - relogio() > 2 * MIN_CHAMADA_PIPEFY_MS);
  while (resumo.reservados < max && temTempo()) {
    const lista = await d.reservar(Math.min(5, max - resumo.reservados));
    if (!Array.isArray(lista) || !lista.length) break;
    resumo.reservados += lista.length;
    for (const envio of lista) {
      const t0 = relogio();
      let r: ResultadoPipefy;
      if (!temTempo()) {
        r = {
          status: "pendente",
          resposta: { liberado: "fim do tempo da rodada" },
          erro_legivel: null,
          card_id: null,
        };
      } else {
        // Pedido simulado no Omie nunca vira card de verdade: o banco já entrega o pipefy_sync efetivo, e a edge confere
        // o pedido antes de qualquer mutation.
        let modo = modoPipefy(envio, null);
        let semContexto = false;
        if (modo === "gravar" && envio?.origem_id) {
          try {
            const c = await d.contexto(String(envio.origem_id));
            modo = modoPipefy(envio, c?.pedido?.simulacao === true);
          } catch {
            semContexto = true;
          }
        }
        r = semContexto
          ? {
              status: "pendente",
              resposta: { versao: VERSAO_PIPEFY, liberado: "pedido não lido" },
              erro_legivel:
                "Não consegui ler o pedido agora; o envio do Pipefy volta para a fila sozinho.",
              card_id: null,
            }
          : await processarPipefy(envio, {
              pipefy: criarPipefy({ transporte: d.transporte, modo, relogio, prazo: d.prazo }),
              modo,
              agora,
              colaboradores,
              contexto: d.contexto,
              pdfDaNota: d.pdfDaNota,
              subir: d.subir,
            });
      }
      try {
        await d.responder(envio, r);
      } catch (e) {
        resumo.erros_banco.push({
          envio: envio?.id ?? null,
          erro: cortar((e as Error)?.message ?? e, 300),
        });
      }
      resumo.por_status[r.status] = (resumo.por_status[r.status] ?? 0) + 1;
      resumo.envios.push({
        id: envio?.id ?? null,
        operacao: envio?.operacao ?? null,
        para: envio?.payload?.para ?? null,
        emissora: envio?.emissora?.apelido ?? null,
        status: r.status,
        ms: relogio() - t0,
      });
    }
  }
  return resumo;
}
