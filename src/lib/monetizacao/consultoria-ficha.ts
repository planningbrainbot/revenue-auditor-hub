// Ficha completa da empresa na Consultoria (aba "Buscar empresa", contrato
// docs/design/contratos/monetizacao-consultoria-empresa.md). Pura: recebe o payload de
// ops.consultoria_empresa_ficha(...), que é o espelho da plataforma do Pedro Siqueira
// (supabase/functions/consultoria-plataforma-sync), e devolve o que a ficha mostra.
// Testes: tests/monetizacao-consultoria-ficha.test.mjs.

/** JSON do RPC: tipado assim (e não `unknown`) para a função de servidor poder serializar. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Rec = { [k: string]: Json };

export interface FichaBruta {
  lido_em: string;
  sincronizado_em: string | null;
  porta_financeiro: { aberta: boolean; motivo: string | null };
  clientes: Rec[];
  projetos: Rec[];
  prazos: Rec[];
  gestores_projeto: Rec[];
  gestores: Rec[];
  teses: Rec[];
  temas_projeto: Rec[];
  areas: Rec[];
  fups: Rec[];
  historico: Rec[];
  retificacoes: Rec[];
  propostas: Rec[];
  classificacao: Rec[];
  estoques: Rec[];
  movimentos: Rec[];
  utilizacoes: Rec[];
  canais: Rec[];
  parceiros: Rec[];
  faturas: Rec[] | null;
  recebimentos: Rec[] | null;
  provisoes: Rec[] | null;
}

/** O que a busca acrescenta ao índice (ops.consultoria_plataforma_indice). */
export interface IndicePlataforma {
  lido_em: string;
  sincronizado_em: string | null;
  projetos_sem_cliente: {
    id: string;
    nome: string | null;
    apelido: string | null;
    departamento: string | null;
    etapa: string | null;
    produto: string | null;
    baixado: boolean | null;
    data_entrada: string | null;
  }[];
  teses_sem_projeto: { empresa: string; teses: number; valor: number | null }[];
  propostas: {
    id: string;
    empresa: string | null;
    cnpj: string | null;
    cliente_id: string | null;
    produto: string | null;
    status: string | null;
    percentual_exito: number | string | null;
    valor_total: number | string | null;
    data_envio: string | null;
  }[];
}

