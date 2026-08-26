// Tipos da Fila Cella (Funil B, canal dedicado — spec-tela-fila-cella.md v0.3).
//
// Estes tipos vivem à mão, e não em src/integrations/supabase/types.ts, por dois
// motivos que se somam:
//   1. types.ts é gerado do banco. As migrations 20260826090000..94000 foram
//      commitadas e NÃO aplicadas (regra da casa: mergeia primeiro, aplica
//      depois), então não há o que gerar ainda.
//   2. `v_fila_cella` é view; o gerador tipa view como somente-leitura e a spec
//      §7.1 já pedia um tipo próprio para o caminho de escrita.
// Quando as migrations forem aplicadas, regenerar types.ts e trocar `FilaContaRow`
// por `Database["public"]["Views"]["v_fila_cella"]["Row"]` é uma troca mecânica.

export type Curva = "A" | "B" | "C";
export type Forca = "Forte" | "Moderado" | "Fraco";
export type Frente = "Tese" | "Contencioso" | "Transação";
export type Relacionamento = "Não verificado" | "Saudável" | "Alerta aberto";
export type Canal = "WhatsApp" | "Ligação" | "E-mail" | "Reunião";
export type Resultado = "Sem resposta" | "Respondeu" | "Reunião agendada" | "Não explícito";
export type PapelDecisao = "Decide" | "Influencia" | "Encaminha";
export type Procedencia = "growth_deals_won" | "ecd_icp_404";
export type Lista = "fila" | "novos_do_mes";
export type Elegivel = "Sim" | "Não" | "A confirmar";

/** Os cinco estados do §6.7. Nunca há um sexto, e nunca há vazio. */
export type EcdEstado =
  | "ecd_com_sinal"
  | "ecd_sem_sinal"
  | "ecd_sem_nome_de_conta"
  | "sem_ecd"
  | "sem_cnpj";

/** Os 10 valores de build_planilha.py:27-28, copiados do arquivo. */
export const ESTAGIOS = [
  "1 Base elegível",
  "2 Gatilho identificado",
  "3 Abordagem em curso",
  "4 Reunião agendada",
  "5 Reunião realizada",
  "6 Proposta enviada",
  "7 Em negociação",
  "8 Fechado",
  "Perdido",
  "Reciclado",
] as const;
export type Estagio = (typeof ESTAGIOS)[number];

export const CANAIS: readonly Canal[] = ["WhatsApp", "Ligação", "E-mail", "Reunião"];
export const RESULTADOS: readonly Resultado[] = [
  "Sem resposta",
  "Respondeu",
  "Reunião agendada",
  "Não explícito",
];
export const FRENTES: readonly Frente[] = ["Tese", "Contencioso", "Transação"];
export const FORCAS: readonly Forca[] = ["Forte", "Moderado", "Fraco"];
export const RELACIONAMENTOS: readonly Relacionamento[] = [
  "Não verificado",
  "Saudável",
  "Alerta aberto",
];
export const PAPEIS_DECISAO: readonly PapelDecisao[] = ["Decide", "Influencia", "Encaminha"];

/** Espelha coluna a coluna a `v_fila_cella` (migration 20260826094000). */
export interface FilaContaRow {
  id: number;
  pipedrive_deal_id: string | null;
  org_id_pipedrive: string | null;
  procedencia: Procedencia;
  lista: Lista;
  titulo: string;
  razao_social: string | null;
  cnpj_principal: string | null;
  segmento: string | null;
  segmento_prioritario: boolean;
  faixa_declarada: string | null;
  curva_declarada: Curva | null;
  curva_ecd: Curva | null;
  receita_operacional: number | null;
  regime_tributario: string | null;
  opcao_simples_receita: string | null;
  elegivel: Elegivel;
  uf: string | null;
  unidade: string | null;
  dono_conta: string | null;
  mrr: number | null;
  cliente_desde: string | null;
  avisos: string[];
  relacionamento: Relacionamento;
  relacionamento_resposta: string | null;
  relacionamento_em: string | null;
  papel_decisao: PapelDecisao | null;
  urgencia: boolean;
  estagio: Estagio;
  conflito_interno: boolean;
  proximo_passo: string | null;
  proximo_passo_em: string | null;
  motivo_perda: string | null;
  frente: Frente | null;
  forca: Forca | null;
  forca_tem_override: boolean;
  forca_motivo: string | null;
  gatilho_principal: string | null;
  gatilho_principal_nome: string | null;
  gatilho_principal_valor: number | null;
  n_gatilhos: number;
  n_categorias: number;
  cobertura_nomes: string | null;
  ciclo_id: number | null;
  ciclo_num: number | null;
  ciclo_frente: Frente | null;
  toques: number | null;
  ultimo_toque: string | null;
  bloqueado_ate: string | null;
  recusa_explicita: boolean | null;
  ecd_estado: EcdEstado;
  vetado: boolean;
  score: number | null;
  score_comparavel: boolean;
  curva_a_sem_lucro_real: boolean;
  curva_diverge: boolean;
  esfriando: boolean;
  passo_vencido: boolean;
  reentrada_bloqueada: boolean;
}

