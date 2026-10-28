// Tipos dos JSONs que as RPCs de tela do Portal de Faturamento devolvem.
//
// Fonte da verdade: `PM Work/execution/portal-faturamento-prd-20261013/e1/API.md` (§0 e §1), o contrato
// entre o banco único, as telas (T4) e os conectores. Quando o API.md não fixa um retorno, o tipo diz isso
// e fica largo de propósito: a tela não inventa campo.
//
// Módulo puro (sem React, sem `@/`): é importado pelos testes `node --test` e pelas server functions.

/** Valor JSON qualquer (payload e resposta guardados pelo conector, diff de evento). */
export type Json = string | number | boolean | null | Json[] | { [chave: string]: Json };

// ------------------------------------------------------------------ situações

/** As 13 situações do pedido (API.md §0.5), na ordem do ciclo de vida. */
export const SITUACOES = [
  "rascunho",
  "aguardando_ok",
  "devolvido",
  "na_fila_omie",
  "simulado",
  "erro_omie",
  "os_criada",
  "em_conferencia",
  "faturado",
  "recebido",
  "em_atraso",
  "cancelamento_pedido",
  "cancelado",
] as const;

export type Situacao = (typeof SITUACOES)[number];

/** `"a_faturar"` vale, no filtro, pelo grupo do card A faturar (sem simulados). API.md §1.3. */
export type SituacaoFiltro = Situacao | "a_faturar";

export function ehSituacao(v: unknown): v is Situacao {
  return typeof v === "string" && (SITUACOES as readonly string[]).includes(v);
}

// ------------------------------------------------------------------ referências curtas (§0.4)

/** Pessoa: nome de `public.profiles`; sem nome, o e-mail. */
export interface Pessoa {
  id: string;
  nome: string;
}

export interface EmissoraRef {
  id: string;
  apelido: string;
}

export type ModoOmie = "simular" | "gravar";

/** Papel de uma pessoa numa empresa que fatura (linha ativa em `receita.fat_donos`). */
export type PapelEmissora = "dono" | "gestor" | "solicitante";

/** Estado do Omie de uma emissora, mantido pelo conector (`integracoes.omie_emissora_estado`). */
export interface EstadoOmie {
  indisponivel: boolean;
  motivo: string | null;
  bloqueada_ate: string | null;
  ultimo_ok_em?: string | null;
  ultima_falha_em?: string | null;
}

// ------------------------------------------------------------------ filtro de fat_pedidos (§1.3)

export type Pendencia = "ok" | "devolvido" | "erro";
export type ReguaMes = "competencia" | "nota" | "pagamento";
/** `atraso` vem sem `mes`: parcela vencida e não paga hoje. */
export type Regua = ReguaMes | "atraso";
export type OrdemPedidos = "atualizado" | "valor" | "vencimento" | "numero";

/**
 * O `p_filtro` de `ops.fat_pedidos`. Chave desconhecida é recusada pelo banco (`22023`), então este tipo é
 * fechado. Os `filtro` que `fat_contexto` e `fat_resumo` devolvem vão inteiros aqui (a soma bate).
 */
export interface FiltroPedidos {
  situacao?: SituacaoFiltro[];
  pendencia?: Pendencia;
  emissoras?: string[];
  dono?: string;
  /** `AAAA-MM`, sempre com `regua` de mês. */
  mes?: string;
  regua?: Regua;
  simulacao?: boolean;
  busca?: string;
  ordem?: OrdemPedidos;
  direcao?: "asc" | "desc";
  pagina?: number;
  /** 1 a 200; padrão 50. */
  por_pagina?: number;
}

// ------------------------------------------------------------------ fat_contexto (§1.1)

export interface EmissoraContexto {
  id: string;
  apelido: string;
  razao_social: string;
  cnpj: string;
  modo_omie: ModoOmie;
  pipefy_sync: boolean;
  meus_papeis: PapelEmissora[];
  tesouraria: boolean;
  controladoria: boolean;
  pode_pedir: boolean;
  /** Só nas emissoras em que eu posso pedir (lista do campo "Dono da receita"). */
  donos?: Pessoa[];
  omie: EstadoOmie;
}

export interface PendenciaContexto {
  quantidade: number;
  filtro: FiltroPedidos;
}

export interface ErroOmieResumo {
  id: string;
  numero: string;
  emissora: EmissoraRef;
  tomador_nome: string | null;
  erro_legivel: string | null;
  desde: string;
}

