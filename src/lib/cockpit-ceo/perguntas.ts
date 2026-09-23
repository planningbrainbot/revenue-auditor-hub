// A matriz pergunta → fonte → responsável → aceite do Cockpit do CEO.
//
// Cobrir uma pergunta na tela não é respondê-la (PRD). Por isso cada pergunta declara sua
// cobertura, e nenhuma passa a "verificada" sem conferência com dado real e aceite do responsável.
// Explicação das escolhas em docs/dev_notes/cockpit-ceo-piloto/inventario.md.
//
// O mapa de investidores fala em "franqueadora" e "franqueados"; a plataforma aboliu esses termos
// em 09/09/2026 (DECISIONS.md). Aqui: matriz, unidades e sócios das unidades.
import type { Frente, IdIndicador } from "./contrato.ts";

export type Cobertura =
  "verificada" | "implementada_nao_homologada" | "depende_dado" | "depende_decisao";

export const COBERTURAS: Record<Cobertura, string> = {
  verificada: "Respondida com dado conferido",
  implementada_nao_homologada: "Calculada, falta homologar com dado real",
  depende_dado: "Depende de dado que ainda não existe ou não está conciliado",
  depende_decisao: "Depende de decisão de negócio",
};

/** As 11 exigências explícitas da p. 25 do mapa de investidores (leitura do roadmap de 18/09). */
export const EXIGENCIAS_INVESTIDOR = [
  { id: 1, titulo: "Receita por produto e cliente" },
  { id: 2, titulo: "Penetração por vertical" },
  { id: 3, titulo: "Economia por produto" },
  { id: 4, titulo: "Retenção por coorte" },
  { id: 5, titulo: "Privacidade da base" },
  { id: 6, titulo: "Performance da matriz com as unidades" },
  { id: 7, titulo: "Documentação da rede e histórico de sócios" },
  { id: 8, titulo: "Economia padronizada da unidade" },
  { id: 9, titulo: "Satisfação dos sócios das unidades" },
  { id: 10, titulo: "Consolidação com números" },
  { id: 11, titulo: "Demonstrações consolidadas reproduzíveis" },
] as const;

export interface PerguntaCatalogo {
  id: string;
  frente: Frente;
  texto: string;
  fonte: string;
  responsavel: string;
  cobertura: Cobertura;
  aceite: string;
  /** O que falta, quando a pergunta ainda não é respondida por código. */
  pendencia: string | null;
  indicadores: IdIndicador[];
  roadmap: string[];
  exigencia?: (typeof EXIGENCIAS_INVESTIDOR)[number]["id"];
}