/** Uma linha de `fila_cella_toques` (migration 20260826092000). Append-only. */
export interface ToqueRow {
  id: number;
  ciclo_id: number;
  toque_num: number;
  frente: Frente;
  data: string;
  canal: Canal;
  gatilho_ref: string;
  literal: string;
  atesto_sem_citar_cliente: boolean;
  resposta: string | null;
  resultado: Resultado;
  proximo_passo: string | null;
  proximo_passo_em: string | null;
  motivo: string | null;
  corrige_toque_id: number | null;
  override_por: string | null;
  override_motivo: string | null;
  created_by: string;
  created_at: string;
}

/** Uma linha de `fila_cella_ciclos`. */
export interface CicloRow {
  id: number;
  conta_id: number;
  numero: number;
  frente: Frente;
  motivo_entrada: string;
  status: "aberto" | "encerrado";
  aberto_em: string;
  encerrado_em: string | null;
  motivo_saida: string | null;
  recusa_explicita: boolean;
  bloqueado_ate: string | null;
  fato_novo: string | null;
  aberto_por: string | null;
}

/** Um gatilho apurado para a conta, linha de `ecd_gatilho_conta`. */
export interface GatilhoContaRow {
  gatilho: string;
  nome_conta: string;
  cod_cta: string | null;
  tipo: "saldo" | "fluxo";
  valor: number;
  ano: number;
}

/** Uma categoria de consumo apurada, linha de `empresa_consumo`. */
export interface ConsumoRow {
  categoria: string;
  metrica: "saldo" | "fluxo";
  valor_total: number;
  qtd_contas: number;
  ano: number;
}

/** Candidato do de-para de CNPJ (`omie_clientes_cadastro`). */
export interface CandidatoCnpj {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  similaridade: number | null;
  dv_valido: boolean;
}

/**
 * Estado da fonte. O caso real da v1 não é "tabela vazia", é "tabela
 * inexistente" — as migrations vão como PR e o banco ainda não as tem. Sem esta
 * distinção a tela abriria num card vermelho e o PR pareceria quebrado.
 */
export type EstadoFonte = "ok" | "nao_migrado" | "nunca_sincronizado";

export interface FilaCellaResult {
  rows: FilaContaRow[];
  estado: EstadoFonte;
  sincronizadoEm: string | null;
  aviso: string | null;
}

export interface KpisDaily {
  estado: EstadoFonte;
  /** KR1 — contas abordadas no mês corrente. `null` quando não apurável. */
  kr1Abordadas: number | null;
  kr1Meta: number;
  /** KR2 — taxa de resposta sobre os toques do mês, e reuniões agendadas. */
  kr2TaxaResposta: number | null;
  kr2Reunioes: number | null;
  /** KR3 — contas em "6 Proposta enviada" ou além. */
  kr3Propostas: number | null;
  kr3Meta: number;
  /** QUALIDADE — % de contas tocadas sem nenhuma pendência de higiene (§5.6). */
  qualidade: number | null;
  higiene: {
    semProximoPasso: number | null;
    parados15d: number | null;
    perdidoSemMotivo: number | null;
    passoVencido: number | null;
  };
}

export interface CoberturaFila {
  total: number;
  semCnpj: number;
  comEcd: number;
  comSinal: number;
  semRegime: number;
  semEcd: number;
  ecdSemSinal: number;
  ecdSemNomeDeConta: number;
}