export interface Contexto {
  usuario: { id: string; nome: string; email: string };
  papeis: { pede: boolean; tesouraria: boolean; controladoria: boolean; admin: boolean };
  emissoras: EmissoraContexto[];
  /** Apelidos das emissoras do meu recorte em simulação. */
  simulacao: string[];
  pendencias: {
    ok_a_dar: PendenciaContexto;
    devolvidos: PendenciaContexto;
    erro_omie: PendenciaContexto;
    /** Só para a tesouraria; `null` para os outros. */
    para_faturar: PendenciaContexto | null;
  };
  /** Até 50, do mais antigo para o mais novo. */
  erros_omie: ErroOmieResumo[];
  lido_em: string;
}

// ------------------------------------------------------------------ fat_resumo (§1.2)

export type TipoRecorte = "tesouraria" | "controladoria" | "gestor" | "pessoal";

/** `nao_apurado`: todas as emissoras do recorte em simulação; `parcial`: só algumas. */
export type EstadoNumero = "ok" | "parcial" | "nao_apurado";

export interface NumeroResumo {
  valor: number;
  quantidade: number;
  unidade: "pedido" | "nota" | "parcela";
  estado: EstadoNumero;
  filtro: FiltroPedidos;
}

export interface EtapaResumo {
  situacao: Situacao;
  quantidade: number;
  filtro: FiltroPedidos;
}

export interface Resumo {
  /** `AAAA-MM-01`. */
  periodo: string;
  recorte: {
    tipo: TipoRecorte;
    emissoras: { id: string; apelido: string; modo_omie: ModoOmie }[];
  };
  simulacao: { todas: boolean; emissoras: string[] };
  numeros: {
    a_faturar: NumeroResumo;
    faturado_no_mes: NumeroResumo;
    recebido_no_mes: NumeroResumo;
    em_atraso: NumeroResumo;
  };
  /** Pedidos em aberto agora, só as situações que têm pedido. */
  por_situacao: EtapaResumo[];
  sem_pedido: boolean;
}

// ------------------------------------------------------------------ fat_pedidos (§1.3)

export type AcaoProximoPasso =
  | "terminar_rascunho"
  | "dar_ok"
  | "corrigir"
  | "aguardar_omie"
  | "reenviar"
  | "conferir"
  | "faturar"
  | "aguardar_pagamento"
  | "confirmar_cancelamento";

export type QuemAge = "pessoa" | "tesouraria" | "omie" | "cliente";

export interface ProximoPasso {
  /** `null` em recebido e cancelado. */
  acao: AcaoProximoPasso | null;
  quem: QuemAge | null;
  pessoa: Pessoa | null;
  /** Sou eu quem age. */
  voce: boolean;
  /** Momento ISO desde quando o passo espera. */
  desde: string | null;
  /** `AAAA-MM-DD`: 1º vencimento (conferir/faturar) ou próximo vencimento (aguardar pagamento). */
  data: string | null;
  /** Momento ISO da próxima tentativa do Omie. */
  tentar_em: string | null;
}

export type TipoTomador = "pj" | "pf";

export interface PedidoLinha {
  id: string;
  numero: string;
  status: Situacao;
  simulacao: boolean;
  emissora: EmissoraRef;
  tomador: { tipo: TipoTomador; documento: string | null; nome: string | null };
  projeto: string | null;
  valor: number | null;
  dono: Pessoa | null;
  solicitante: Pessoa | null;
  primeiro_vencimento: string | null;
  competencia: string | null;
  proximo_passo: ProximoPasso | null;
  atualizado_em: string;
  /** Com `regua: "pagamento"`: soma das parcelas pagas no mês deste pedido. */
  pago_no_mes: number | null;
  /** Com `regua: "atraso"`: soma das parcelas em atraso deste pedido. */
  em_atraso: number | null;
}

export interface ListaPedidos {
  itens: PedidoLinha[];
  /** Com os filtros. */
  total: number;
  /** Tudo o que eu vejo, sem filtro. */
  total_recorte: number;
  /** Valor dos pedidos com os filtros (o recorte inteiro, não a página). */
  soma: number;
  /** Total da coluna "Pago no mês" ou "Em atraso"; `null` sem essas réguas. */
  soma_parcelas: number | null;
  pagina: number;
  por_pagina: number;
}