// ─── Normalização ────────────────────────────────────────────────────────────────────────────────

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const zero = (v: unknown) => num(v) ?? 0;
const dia = (v: unknown) => {
  const s = txt(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export const DEPARTAMENTO: Record<string, string> = {
  diagnostico_tributario: "Diagnóstico Tributário",
  retificacoes: "Retificações",
  juridico: "Jurídico",
  projetos_especificos: "Projetos específicos",
  reforma_tributaria: "Reforma Tributária",
};
export const ETAPA_PLATAFORMA: Record<string, string> = {
  fila_processamento: "Fila de Processamento",
  fluxo_documentos: "Fluxo de Documentos",
  operacao: "Operação",
  qualidade: "Qualidade",
  saida_entrega: "Saída / Entrega",
  pos_entrega: "Pós-entrega",
};
const SUB_STATUS: Record<string, string> = {
  em_andamento: "em andamento",
  em_negociacao: "em negociação",
  nao_iniciada: "não iniciada",
  concluido: "concluído",
  aguardando: "aguardando",
};
export const AREA: Record<string, string> = {
  impostos_diretos: "Impostos diretos",
  impostos_indiretos: "Impostos indiretos",
  previdenciario_juridico: "Previdenciário e jurídico",
};
const rotulo = (mapa: Record<string, string>, v: unknown) => {
  const s = txt(v);
  return s ? (mapa[s] ?? s.replace(/_/g, " ")) : null;
};

// ─── O que a ficha mostra ────────────────────────────────────────────────────────────────────────

export type TomTese = "sucesso" | "info" | "atencao" | "perigo" | "neutro";
/** Status da tese na plataforma (`convertido_status`) → tom do selo. "Sim" = o cliente fechou a tese. */
export function tomTese(status: string | null): TomTese {
  if (status === "Sim") return "sucesso";
  if (status === "Em Negociação" || status === "Em operação") return "info";
  if (status === "Declinado" || status === "Não") return "perigo";
  if (status === "Baixada") return "neutro";
  return "neutro";
}

export interface Tese {
  id: string;
  tema: string;
  tributos: string | null;
  perfil: string | null;
  valor: number;
  status: string | null;
  statusOperacional: string | null;
  periodo: string | null;
  /** Nome do projeto; `null` = tese importada sem projeto (casada pelo nome da empresa). */
  projeto: string | null;
  projetoId: string | null;
}

/** As teses que somam no valor identificado: a API deixa de fora as declinadas e as baixadas (642 de 642 projetos
 *  conferidos em 16/10/2026). */
export const contaNoValor = (status: string | null) => status !== "Declinado" && status !== "Baixada";

export interface Evento {
  data: string;
  quem: string | null;
  texto: string;
}

export interface Fup {
  data: string;
  autor: string | null;
  texto: string;
  tipo: string | null;
  projeto: string;
}

export interface ProjetoFicha {
  id: string;
  nome: string;
  produto: string | null;
  departamento: string | null;
  etapa: string | null;
  subStatus: string | null;
  baixado: boolean;
  motivoBaixa: string | null;
  dataBaixa: string | null;
  entrada: string | null;
  entrega: string | null;
  documentosCompletos: string | null;
  responsavel: string | null;
  gestores: string[];
  canal: string | null;
  parceiro: string | null;
  prioridade: number | null;
  observacoes: string | null;
  prazo: {
    diasNaEtapa: number | null;
    meta: number | null;
    unidade: string | null;
    alem: number | null;
    venceEm: string | null;
  } | null;
  teses: Tese[];
  /** Valor das teses que contam (fora as declinadas e as baixadas): a mesma conta do valor identificado da API. */
  valor: number;
  areas: { area: string; expectativa: number | null; notas: string | null; em: string | null }[];
  semCliente: boolean;
}

export interface PropostaFicha {
  id: string;
  empresa: string | null;
  produto: string | null;
  status: string | null;
  rotuloStatus: string;
  tom: TomTese;
  valorTotal: number | null;
  valorFixo: number | null;
  exito: number | null;
  parcelas: number | null;
  cobranca: string | null;
  envio: string | null;
  aceite: string | null;
  perda: string | null;
  motivoPerda: string | null;
  responsavel: string | null;
  parceiro: string | null;
  ultimoFup: string | null;
  proximoFup: string | null;
  descricao: string | null;
}

export interface MovimentoCredito {
  competencia: string;
  compensacoes: number;
  depositos: number;
  pedidos: number;
  cobranca: number;
}

export interface EstoqueFicha {
  id: string;
  tipo: string | null;
  status: string | null;
  inicio: string | null;
  aprovado: number;
  utilizado: number;
  saldo: number;
  exitoPct: number | null;
  exitoGerado: number;
  gestorConta: string | null;
  formaConsumo: string | null;
  acessoVia: string | null;
  parceiro: string | null;
  movimentos: MovimentoCredito[];
}

export interface FaturaFicha {
  data: string | null;
  competencia: string | null;
  descricao: string | null;
  categoria: string | null;
  valor: number;
  status: string | null;
}

export interface RecebimentoFicha {
  vencimento: string | null;
  credito: string | null;
  documento: string | null;
  categoria: string | null;
  valor: number;
  recebido: number;
  aReceber: number;
  status: string | null;
  emAtraso: boolean;
}

export interface Cadastro {
  razao: string;
  fantasia: string | null;
  grupo: string | null;
  parceiro: string | null;
  regime: string | null;
  porte: string | null;
  natureza: string | null;
  capital: number | null;
  situacao: string | null;
  cidade: string | null;
  cnae: string | null;
  notas: string | null;
  cadastrado: string | null;
}

export interface Ficha {
  sincronizadoEm: string | null;
  cadastro: Cadastro | null;
  projetos: ProjetoFicha[];
  teses: Tese[];
  /** Por status da tese, do maior valor para o menor. */
  tesesPorStatus: { status: string; teses: number; valor: number; tom: TomTese }[];
  /** Teses sem projeto (importadas): a API não soma no valor identificado. */
  valorSemProjeto: number;
  propostas: PropostaFicha[];
  estoques: EstoqueFicha[];
  fups: Fup[];
  historico: Evento[];
  origem: { parceiro: string | null; rotulo: string | null; origem: string | null } | null;
  financeiro: {
    faturas: FaturaFicha[];
    recebimentos: RecebimentoFicha[];
    faturado: number;
    recebido: number;
    aReceber: number;
    emAtraso: number;
  } | null;
  portaFinanceiro: { aberta: boolean; motivo: string | null };
}

const STATUS_PROPOSTA: Record<string, { rotulo: string; tom: TomTese }> = {
  em_negociacao: { rotulo: "Em negociação", tom: "info" },
  aceita: { rotulo: "Aceita", tom: "sucesso" },
  perdida: { rotulo: "Perdida", tom: "perigo" },
};

/** Rótulo de uma fase do histórico: etapa do projeto, sub-status ou status da proposta. */
function fase(v: Json | undefined): string | null {
  const s = txt(v);
  if (!s) return null;
  return ETAPA_PLATAFORMA[s] ?? SUB_STATUS[s] ?? STATUS_PROPOSTA[s]?.rotulo.toLowerCase() ?? s.replace(/_/g, " ");
}

function textoEvento(e: Rec, canais: Map<string, string>, gestores: Map<string, string>): string {
  const tipo = txt(e.evento_tipo);
  const p = (e.payload ?? {}) as Rec;
  const ent = txt(e.entidade_tipo);
  const alvo = ent === "proposta" ? "Proposta" : ent === "retificacao" ? "Retificação" : "Projeto";
  switch (tipo) {
    case "criacao":
      return `${alvo} ${alvo === "Projeto" ? "criado" : "criada"}`;
    case "mudanca_fase":
      return `${alvo}: ${fase(e.fase_origem) ?? "—"} → ${fase(e.fase_destino) ?? "—"}`;
    case "atribuicao_responsavel": {
      const g = gestores.get(String(p.gestor_id ?? "")) ?? "gestor";
      const a = rotulo(AREA, p.area);
      return `Gestor atribuído: ${g}${a ? ` (${a})` : ""}`;
    }
    case "canal_venda_definido":
      return `Canal definido: ${txt(p.canal_nome) ?? canais.get(String(p.canal_id ?? "")) ?? "—"}`;
    case "execucao":
      return txt(p.marco) === "documentos_completos"
        ? "Documentos completos"
        : `Marco: ${String(p.marco ?? "—").replace(/_/g, " ")}`;
    case "baixa":
      return `Projeto baixado${txt(p.motivo) ? `: ${txt(p.motivo)}` : ""}`;
    case "reativacao":
      return "Projeto reativado";
    case "exclusao":
      return `Projeto excluído${txt(p.razao_social) ? ` (${txt(p.razao_social)})` : ""}`;
    default:
      return String(tipo ?? "evento").replace(/_/g, " ");
  }
}

/** O payload do RPC → a ficha. `hoje` (AAAA-MM-DD) decide o que está em atraso. */
export function montarFicha(b: FichaBruta, hoje: string): Ficha {
  const canais = new Map((b.canais ?? []).map((c) => [String(c.id), String(c.nome ?? "")]));
  const parceiros = new Map((b.parceiros ?? []).map((p) => [String(p.id), String(p.apelido ?? "")]));
  const gestores = new Map((b.gestores ?? []).map((g) => [String(g.id), String(g.nome ?? "")]));
  const prazos = new Map((b.prazos ?? []).map((p) => [String(p.projeto_id), p]));
  const nomeProjeto = new Map<string, string>();

  const c = b.clientes?.[0];
  const cadastro: Cadastro | null = c
    ? {
        razao: txt(c.razao_social) ?? "—",
        fantasia: txt(c.nome_fantasia),
        grupo: txt(c.grupo),
        parceiro: txt(c.parceiro),
        regime: txt(c.regime),
        porte: txt(c.porte),
        natureza: txt(c.natureza_juridica),
        capital: num(c.capital_social),
        situacao: txt(c.situacao),
        cidade: [txt(c.municipio), txt(c.estado)].filter(Boolean).join("/") || null,
        cnae: txt(c.cnae_descricao),
        notas: txt(c.notas),
        cadastrado: dia(c.created_at),
      }
    : null;

  const teses: Tese[] = (b.teses ?? []).map((t) => ({
    id: String(t.id),
    tema: txt(t.tema) ?? "Tese sem tema",
    tributos: txt(t.tributos),
    perfil: txt(t.perfil_credito),
    valor: zero(t.oportunidade),
    status: txt(t.convertido_status),
    statusOperacional: txt(t.status_operacional),
    periodo: txt(t.periodo),
    projeto: null,
    projetoId: txt(t.projeto_id),
  }));

  const projetos: ProjetoFicha[] = (b.projetos ?? []).map((p) => {
    const id = String(p.id);
    const nome = txt(p.apelido) ?? txt(p.razao_social) ?? "Projeto";
    const produto = txt(p.produto);
    nomeProjeto.set(id, produto ?? nome);
    const pz = prazos.get(id);
    const gs = (b.gestores_projeto ?? [])
      .filter((g) => String(g.projeto_id) === id)
      .map((g) => {
        const n = gestores.get(String(g.gestor_id));
        const a = rotulo(AREA, g.area);
        return n ? (a ? `${n} (${a})` : n) : null;
      })
      .filter((x): x is string => !!x);
    const proprias = teses.filter((t) => t.projetoId === id);
    return {
      id,
      nome,
      produto,
      departamento: rotulo(DEPARTAMENTO, p.departamento),
      etapa: rotulo(ETAPA_PLATAFORMA, p.etapa_atual),
      subStatus: rotulo(SUB_STATUS, p.sub_status),
      baixado: p.baixado === true,
      motivoBaixa: txt(p.motivo_baixa),
      dataBaixa: dia(p.data_baixa),
      entrada: dia(p.data_entrada),
      entrega: dia(p.data_entrega),
      documentosCompletos: dia(p.data_documentos_completos),
      responsavel: txt(p.responsavel),
      gestores: [...new Set(gs)].sort((x, y) => x.localeCompare(y, "pt-BR")),
      canal: canais.get(String(p.canal_venda_id ?? "")) || null,
      parceiro: parceiros.get(String(p.parceiro_id ?? "")) || txt(p.parceiro),
      prioridade: num(p.prioridade),
      observacoes: txt(p.observacoes),
      prazo: pz
        ? {
            diasNaEtapa: num(pz.dias_na_etapa),
            meta: num(pz.meta_dias),
            unidade: txt(pz.meta_unidade),
            alem: num(pz.dias_alem_da_meta),
            venceEm: dia(pz.vence_em),
          }
        : null,
      teses: proprias,
      valor: proprias.filter((t) => contaNoValor(t.status)).reduce((s, t) => s + t.valor, 0),
      areas: (b.areas ?? [])
        .filter((a) => String(a.projeto_id) === id)
        .map((a) => ({
          area: rotulo(AREA, a.area) ?? "—",
          expectativa: num(a.expectativa_recuperacao),
          notas: txt(a.notas),
          em: dia(a.registrado_em),
        })),
      semCliente: !txt(p.cliente_id),
    };
  });
  // Abertos primeiro, depois a entrada mais recente.
  projetos.sort(
    (x, y) => Number(x.baixado) - Number(y.baixado) || (y.entrada ?? "").localeCompare(x.entrada ?? ""),
  );
  for (const t of teses) t.projeto = t.projetoId ? (nomeProjeto.get(t.projetoId) ?? null) : null;

  const porStatus = new Map<string, { status: string; teses: number; valor: number; tom: TomTese }>();
  for (const t of teses) {
    const s = t.status ?? "Sem status";
    const g = porStatus.get(s) ?? { status: s, teses: 0, valor: 0, tom: tomTese(t.status) };
    g.teses += 1;
    g.valor += t.valor;
    porStatus.set(s, g);
  }

  const propostas: PropostaFicha[] = (b.propostas ?? [])
    .map((p) => {
      const st = txt(p.status);
      const meta = (st && STATUS_PROPOSTA[st]) || { rotulo: st ?? "—", tom: "neutro" as TomTese };
      return {
        id: String(p.id),
        empresa: txt(p.empresa),
        produto: txt(p.produto),
        status: st,
        rotuloStatus: meta.rotulo,
        tom: meta.tom,
        valorTotal: num(p.valor_total),
        valorFixo: num(p.valor_fixo),
        exito: num(p.percentual_exito),
        parcelas: num(p.num_parcelas),
        cobranca: txt(p.tipo_cobranca),
        envio: dia(p.data_envio),
        aceite: dia(p.data_aceite),
        perda: dia(p.data_perda),
        motivoPerda: txt(p.motivo_perda) ?? txt(p.motivo_perda_categoria),
        responsavel: txt(p.responsavel),
        parceiro: txt(p.parceiro),
        ultimoFup: dia(p.data_ultimo_fup),
        proximoFup: dia(p.data_fup_proximo),
        descricao: txt(p.descricao),
      };
    })
    .sort((x, y) => (y.envio ?? "").localeCompare(x.envio ?? ""));

  const estoques: EstoqueFicha[] = (b.estoques ?? []).map((e) => {
    const s = (e.saldo ?? {}) as Rec;
    const id = String(e.id);
    return {
      id,
      tipo: txt(e.tipo_credito),
      status: txt(e.status),
      inicio: dia(e.data_inicio),
      aprovado: zero(e.valor_total_aprovado),
      utilizado: zero(s.total_utilizado),
      saldo: zero(s.saldo_atual),
      exitoPct: num(e.aliquota_exito) === null ? null : zero(e.aliquota_exito) * 100,
      exitoGerado: zero(s.total_exito_gerado),
      gestorConta: txt(e.gestor_conta),
      formaConsumo: txt(e.forma_consumo),
      acessoVia: txt(e.acesso_via),
      parceiro: txt(e.parceiro),
      movimentos: (b.movimentos ?? [])
        .filter((m) => String(m.estoque_id) === id)
        .map((m) => ({
          competencia: txt(m.competencia) ?? "—",
          compensacoes: zero(m.declaracao_compensacoes),
          depositos: zero(m.deposito_contas),
          pedidos: zero(m.pedidos_mes),
          cobranca: zero(m.valor_cobranca),
        }))
        .filter((m) => m.compensacoes || m.depositos || m.pedidos || m.cobranca)
        .sort((x, y) => y.competencia.localeCompare(x.competencia)),
    };
  });
  estoques.sort((x, y) => Number(x.status !== "ativo") - Number(y.status !== "ativo") || y.aprovado - x.aprovado);

  const fups: Fup[] = (b.fups ?? [])
    .map((f) => ({
      data: txt(f.created_at) ?? "",
      autor: txt(f.autor_nome),
      texto: txt(f.texto) ?? "",
      tipo: txt(f.tipo),
      projeto: nomeProjeto.get(String(f.projeto_id)) ?? "Projeto",
    }))
    .filter((f) => f.texto)
    .sort((x, y) => y.data.localeCompare(x.data));

  const historico: Evento[] = (b.historico ?? [])
    .map((e) => ({
      data: txt(e.data_evento) ?? txt(e.registrado_em) ?? "",
      quem: txt(e.ator),
      texto: textoEvento(e, canais, gestores),
    }))
    .sort((x, y) => y.data.localeCompare(x.data));

  const cl = b.classificacao?.[0];
  let financeiro: Ficha["financeiro"] = null;
  if (b.faturas && b.recebimentos) {
    const faturas: FaturaFicha[] = b.faturas
      .filter((f) => txt(f.status_fatura) !== "substituida")
      .map((f) => ({
        data: dia(f.data_faturamento),
        competencia: txt(f.competencia),
        descricao: txt(f.descricao_servico),
        categoria: txt(f.categoria),
        valor: zero(f.valor),
        status: txt(f.status_fatura),
      }))
      .sort((x, y) => (y.data ?? "").localeCompare(x.data ?? ""));
    const recebimentos: RecebimentoFicha[] = b.recebimentos
      .filter((r) => r.cancelado !== true)
      .map((r) => {
        const aReceber = zero(r.valor_a_receber);
        const venc = dia(r.data_vencimento);
        return {
          vencimento: venc,
          credito: dia(r.data_credito),
          documento: txt(r.nota_fiscal) ?? txt(r.documento) ?? txt(r.numero),
          categoria: txt(r.categoria),
          valor: zero(r.valor_conta),
          recebido: zero(r.valor_recebido),
          aReceber,
          status: txt(r.status_pagamento),
          emAtraso: aReceber > 0 && !!venc && venc < hoje,
        };
      })
      .sort((x, y) => (y.vencimento ?? "").localeCompare(x.vencimento ?? ""));
    financeiro = {
      faturas,
      recebimentos,
      faturado: faturas.reduce((s, f) => s + f.valor, 0),
      recebido: recebimentos.reduce((s, r) => s + r.recebido, 0),
      aReceber: recebimentos.reduce((s, r) => s + r.aReceber, 0),
      emAtraso: recebimentos.filter((r) => r.emAtraso).reduce((s, r) => s + r.aReceber, 0),
    };
  }

  return {
    sincronizadoEm: b.sincronizado_em,
    cadastro,
    projetos,
    teses: [...teses].sort((x, y) => y.valor - x.valor),
    tesesPorStatus: [...porStatus.values()].sort((x, y) => y.valor - x.valor),
    valorSemProjeto: teses
      .filter((t) => !t.projetoId && contaNoValor(t.status))
      .reduce((s, t) => s + t.valor, 0),
    propostas,
    estoques,
    fups,
    historico,
    origem: cl
      ? { parceiro: txt(cl.parceiro), rotulo: txt(cl.okr_label), origem: txt(cl.origem) }
      : null,
    financeiro,
    portaFinanceiro: b.porta_financeiro,
  };
}