/**
 * Cobertura (bloco B) derivada das linhas já carregadas. Fica aqui, e não numa
 * server fn própria, porque é aritmética sobre as mesmas 57 linhas — uma segunda
 * ida ao banco só para contar seria um round-trip a mais pelo mesmo dado.
 */
export function calcularCobertura(rows: FilaContaRow[]): CoberturaFila {
  const conta = (p: (r: FilaContaRow) => boolean) => rows.filter(p).length;
  return {
    total: rows.length,
    semCnpj: conta((r) => r.ecd_estado === "sem_cnpj"),
    comEcd: conta((r) => r.ecd_estado !== "sem_cnpj" && r.ecd_estado !== "sem_ecd"),
    comSinal: conta((r) => r.ecd_estado === "ecd_com_sinal"),
    semRegime: conta((r) => !r.regime_tributario || r.regime_tributario === "NAO CONFIRMADO"),
    semEcd: conta((r) => r.ecd_estado === "sem_ecd"),
    ecdSemSinal: conta((r) => r.ecd_estado === "ecd_sem_sinal"),
    ecdSemNomeDeConta: conta((r) => r.ecd_estado === "ecd_sem_nome_de_conta"),
  };
}

/** Rótulo curto de cada estado de ECD (§6.7). Nunca vazio, nunca "R$ 0". */
export const ECD_ESTADO_LABEL: Record<EcdEstado, string> = {
  ecd_com_sinal: "2024 ✓",
  ecd_sem_sinal: "2024 · sem sinal",
  ecd_sem_nome_de_conta: "2024 · sem plano de contas",
  sem_ecd: "sem ECD",
  sem_cnpj: "CNPJ?",
};

export const ECD_ESTADO_EXPLICACAO: Record<EcdEstado, string> = {
  ecd_com_sinal: "Tem escrituração e tem gatilho apurado.",
  ecd_sem_sinal:
    "Tem escrituração, o classificador rodou e não achou nada acima do limiar. Não é o mesmo que não ter fato econômico.",
  ecd_sem_nome_de_conta:
    "A ECD veio sem plano de contas nomeado. Gatilho e classificador são baseados no nome da conta, então o silêncio é da fonte, não da empresa.",
  sem_ecd: "CNPJ conhecido, mas não está na base de escriturações.",
  sem_cnpj: "Não sei — porque não tenho CNPJ reconciliado para esta conta.",
};

/**
 * As sete formulações proibidas do playbook §2.5. Seis são casáveis por texto; a
 * sétima ("citar nome de outro cliente da Planning") é regra semântica e nenhum
 * matcher de string a pega — por isso o modal tem o checkbox de atesto e a tela
 * declara que cobre 6 de 7 em vez de deixar o operador achar que está protegido.
 */
const FORMULACOES_PROIBIDAS: { re: RegExp; rotulo: string; noLugar: string }[] = [
  {
    re: /voc[êe]\s+tem\s+direito\s+a\s+receber/i,
    rotulo: '"você tem direito a receber R$ X"',
    noLugar:
      "Identifiquei um indício que merece análise. O dimensionamento é feito pelo escritório.",
  },
  {
    re: /(é|e)\s+praticamente\s+cert/i,
    rotulo: '"é praticamente certo"',
    noLugar:
      "É uma discussão com histórico relevante. O time vai te apresentar o cenário real, inclusive os riscos.",
  },
  {
    re: /todo\s+mundo\s+d[oe]\s+seu\s+setor/i,
    rotulo: '"todo mundo do seu setor já entrou"',
    noLugar: "É um ponto recorrente em empresas com o perfil de operação de vocês.",
  },
  {
    re: /voc[êe]\s+receb(e|er[áa])\s+em\s+\d/i,
    rotulo: '"você recebe em X meses"',
    noLugar: "O prazo depende do rito e da instância. O escritório explica o cenário na reunião.",
  },
  {
    re: /cust(a|o\s+(é|e))\s*(de\s*)?\d+([.,]\d+)?\s*%/i,
    rotulo: '"custa X%"',
    noLugar: "A proposta é apresentada pelo escritório depois do diagnóstico.",
  },
  {
    re: /n[ãa]o\s+vai\s+dar\s+problema\s+com\s+a\s+receita/i,
    rotulo: '"não vai dar problema com a Receita"',
    noLugar: "Risco é parte da análise. O escritório apresenta isso de forma explícita na reunião.",
  },
];