// ------------------------------------------------------------------ fat_pedido, a ficha (§1.4)

export type DocumentoFiscal = "nf" | "recibo" | "nd";
export type MeioPagamento = "boleto" | "pix";
export type FormaPagamento = "avulso" | "parcelado";
export type SituacaoParcela = "a_vencer" | "pago" | "em_atraso" | "cancelado";

export interface ContratoOutraEmissora {
  emissora: EmissoraRef;
  unidade?: string | null;
  /**
   * O número e o valor do contrato só vêm quando a pessoa tem papel na outra empresa também; sem isso o banco
   * diz só que existe contrato vigente lá (revisão da E1, M5).
   */
  numero?: string | null;
  valor_mensal?: number | null;
  vigencia_inicial?: string | null;
  vigencia_final: string | null;
}

export interface ServicoRef {
  id: string;
  codigo_omie: string | null;
  codigo: string | null;
  descricao: string;
}

export interface Parcela {
  n: number;
  vencimento: string;
  valor: number;
  situacao?: SituacaoParcela;
  pago_em?: string | null;
  omie_titulo_codigo?: number | null;
}

export interface EventoPedido {
  id: number;
  evento: string;
  de: Situacao | null;
  para: Situacao | null;
  /** `{campo: {de, para}}`; no evento `devolvido`, `{motivo}`. */
  diff: { [campo: string]: Json } | null;
  /** `null` = Portal (automático). */
  autor: Pessoa | null;
  em: string;
}

export interface EnvioOmie {
  id: string;
  operacao: string;
  status: string;
  modo: ModoOmie;
  tentativas: number;
  proxima_tentativa_em: string | null;
  erro_legivel: string | null;
  /** `resposta.codigos`; nulo enquanto o conector não respondeu. */
  codigos: { [chave: string]: Json } | null;
  criado_em: string;
  atualizado_em: string;
  /** Só para tesouraria e controladoria ("Detalhes técnicos"). */
  payload?: Json;
  resposta?: Json;
}

export interface EnvioPipefy {
  id: string;
  operacao: string;
  status: string;
  card_id: string | null;
  fase: string | null;
  card_url: string | null;
  erro_legivel: string | null;
  criado_em: string;
  atualizado_em?: string;
  /** Só para tesouraria e controladoria. */
  payload?: Json;
  resposta?: Json;
}

export interface AcaoPermitida {
  pode: boolean;
  /** Frase para o botão desabilitado. */
  motivo: string | null;
  /**
   * "42501" (falta o papel) ou "55000" (a situação não permite); `null` quando pode. O mesmo código que a RPC
   * da ação devolveria (API.md, Mudanças 4).
   */
  codigo?: "42501" | "55000" | null;
}

export type AcaoFicha =
  | "editar"
  | "enviar"
  | "descartar"
  | "aprovar"
  | "devolver"
  | "reenviar"
  | "pedir_cancelamento"
  | "confirmar_cancelamento"
  | "conferir"
  | "faturar"
  | "atualizar_status"
  /** Tesouraria: o envio do card ao Pipefy deu erro e volta para a fila (`fat_tesouraria_acao`). */
  | "reenviar_pipefy";