export const PERGUNTAS: PerguntaCatalogo[] = [
  {
    id: "R1",
    frente: "receita",
    texto: "Qual é nossa trajetória para R$ 1 bi de faturamento anual?",
    fonte:
      "Leituras candidatas: Faturamento do Brain Financeiro (grupo) e apuração de royalties (rede); 12 meses fechados ainda não existem.",
    responsavel: "CEO + CFO",
    cobertura: "depende_decisao",
    aceite:
      "Perímetro, ano-alvo e faturamento atual definidos; ponte de crescimento reconcilia com o Financeiro.",
    pendencia:
      "Escolher o perímetro entre as leituras candidatas (ano-alvo 2030 definido em 22/09); fechar 12 meses de histórico.",
    indicadores: ["meta-bilhao"],
    roadmap: ["F11", "F02"],
  },
  {
    id: "R2",
    frente: "receita",
    texto: "Quanto faturamos e quanto recebemos no período?",
    fonte: "Brain Financeiro e Omie, sem conciliação por perímetro.",
    responsavel: "Controladoria / CFO",
    cobertura: "depende_dado",
    aceite:
      "Faturado e recebido do recorte fecham com a fonte financeira, com transferências internas eliminadas.",
    pendencia: "Conciliar contrato → faturamento → recebimento por entidade (F02).",
    indicadores: [],
    roadmap: ["F02", "F07"],
  },
  {
    id: "R3",
    frente: "receita",
    texto: "Quanto vem de cada produto e de cada cliente?",
    fonte: "Contrato → item de produto → faturamento → recebimento (F02).",
    responsavel: "Financeiro + Departamento de Receitas",
    cobertura: "depende_dado",
    aceite:
      "Receita do recorte piloto classificada por produto e cliente; sem produto fica em 'não classificado'.",
    pendencia: "Vínculo produto ↔ contrato ↔ entidade faturadora.",
    indicadores: [],
    roadmap: ["F02", "F01", "F07"],
    exigencia: 1,
  },
  {
    id: "R4",
    frente: "receita",
    texto: "De onde vem o próximo incremento?",
    fonte: "Receita prevista declarada no CRM em oportunidades validadas abertas (Monetização).",
    responsavel: "Departamento de Receitas",
    cobertura: "implementada_nao_homologada",
    aceite:
      "Soma confere com os negócios do recorte; faltantes e moedas divergentes aparecem à parte.",
    pendencia:
      "Homologar com a carga real; ligar ao faturamento realizado (F02) antes de projetar contribuição à meta.",
    indicadores: ["receita-prevista-aberta"],
    roadmap: ["F11"],
  },
  {
    id: "R5",
    frente: "receita",
    texto: "Qual produto compensa originar e entregar?",
    fonte: "Preço, repasses e custos atribuíveis por produto (ainda inexistente).",
    responsavel: "Produto + Financeiro",
    cobertura: "depende_dado",
    aceite: "Margem com memória de cálculo; sem custo apurado a margem aparece desconhecida.",
    pendencia: "Coletar custos de originação e entrega por produto.",
    indicadores: [],
    roadmap: ["F04", "F12"],
    exigencia: 3,
  },
  {
    id: "C1",
    frente: "clientes",
    texto: "Quantos clientes temos de verdade?",
    fonte:
      "Quatro definições candidatas lado a lado (contrato no Omie, pagou em 90 dias, cadastro, MRR), por CNPJ e com sobreposição; nenhuma escolhida.",
    responsavel: "CEO + Departamento de Receitas",
    cobertura: "depende_decisao",
    aceite:
      "Definição de cliente ativo por contexto aprovada e aplicada com denominador explícito.",
    pendencia:
      "Escolher, por contexto, qual definição candidata vale; completar CNPJ das empresas sem documento no cadastro.",
    indicadores: [],
    roadmap: ["F01"],
  },
  {
    id: "C2",
    frente: "clientes",
    texto: "Onde há oferta disponível para trabalhar agora?",
    fonte: "Base de clientes: regra de elegibilidade de cada produto e disponibilidade no CRM.",
    responsavel: "Departamento de Receitas",
    cobertura: "implementada_nao_homologada",
    aceite:
      "Contas únicas batem com a Base de clientes no mesmo recorte; sobreposição não duplica conta.",
    pendencia: "Homologar com a carga real da Base de clientes.",
    indicadores: ["contas-prontas"],
    roadmap: ["F03"],
  },
  {
    id: "C3",
    frente: "clientes",
    texto: "Quantos clientes ativos consomem cada vertical?",
    fonte: "Matriz cliente × vertical com ativação (ainda inexistente).",
    responsavel: "Donos das verticais + Departamento de Receitas",
    cobertura: "depende_decisao",
    aceite:
      "Dois denominadores explícitos: clientes ativos e elegíveis à vertical; ganho no CRM não conta como consumo.",
    pendencia: "Definição de cliente ativo e sinal de ativação na entrega.",
    indicadores: [],
    roadmap: ["F03"],
    exigencia: 2,
  },
  {
    id: "E1",
    frente: "comercial",
    texto: "Quantos contratos ganhamos no período, e estamos no ritmo da meta?",
    fonte: "Monetização: eventos de ganho no CRM e plano mensal cadastrado.",
    responsavel: "Comercial + Departamento de Receitas",
    cobertura: "implementada_nao_homologada",
    aceite:
      "Contagem igual à da Operação no mesmo período e responsável; ganho no CRM não é recebimento.",
    pendencia: "Homologar com a carga real; a Operação abre com filtro próprio.",
    indicadores: ["contratos-ganhos"],
    roadmap: ["F05", "F11"],
  },
  {
    id: "E2",
    frente: "comercial",
    texto: "A demanda está sendo trabalhada?",
    fonte: "Monetização: leads trabalhados e oportunidades validadas por evento.",
    responsavel: "Comercial",
    cobertura: "implementada_nao_homologada",
    aceite: "Eventos contados pelo ator e pela data do evento, não pelo dono atual.",
    pendencia: "Homologar com a carga real.",
    indicadores: ["leads-trabalhados", "oportunidades-validadas"],
    roadmap: ["F05"],
  },
  {
    id: "E3",
    frente: "comercial",
    texto: "Qual produto e qual unidade convertem?",
    fonte: "Monetização por produto; unidade só via conta vinculada ao negócio.",
    responsavel: "Comercial + Departamento de Receitas",
    cobertura: "implementada_nao_homologada",
    aceite:
      "Composição por produto soma o total; negócio sem conta vinculada aparece à parte no recorte por unidade.",
    pendencia: "Unidade do negócio no CRM ainda não é campo confiável; hoje vem da conta.",
    indicadores: ["oportunidades-validadas", "contratos-ganhos"],
    roadmap: ["F05"],
  },
  {
    id: "E4",
    frente: "comercial",
    texto: "O que a matriz gerou, distribuiu e converteu para cada unidade?",
    fonte: "Trilha lead → roteamento → aceite → contrato por unidade (ainda inexistente).",
    responsavel: "Comercial / Expansão",
    cobertura: "depende_dado",
    aceite:
      "Mudança de dono atual não reescreve o autor do evento; agregado confere com eventos únicos.",
    pendencia: "Registrar roteamento e unidade de destino no evento.",
    indicadores: [],
    roadmap: ["F05"],
    exigencia: 6,
  },
  {
    id: "N1",
    frente: "rede",
    texto: "Quais unidades crescem com margem?",
    fonte: "DRE padronizada por unidade (ainda inexistente).",
    responsavel: "Controladoria",
    cobertura: "depende_dado",
    aceite: "Receita e custo rastreáveis; cobertura das unidades explícita.",
    pendencia: "Plano de contas gerencial comum por unidade (F07).",
    indicadores: [],
    roadmap: ["F07"],
    exigencia: 8,
  },
  {
    id: "N2",
    frente: "rede",
    texto: "O sócio da unidade está satisfeito?",
    fonte:
      "Pesquisa do comitê de sócios existe e recebe respostas pelo formulário público, mas não tem política de leitura: nenhum papel lê pelo app.",
    responsavel: "Relacionamento com unidades",
    cobertura: "depende_decisao",
    aceite: "Público, período, amostra e não respondentes visíveis; cobertura baixa sinalizada.",
    pendencia:
      "Decidir quem lê a pesquisa e criar a política de leitura; definir público e período para medir cobertura.",
    indicadores: [],
    roadmap: ["F08"],
    exigencia: 9,
  },
  {
    id: "N3",
    frente: "rede",
    texto: "Como estão repasses e concentração por unidade?",
    fonte:
      "Apuração de royalties confirmada por unidade (faturamento, royalties + CSC, concentração); recebido por unidade ainda sem régua confiável.",
    responsavel: "Controladoria",
    cobertura: "depende_dado",
    aceite:
      "Repasse por unidade fecha com a apuração confirmada; mês em rascunho não conta como realizado.",
    pendencia: "Definir o perímetro de receita da rede e conciliar com o Financeiro.",
    indicadores: [],
    roadmap: ["F07", "F02"],
  },
  {
    id: "T1",
    frente: "retencao",
    texto: "Quem permanece, expande ou sai, por coorte?",
    fonte:
      "Contratos ganhos no pipeline de vendas × churn datado da Central de Tratativas; o registro de churn com data é recente.",
    responsavel: "CS + Financeiro",
    cobertura: "depende_dado",
    aceite: "Denominador fixo da coorte; buraco no histórico não vira retenção zero.",
    pendencia:
      "Datar todo churn e registrar início/fim por cliente e produto; expansão e contração ainda não têm fonte.",
    indicadores: [],
    roadmap: ["F06"],
    exigencia: 4,
  },
  {
    id: "T2",
    frente: "retencao",
    texto: "A entrega comporta crescer?",
    fonte: "Ativação, prazo, retrabalho e horas por produto (ainda inexistente).",
    responsavel: "Operações",
    cobertura: "depende_dado",
    aceite: "Ganho de capacidade tem baseline, período e guardrail de qualidade.",
    pendencia: "Instrumentar a entrega.",
    indicadores: [],
    roadmap: ["F12"],
  },
  {
    id: "K1",
    frente: "capital",
    texto: "O que podemos consolidar, com qual capital e em que ritmo?",
    fonte: "Cadastro de alvos e cenários, separados do realizado.",
    responsavel: "CEO + CFO",
    cobertura: "depende_decisao",
    aceite:
      "Cenário distingue preço indicativo, negociação e compromisso; sinergia não vira receita realizada.",
    pendencia: "Mandato de aquisição e acesso restrito ao módulo.",
    indicadores: [],
    roadmap: ["F10", "F11"],
    exigencia: 10,
  },
  {
    id: "K2",
    frente: "capital",
    texto: "Conseguimos reproduzir as demonstrações consolidadas?",
    fonte: "Fechamento mensal versionado (ainda inexistente).",
    responsavel: "Controladoria / CFO",
    cobertura: "depende_dado",
    aceite: "Exportar o mesmo recorte fechado reproduz o número; auditável não é auditado.",
    pendencia: "Fluxo pendente → conciliado → revisado → fechado (F07).",
    indicadores: [],
    roadmap: ["F07", "F13"],
    exigencia: 11,
  },
  {
    id: "K3",
    frente: "capital",
    texto: "Podemos demonstrar origem e uso dos dados da base?",
    fonte: "Inventário de tratamento de dados (ainda inexistente).",
    responsavel: "Jurídico / Privacidade",
    cobertura: "depende_dado",
    aceite: "Documento ausente gera pendência, nunca selo automático de conformidade.",
    pendencia: "Inventário de finalidade, base legal e retenção.",
    indicadores: [],
    roadmap: ["F09"],
    exigencia: 5,
  },
  {
    id: "K4",
    frente: "capital",
    texto: "A documentação da rede e o histórico de sócios estão completos?",
    fonte: "COF, contratos e desligados dos últimos 24 meses (fora do Brain hoje).",
    responsavel: "Jurídico + Expansão",
    cobertura: "depende_dado",
    aceite: "Cada unidade com documento, data e responsável; revisão pelo Jurídico.",
    pendencia: "Fila de documentação da rede.",
    indicadores: [],
    roadmap: ["F09"],
    exigencia: 7,
  },
];

export const perguntasDaFrente = (f: Frente) => PERGUNTAS.filter((p) => p.frente === f);