export interface FormulacaoSinalizada {
  rotulo: string;
  noLugar: string;
}

/** Sinaliza — não bloqueia. §6.5: "sinaliza em vermelho e pede confirmação". */
export function sinalizarFormulacoesProibidas(literal: string): FormulacaoSinalizada[] {
  if (!literal) return [];
  return FORMULACOES_PROIBIDAS.filter((f) => f.re.test(literal)).map(({ rotulo, noLugar }) => ({
    rotulo,
    noLugar,
  }));
}

/**
 * O score do §6.4, transcrito de build_planilha.py:115-120. Canônico: se divergir
 * da v_fila_cella, esta função vence — é onde a D1 vai bater. Pura, testável.
 * Devolve `null` quando a conta é vetada (relacionamento = 'Alerta aberto'), que
 * é a string "FORA" do xlsx: veto absoluto, não nota baixa.
 */
export function calcularScore(
  r: Pick<
    FilaContaRow,
    "relacionamento" | "curva_declarada" | "segmento_prioritario" | "forca" | "urgencia"
  >,
): number | null {
  if (r.relacionamento === "Alerta aberto") return null;
  const curva = (r.curva_declarada ?? "").slice(0, 1).toUpperCase();
  const pCurva = curva === "A" ? 3 : curva === "B" ? 2 : 1;
  const pSegmento = r.segmento_prioritario ? 2 : 0;
  const pForca = r.forca === "Forte" ? 3 : r.forca === "Moderado" ? 2 : r.forca === "Fraco" ? 1 : 0;
  const pUrgencia = r.urgencia ? 3 : 0;
  return pCurva + pSegmento + pForca + pUrgencia;
}

/** Dígito verificador de CNPJ. Usado no diálogo de resolução (§6.7 item 4). */
export function cnpjDvValido(cnpj: string): boolean {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}

/** Formata CNPJ só-dígitos para 00.000.000/0000-00. */
export function formatCnpj(cnpj: string | null): string {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return cnpj ?? "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export const BRL = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const dataBR = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";

/** Dias corridos entre uma data ISO e hoje. Negativo = no futuro. */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`).getTime();
  return Math.floor((Date.now() - d) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Entradas das server fns. Vivem aqui (e não inline em cada `inputValidator`)
// porque os hooks precisam do mesmo tipo, e derivá-lo de `Parameters<typeof fn>`
// amarraria o front à assinatura interna do TanStack Start.
// ---------------------------------------------------------------------------

export interface CampoOperadoInput {
  conta_id: number;
  relacionamento?: Relacionamento;
  relacionamento_resposta?: string | null;
  papel_decisao?: PapelDecisao | null;
  urgencia?: boolean;
  estagio?: Estagio;
  forca_override?: Forca | null;
  forca_motivo?: string | null;
  frente_escolhida?: Frente | null;
  proximo_passo?: string | null;
  proximo_passo_em?: string | null;
  motivo_perda?: string | null;
  conflito_interno?: boolean;
}

export interface ResolverCnpjInput {
  pipedrive_deal_id: string;
  cnpj: string;
  papel?: "principal" | "filial" | "coligada";
  razao_social?: string | null;
  observacao?: string | null;
}

export interface AbrirCicloInput {
  conta_id: number;
  frente: Frente;
  motivo_entrada: string;
  fato_novo?: string;
}

export interface RegistrarToqueInput {
  ciclo_id: number;
  data: string;
  canal: Canal;
  gatilho_ref: string;
  literal: string;
  atesto_sem_citar_cliente: boolean;
  resposta?: string | null;
  resultado: Resultado;
  proximo_passo?: string | null;
  proximo_passo_em?: string | null;
  motivo?: string | null;
  corrige_toque_id?: number | null;
}

export interface EncerrarCicloInput {
  ciclo_id: number;
  motivo_saida: string;
  recusa_explicita: boolean;
}