export interface FichaPedido {
  pedido: {
    id: string;
    numero: string;
    status: Situacao;
    simulacao: boolean;
    motivo_status: string | null;
    status_em: string | null;
    emissora: EmissoraRef & { razao_social: string; modo_omie: ModoOmie; pipefy_sync: boolean };
    dono: Pessoa | null;
    solicitante: Pessoa | null;
    enviado_por: Pessoa | null;
    /** Quem marcou Em conferência (API.md, Mudanças 5). */
    conferido_por?: Pessoa | null;
    tomador: {
      tipo: TipoTomador;
      documento: string | null;
      nome: string | null;
      municipio: string | null;
      uf: string | null;
      situacao: string | null;
      situacao_conferida: boolean;
    };
    emails_envio: string[];
    projeto: string | null;
    servico: ServicoRef | null;
    descricao_nf: string | null;
    valor: number | null;
    forma: FormaPagamento | null;
    parcelas: number | null;
    primeiro_vencimento: string | null;
    competencia: string | null;
    documento: DocumentoFiscal | null;
    meio: MeioPagamento | null;
    departamento: string | null;
    observacoes: string | null;
    confirmou_emissora: boolean;
    contratos_outra_emissora: ContratoOutraEmissora[];
    omie: {
      os_codigo: number | null;
      os_etapa: string | null;
      nf_numero: string | null;
      nf_link: string | null;
      nf_emitida_em: string | null;
      lido_em: string | null;
    };
    criado_em: string;
    enviado_em: string | null;
    na_fila_em: string | null;
    faturado_em: string | null;
    atualizado_em: string;
  };
  resumo: {
    valor: number | null;
    recebido: number | null;
    em_atraso: number | null;
    parcelas_pagas: number;
    parcelas_total: number;
    /** Antes do envio, o 1º vencimento pedido (`previsto`, sem valor). */
    proximo_vencimento: { data: string; valor: number | null; previsto: boolean } | null;
  };
  parcelas: Parcela[];
  /** Do mais novo para o mais velho. */
  eventos: EventoPedido[];
  omie: { envios: EnvioOmie[]; leitura_pendente: { tentar_em: string } | null };
  pipefy: { envios: EnvioPipefy[] };
  papel: {
    autor: boolean;
    enviou: boolean;
    dono: boolean;
    substituto: boolean;
    gestor: boolean;
    tesouraria: boolean;
    controladoria: boolean;
  };
  acoes: Record<AcaoFicha, AcaoPermitida>;
}

// ------------------------------------------------------------------ fat_fila_tesouraria (§1.5)

export type SituacaoFila =
  | "para_faturar"
  | "em_conferencia"
  | "erro_omie"
  | "na_fila_omie"
  | "faturado"
  | "cancelamento_pedido";
export type HigieneFila = "erro" | "vence_2d" | "parado_1du";

export interface FiltroFila {
  situacao?: SituacaoFila;
  higiene?: HigieneFila;
  /** `AAAA-MM-DD` ou `"hoje"`. */
  dia?: string;
  busca?: string;
  /** Padrão 300, máximo 1000. */
  limite?: number;
}

export interface ContagemFila {
  quantidade: number;
  valor: number;
  filtro: FiltroFila;
}

export interface ItemFila {
  id: string;
  numero: string;
  chegou_em: string;
  dia: string;
  emissora: EmissoraRef;
  tomador: { nome: string | null; documento: string | null; situacao_conferida: boolean };
  servico: { descricao: string; codigo: string | null } | null;
  projeto: string | null;
  documento: DocumentoFiscal | null;
  forma: FormaPagamento | null;
  parcelas: number | null;
  valor: number | null;
  primeiro_vencimento: string | null;
  status: Situacao;
  simulacao: boolean;
  faturando: boolean;
  conferido_por: Pessoa | null;
  erro_legivel: string | null;
  /** O erro legível do último envio do Pipefy em erro; `null` sem erro (revisão de 20/10/2026). */
  pipefy_erro?: string | null;
  onde_parou: { evento: string; em: string; autor: Pessoa | null; motivo: string | null } | null;
  proxima_acao: {
    acao: AcaoProximoPasso | null;
    data: string | null;
    desde: string | null;
    tentar_em: string | null;
  } | null;
  higiene: { erro: boolean; vence_2d: boolean; parado_1du: boolean };
}

export interface FilaTesouraria {
  emissoras: (EmissoraRef & {
    trabalho: number;
    modo_omie: ModoOmie;
    omie: Pick<EstadoOmie, "indisponivel" | "motivo" | "bloqueada_ate">;
  })[];
  ritmo: {
    para_faturar: ContagemFila;
    em_conferencia: ContagemFila;
    faturados_hoje: ContagemFila;
  };
  higiene: { erro: number; vence_2d: number; parado_1du: number };
  itens: ItemFila[];
  total: number;
  total_fila: number;
  lido_em: string;
}

// ------------------------------------------------------------------ catálogo (§1.6)

export interface ServicoCatalogo extends ServicoRef {
  codigo_lc116: string | null;
  codigo_municipal: string | null;
  categoria: string | null;
}

export interface CatalogoServicos {
  emissora: EmissoraRef;
  servicos: ServicoCatalogo[];
  /** Liberados sem tributação: "n serviços não aparecem". */
  sem_tributacao: number;
  sincronizado_em: string | null;
}

// ------------------------------------------------------------------ cliente e projeto por lista (call de 27/10/2026)

/** Um cliente da empresa na lista do campo Cliente (`ops.fat_clientes_busca`). */
export interface ClienteDaBusca {
  /** Sem máscara: 11 (CPF) ou 14 (CNPJ) caracteres. */
  documento: string;
  tipo: TipoTomador;
  nome: string;
  /** O nome fantasia, quando é diferente da razão social. */
  fantasia: string | null;
  /** De onde veio: o cadastro do Omie da empresa, um pedido anterior do portal ou a base de clientes. */
  fonte: "omie" | "portal" | "base";
}

export interface BuscaClientes {
  itens: ClienteDaBusca[];
  /** Menos de 3 caracteres: a busca não roda. */
  curto: boolean;
  /** Há mais que o `limite`: a pessoa refina o texto. */
  mais: boolean;
  limite: number;
  /** `omie`: a empresa tem o cadastro do Omie no banco (cinco empresas novas ainda não têm). */
  fontes: { omie: boolean; omie_lido_em: string | null } | null;
}

/** Um projeto já usado pela empresa (`ops.fat_projetos`): lançamentos do Omie e pedidos do portal. */
export interface ProjetoDaEmpresa {
  projeto: string;
  usos: number;
  ultimo: string | null;
}

export interface ProjetosEmpresa {
  itens: ProjetoDaEmpresa[];
  fontes: { omie: boolean };
}

// ------------------------------------------------------------------ fat_tomador (§1.8)

export interface Tomador {
  documento: string;
  tipo: TipoTomador;
  valido: boolean;
  /** Com `valido = false`, o porquê; o resto vem nulo. */
  erro: string | null;
  nome: string | null;
  nome_fonte: string | null;
  municipio: string | null;
  uf: string | null;
  situacao: string | null;
  situacao_desde: string | null;
  situacao_fonte: string | null;
  situacao_consultada_em: string | null;
  /**
   * A consulta da Receita achou o CNPJ? `false` = consultou e a Receita não tem (o envio fica bloqueado, Ana
   * 21/10/2026); `null` = sem consulta (CNPJá fora do ar, limite) ou CPF: "situação não conferida".
   */
  receita_encontrado: boolean | null;
  /**
   * Sem a consulta da Receita no banco (ou com mais de 30 dias; o não encontrado, com mais de 1 dia): quem
   * consulta e grava é o servidor.
   */
  consultar_receita: boolean;
  emails: string[];
  bloqueio: { motivo: string } | null;
  contratos_outra_emissora: ContratoOutraEmissora[];
  contratos_lidos_em: string | null;
  /** Desde a revisão de 20/10/2026 vem sempre `null` (o cadastro da base não sai do banco por aqui). */
  base: { empresa_id: number; razao_social: string | null; uf: string | null } | null;
}

/**
 * O que a tela recebe do servidor: o `fat_tomador` e o que aconteceu com a consulta da Receita que ele pediu
 * (`feita` e gravada, `adiada` pelo limite de chamadas, `falhou`, ou `nao_precisou`).
 */
export type TomadorConferido = Tomador & {
  consulta_receita: "feita" | "adiada" | "falhou" | "nao_precisou";
};

// ------------------------------------------------------------------ parcelas e pedido (§1.9 a §1.18)

export interface PreviaParcelas {
  parcelas: Parcela[];
  total: number;
}

/** As chaves de `p_dados` de `fat_pedido_salvar`. Ausente = não muda; `null` = limpa. */
export interface DadosPedido {
  emissora_id?: string | null;
  dono_id?: string | null;
  tomador_tipo?: TipoTomador | null;
  tomador_documento?: string | null;
  tomador_nome?: string | null;
  emails_envio?: string[] | null;
  projeto?: string | null;
  servico_id?: string | null;
  descricao_nf?: string | null;
  valor?: number | null;
  forma?: FormaPagamento | null;
  parcelas?: number | null;
  primeiro_vencimento?: string | null;
  competencia?: string | null;
  documento?: DocumentoFiscal | null;
  meio?: MeioPagamento | null;
  departamento?: string | null;
  observacoes?: string | null;
  confirmou_emissora?: boolean | null;
}

export interface ErroCampo {
  /** `null` = erro geral. */
  campo: string | null;
  mensagem: string;
}

export interface PedidoSalvo {
  id: string;
  numero: string;
  status: Situacao;
  pendencias: ErroCampo[];
  /** Prévia; vazia sem valor ou vencimento. */
  parcelas: Parcela[];
  contratos_outra_emissora: ContratoOutraEmissora[];
  bloqueio: { motivo: string } | null;
}

export interface PedidoEnviado {
  id: string;
  numero: string;
  status: Situacao;
  simulacao_emissora: boolean;
  /** Só quando o pedido vai para o OK. */
  aguardando?: Pessoa | null;
}

export interface PedidoMudou {
  id: string;
  numero: string;
  status: Situacao;
  simulacao_emissora?: boolean;
  /** `fat_pedido_devolver`. */
  devolvido_a?: Pessoa | null;
  /** `fat_pedido_reenviar` e `fat_tesouraria_acao('reenviar_pipefy')`. */
  reenfileirados?: number;
  /** `fat_tesouraria_acao`. */
  faturando?: boolean;
}

export type AcaoTesouraria = "em_conferencia" | "faturar" | "devolver";

export interface StatusEnfileirado {
  enfileirado: boolean;
  tentar_em: string | null;
}

// ------------------------------------------------------------------ configuração (§1.19 a §1.25)

export type FaturaPor = "os" | "contrato" | "ambos";

export interface PessoaConfig {
  /** `fat_donos.id`. */
  id: string;
  pessoa: Pessoa;
  email: string | null;
  papel: PapelEmissora;
  substituto: Pessoa | null;
  ativo: boolean;
  desde: string | null;
  abre_faturamento: boolean;
  /** Só em dono. */
  aguardando_ok?: number;
}

export interface ServicoConfig extends ServicoRef {
  codigo_lc116: string | null;
  codigo_municipal: string | null;
  tem_tributacao: boolean;
  ativo: boolean;
  no_omie: boolean;
  categoria_padrao: string | null;
  conta_corrente_padrao: number | null;
  sincronizado_em: string | null;
}

export interface EmissoraConfig {
  id: string;
  apelido: string;
  razao_social: string;
  cnpj: string;
  ativa: boolean;
  fatura_por: FaturaPor | null;
  modo_omie: ModoOmie;
  pipefy_sync: boolean;
  conta_corrente_padrao: number | null;
  tem_chave: boolean;
  tem_pedido: boolean;
  omie: EstadoOmie;
  pessoas: PessoaConfig[];
  contagem: { donos: number; gestores: number; solicitantes: number };
  servicos: ServicoConfig[];
  servicos_liberados: number;
  servicos_total: number;
  sincronizacao: { status: string; erro_legivel: string | null; em: string | null } | null;
}

export interface ConfigFaturamento {
  /**
   * Ligar "Gravar no Omie" e ligar o Pipefy: só quem está em `receita.fat_ativadores` (hoje, o Pedro), nem outro
   * admin do Brain. Desligar continua com a controladoria (revisão de 20/10/2026).
   */
  pode_gravar_omie: boolean;
  /** Sem o campo (banco anterior à revisão), a tela deixa ligar e mostra o erro do banco. */
  pode_ligar_pipefy?: boolean;
  emissoras: EmissoraConfig[];
  pessoas_ativas: (Pessoa & { email: string | null; abre_faturamento: boolean })[];
}

/** `fat_dono_salvar`: criar (sem `id`) ou alterar (com `id`, só substituto e ativo). */
export interface DadosDono {
  id?: string;
  emissora_id?: string;
  user_id?: string;
  papel?: PapelEmissora;
  substituto_id?: string | null;
  ativo?: boolean;
}

export interface DonoSalvo {
  id: string;
  emissora_id: string;
  pessoa: Pessoa;
  papel: PapelEmissora;
  substituto: Pessoa | null;
  ativo: boolean;
  abre_faturamento: boolean;
}

export interface DonoRemovido {
  id: string;
  ativo: false;
  aguardando_ok: number;
}

export interface ServicoAtivado {
  id: string;
  ativo: boolean;
  rascunhos_usando: number;
}

/** O API.md não fixa o retorno de `fat_servico_padroes`; a tela relê `fat_config` depois. */
export type ServicoPadroesSalvo = { [chave: string]: Json };

export interface SincronizacaoPedida {
  envio_id: string;
  status: string;
}

export interface EmissoraConfigurada {
  id: string;
  apelido: string;
  modo_omie: ModoOmie;
  pipefy_sync: boolean;
  fatura_por: FaturaPor | null;
}
