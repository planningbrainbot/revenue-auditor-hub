// Registro único do Cockpit do CEO: pergunta executiva → exigência do mapa de investidores →
// pilar (principal e apoios) → feature do roadmap → indicador ou painel → fonte → responsável →
// estado (dado, implementação, homologação, adoção, decisão) → aceite.
//
// Um catálogo de perguntas não é uma coleção de respostas: cada pergunta declara o que o cockpit
// responde HOJE, com qual fonte e com qual limitação. A tela, o CSV de evidências
// (evidencias.ts) e a atualização do artifact (scripts/cockpit-ceo/exportar-artifact.ts) leem
// daqui — não existe segunda lista.
//
// Ids estáveis: os da primeira fatia (R1–R5, C1–C3, E1–E4, N1–N3, T1–T2, K1–K4) foram preservados
// em 23/09; os novos seguem a mesma convenção. A frente de algumas perguntas mudou quando o escopo
// passou da Monetização para a empresa inteira (ver DECISIONS.md, 23/09).
//
// O mapa de investidores fala em "franqueadora" e "franqueados"; a plataforma aboliu esses termos
// em 09/09/2026 (DECISIONS.md). Aqui: matriz, unidades e sócios das unidades.
import type { Frente, IdIndicador } from "./contrato.ts";

export type Cobertura =
  "verificada" | "implementada_nao_homologada" | "depende_dado" | "depende_decisao";

export const COBERTURAS: Record<Cobertura, string> = {
  verificada: "Respondida com dado conferido e aceite do responsável",
  implementada_nao_homologada: "Calculada e conferida com SQL; falta aceite do responsável",
  depende_dado: "Depende de dado que ainda não existe, não é lido ou não está conciliado",
  depende_decisao: "Depende de decisão de negócio",
};

/** Os oito pilares do artifact "Receitas rumo ao bilhão" (22/09). Não são as abas da tela. */
export type Pilar =
  | "base"
  | "portfolio"
  | "distribuicao"
  | "retencao"
  | "economia_rede"
  | "entrega"
  | "consolidacao"
  | "governanca";

export const PILARES: Record<Pilar, { n: number; titulo: string; dono: string }> = {
  base: { n: 1, titulo: "Base e inteligência de clientes", dono: "Dados e RevOps" },
  portfolio: { n: 2, titulo: "Portfólio e monetização", dono: "RevOps e donos de produto" },
  distribuicao: {
    n: 3,
    titulo: "Distribuição e execução comercial",
    dono: "Comercial executa; RevOps desenha e mede",
  },
  retencao: { n: 4, titulo: "Retenção e expansão", dono: "CS e Operações" },
  economia_rede: { n: 5, titulo: "Economia e saúde da rede", dono: "Expansão e Controladoria" },
  entrega: { n: 6, titulo: "Entrega e produtividade", dono: "Operações e donos de produto" },
  consolidacao: { n: 7, titulo: "Consolidação e capital", dono: "CEO, M&A e CFO" },
  governanca: { n: 8, titulo: "Governança e evidência", dono: "CFO, Jurídico e CEO" },
};
export const ORDEM_PILARES = Object.keys(PILARES) as Pilar[];

/** As 11 exigências explícitas da p. 25 do mapa de investidores (Ciclo 1, set/2026). */
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

/** Onde a pergunta nasceu: mapa de investidores (p. 25), PRD de 22/09 ou desdobramento de 23/09. */
export type Origem = "mapa" | "prd" | "desdobramento";

/**
 * Estados separados, porque são problemas diferentes (pedido de 23/09):
 * - dado: integrado (lido e conciliado) · parcial · sem_acesso (existe, ninguém lê) ·
 *   falha_sync (existe, parou) · sem_campo (existe a tabela, falta o campo/vínculo) · ausente;
 * - implementacao: no_ar (publicado) · nesta_versao (branch, não publicado) · nao_iniciada;
 * - homologacao: conferida (SQL independente) · pendente · nao_se_aplica;
 * - adocao: nao_medida — ninguém mede uso da tela ainda;
 * - decisao: o que falta decidir, ou null.
 */
export interface EstadosPergunta {
  dado: "integrado" | "parcial" | "sem_acesso" | "falha_sync" | "sem_campo" | "ausente";
  implementacao: "no_ar" | "nesta_versao" | "nao_iniciada";
  homologacao: "conferida" | "pendente" | "nao_se_aplica";
  adocao: "nao_medida";
  decisao: string | null;
}

/** Painéis de frente que respondem perguntas (além dos indicadores). */
export type IdPainel =
  | "trajetoria"
  | "ponte"
  | "caixa"
  | "margem"
  | "aquisicao"
  | "pipeline"
  | "onboarding"
  | "cadeia"
  | "clientes-ativos"
  | "coortes"
  | "rede-unidades"
  | "metas-unidade"
  | "frescor";

export interface PerguntaCatalogo {
  id: string;
  frente: Frente;
  texto: string;
  origem: Origem;
  exigencia?: (typeof EXIGENCIAS_INVESTIDOR)[number]["id"];
  pilar: Pilar;
  apoios: Pilar[];
  /** Features do roadmap de 18/09 (F01–F13) que a sustentam. */
  roadmap: string[];
  fonte: string;
  responsavel: string;
  /** O papel de Growth e de Ops nesta resposta. */
  growth: string;
  ops: string;
  cobertura: Cobertura;
  estados: EstadosPergunta;
  /** O que o cockpit responde hoje, com a limitação. */
  resposta: string;
  aceite: string;
  /** O que falta, quando a pergunta não é respondida por inteiro. */
  pendencia: string | null;
  indicadores: IdIndicador[];
  paineis: IdPainel[];
}

const NA = "Sem papel direto nesta resposta.";
const nesta = (
  dado: EstadosPergunta["dado"],
  decisao: string | null = null,
  homologacao: EstadosPergunta["homologacao"] = "conferida",
): EstadosPergunta => ({
  dado,
  implementacao: "nesta_versao",
  homologacao,
  adocao: "nao_medida",
  decisao,
});
const naoIniciada = (
  dado: EstadosPergunta["dado"],
  decisao: string | null = null,
): EstadosPergunta => ({
  dado,
  implementacao: "nao_iniciada",
  homologacao: "nao_se_aplica",
  adocao: "nao_medida",
  decisao,
});
const noAr = (dado: EstadosPergunta["dado"], decisao: string | null = null): EstadosPergunta => ({
  dado,
  implementacao: "no_ar",
  homologacao: "conferida",
  adocao: "nao_medida",
  decisao,
});

export const PERGUNTAS: PerguntaCatalogo[] = [
  // ── Receita e trajetória ─────────────────────────────────────────────────
  {
    id: "R1",
    frente: "receita",
    texto: "Qual é nossa trajetória para R$ 1 bi de faturamento anual?",
    origem: "prd",
    pilar: "governanca",
    apoios: ["distribuicao", "retencao", "economia_rede", "consolidacao"],
    roadmap: ["F11", "F02"],
    fonte:
      "Leituras candidatas: Faturamento do Financial Brain (grupo) e apuração de royalties confirmada (rede), lado a lado, nunca somadas.",
    responsavel: "CEO + CFO",
    growth: "Aquisição é um dos motores da ponte; não entra na conta do faturamento.",
    ops: "Ativação limita quando a venda vira faturamento.",
    cobertura: "depende_decisao",
    estados: nesta("integrado", "Perímetro da meta (grupo, rede ou outro)"),
    resposta:
      "Média dos meses fechados, ritmo anualizado e múltiplo necessário para R$ 83,3 mi/mês em 2030, por leitura candidata. Sem 12 meses fechados não há crescimento anual necessário.",
    aceite:
      "Perímetro e ano-alvo definidos; ponte de crescimento reconcilia com o Financeiro; 12 meses fechados.",
    pendencia:
      "Escolher o perímetro (ano-alvo 2030 definido em 22/09); fechar 12 meses de histórico.",
    indicadores: ["meta-bilhao", "faturamento-mes"],
    paineis: ["trajetoria"],
  },
  {
    id: "R6",
    frente: "receita",
    texto: "De onde veio a variação do faturamento no último mês fechado?",
    origem: "desdobramento",
    pilar: "retencao",
    apoios: ["distribuicao", "governanca"],
    roadmap: ["F11", "F02", "F06"],
    fonte:
      "Faturamento por cliente e mês do Financial Brain (fn_faturamento_mensal, DRE 1.1 por emissão).",
    responsavel: "CFO + RevOps",
    growth: "Clientes novos na ponte são o resultado faturado da aquisição.",
    ops: "Saída e contração na ponte são o sinal de retenção que CS e Operações precisam explicar.",
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta:
      "Ponte por cliente: novos, retornos, expansão, contração e sem faturamento no mês, fechando em centavos com o total. Unidade nova, monetização e aquisições ainda não têm vínculo de receita e aparecem como não modelados.",
    aceite:
      "Ponte fecha com o total da fonte; parcelas batem com recontagem SQL independente; linhas não modeladas visíveis.",
    pendencia:
      "Vínculo receita → unidade, produto e vertical para abrir as linhas de unidade nova e monetização.",
    indicadores: ["faturamento-mes", "faturamento-saiu"],
    paineis: ["ponte"],
  },
  {
    id: "R2",
    frente: "caixa",
    texto: "Quanto faturamos e quanto recebemos no período?",
    origem: "prd",
    pilar: "governanca",
    apoios: ["economia_rede"],
    roadmap: ["F02", "F07"],
    fonte:
      "Financial Brain: faturamento (fn_faturamento_mensal), emitido × recebido (fn_receita_emitido_recebido) e inadimplência ao vivo (fn_inadimplencia_live).",
    responsavel: "Controladoria / CFO",
    growth: NA,
    ops: "Cobrança e onboarding afetam o prazo entre emissão e recebimento.",
    cobertura: "implementada_nao_homologada",
    estados: nesta("parcial", null, "conferida"),
    resposta:
      "Faturado por mês, recebido do emitido nos meses que a foto de títulos alcança e vencido em aberto ao vivo. Meses depois da foto (jul/26 em diante) não têm recebido medido.",
    aceite:
      "Faturado e recebido fecham com a fonte financeira; meses sem foto aparecem sem número, nunca 100%.",
    pendencia:
      "Nova foto de títulos em aberto (a vigente é de 01/06) e retomada da carga diária do Financeiro, parada desde 20/09.",
    indicadores: ["faturamento-mes", "vencido-em-aberto"],
    paineis: ["caixa"],
  },
  {
    id: "R3",
    frente: "portfolio",
    texto: "Quanto vem de cada produto e de cada cliente?",
    origem: "mapa",
    exigencia: 1,
    pilar: "portfolio",
    apoios: ["base", "governanca"],
    roadmap: ["F02", "F01", "F07"],
    fonte:
      "Receita por cliente existe no Financial Brain; receita por produto e vertical não é classificada na fonte.",
    responsavel: "Financeiro + Departamento de Receitas",
    growth: NA,
    ops: NA,
    cobertura: "depende_dado",
    estados: nesta("sem_campo", null, "pendente"),
    resposta:
      "Por cliente: sim, dentro do Financeiro (a ponte usa). Por produto e vertical: não, a receita não tem produto; o cockpit mostra a receita por grupo de apuração (entidade) em Caixa e margem.",
    aceite:
      "Receita classificada por produto e cliente; sem produto fica em 'não classificado', visível.",
    pendencia: "De-para auditável produto comercial ↔ serviço ↔ entidade faturadora (F02).",
    indicadores: [],
    paineis: ["margem"],
  },
  {
    id: "R7",
    frente: "receita",
    texto: "Qual previsão sustenta os próximos meses, e com que premissas?",
    origem: "desdobramento",
    pilar: "distribuicao",
    apoios: ["governanca", "portfolio"],
    roadmap: ["F11"],
    fonte:
      "Forecast do mês do Inside Sales (growth.mes_corrente), pipeline aberto sem ponderação, forecast v10 da Monetização (recorte, valor assinado).",
    responsavel: "CFO + RevOps",
    growth: "Dono do forecast do mês do Inside Sales (ritmo e pipeline).",
    ops: NA,
    cobertura: "depende_dado",
    estados: nesta(
      "parcial",
      "Escolha entre forecast v10 e v11 da Monetização; previsão empresarial de receita",
    ),
    resposta:
      "Camadas separadas e rotuladas: forecast do mês do Growth, pipeline aberto não ponderado por mês de fechamento esperado e forecast v10 da Monetização. Não existe previsão empresarial de faturamento.",
    aceite:
      "Projetado × realizado por mês, motor e produto; orçamento, previsão por pipeline e cenário de gestão separados.",
    pendencia:
      "Plano de receita por mês e motor (orçamento), probabilidades por etapa e cenário de gestão registrados.",
    indicadores: ["mrr-vendido"],
    paineis: ["pipeline", "aquisicao"],
  },
  // ── Aquisição e conversão ────────────────────────────────────────────────
  {
    id: "A1",
    frente: "comercial",
    texto: "Quanto investimos em aquisição e quanto isso vira venda?",
    origem: "desdobramento",
    pilar: "distribuicao",
    apoios: ["base"],
    roadmap: ["F05"],
    fonte:
      "Growth: growth.serie_mensal (investimento, leads, MQL, vendas, MRR novo) sobre mídia paga e negócios do Inside Sales.",
    responsavel: "Diretoria de Growth",
    growth: "Dono do dado e do resultado: investe, gera e qualifica a demanda.",
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta:
      "Funil mensal de investimento → leads → MQL → vendas → MRR novo e custo de mídia por venda. O custo é só mídia (não é o CAC completo), e 86% dos negócios de 2026 não têm canal.",
    aceite: "Série igual à do Growth por mês; custo de mídia rotulado como tal.",
    pendencia: "Canal preenchido no negócio para atribuição; custo completo de aquisição.",
    indicadores: ["mrr-vendido"],
    paineis: ["aquisicao"],
  },
  {
    id: "A2",
    frente: "comercial",
    texto: "A aquisição cumpre o plano do mês?",
    origem: "desdobramento",
    pilar: "distribuicao",
    apoios: ["governanca"],
    roadmap: ["F05", "F11"],
    fonte: "Plano do Growth (growth.metas, papel funil) × realizado (growth.serie_mensal).",
    responsavel: "Diretoria de Growth",
    growth: "Define o plano e responde pelo desvio.",
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta:
      "Plano × realizado de investimento, MQL, vendas e MRR novo por mês (plano desde jun/2026). Mês sem plano aparece sem plano, não com 0%.",
    aceite: "Plano e realizado conferidos com as tabelas do Growth.",
    pendencia: null,
    indicadores: ["mrr-vendido"],
    paineis: ["aquisicao"],
  },
  {
    id: "E1",
    frente: "portfolio",
    texto: "Quantos contratos de monetização ganhamos no período, e estamos no ritmo do plano?",
    origem: "prd",
    pilar: "distribuicao",
    apoios: ["portfolio"],
    roadmap: ["F05", "F11"],
    fonte: "Monetização: eventos de ganho no CRM (pipe 39) e plano mensal cadastrado.",
    responsavel: "Comercial + Departamento de Receitas",
    growth: NA,
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: noAr("integrado"),
    resposta: "Contratos ganhos no pipe de Monetização contra o ritmo do plano do mês.",
    aceite:
      "Contagem igual à da Operação no mesmo período e responsável; ganho no CRM não é recebimento.",
    pendencia: "A Operação abre com filtro próprio de responsável.",
    indicadores: ["contratos-ganhos"],
    paineis: [],
  },
  {
    id: "E2",
    frente: "portfolio",
    texto: "A demanda de monetização está sendo trabalhada?",
    origem: "prd",
    pilar: "distribuicao",
    apoios: ["portfolio"],
    roadmap: ["F05"],
    fonte: "Monetização: leads trabalhados e oportunidades validadas por evento.",
    responsavel: "Comercial",
    growth: NA,
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: noAr("integrado"),
    resposta: "Leads trabalhados e oportunidades validadas pela data do evento.",
    aceite: "Eventos contados pelo ator e pela data do evento, não pelo dono atual.",
    pendencia: null,
    indicadores: ["leads-trabalhados", "oportunidades-validadas"],
    paineis: [],
  },
  {
    id: "E3",
    frente: "comercial",
    texto: "Qual produto e qual unidade convertem?",
    origem: "prd",
    pilar: "distribuicao",
    apoios: ["economia_rede"],
    roadmap: ["F05"],
    fonte:
      "Monetização por produto; Inside Sales por unidade de negócio no CRM (growth.deals.unidade_negocio).",
    responsavel: "Comercial + Departamento de Receitas",
    growth: "O Inside Sales registra a unidade de negócio de cada venda.",
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: noAr("parcial"),
    resposta:
      "Monetização por produto (validadas e ganhos). Venda por unidade aparece em Unidades, pela meta trimestral do Growth.",
    aceite:
      "Composição por produto soma o total; negócio sem conta vinculada aparece à parte no recorte por unidade.",
    pendencia: "Conversão por unidade de ponta a ponta (lead roteado → contrato).",
    indicadores: ["oportunidades-validadas", "contratos-ganhos"],
    paineis: ["metas-unidade"],
  },
  {
    id: "E4",
    frente: "rede",
    texto: "O que a matriz gerou, distribuiu e converteu para cada unidade?",
    origem: "mapa",
    exigencia: 6,
    pilar: "distribuicao",
    apoios: ["economia_rede", "governanca"],
    roadmap: ["F05"],
    fonte:
      "Meta trimestral × vendido por unidade (growth.dist_metas); roteamento lead → unidade ainda não é evento registrado.",
    responsavel: "Comercial / Expansão",
    growth: "Distribui a demanda e mede o vendido por unidade.",
    ops: NA,
    cobertura: "depende_dado",
    estados: nesta("parcial", null, "pendente"),
    resposta:
      "Vendido contra meta por unidade e trimestre. Leads gerados, distribuídos e trabalhados por unidade ainda não são rastreados como evento.",
    aceite:
      "Mudança de dono atual não reescreve o autor do evento; agregado confere com eventos únicos.",
    pendencia: "Registrar roteamento e unidade de destino no evento.",
    indicadores: [],
    paineis: ["metas-unidade"],
  },
  // ── Clientes ─────────────────────────────────────────────────────────────
  {
    id: "C1",
    frente: "clientes",
    texto: "Quantos clientes temos de verdade?",
    origem: "prd",
    pilar: "base",
    apoios: ["retencao", "governanca"],
    roadmap: ["F01"],
    fonte:
      "Quatro réguas candidatas lado a lado (contrato no Omie, pagou em 90 dias, cadastro, MRR), por CNPJ e com sobreposição; o Financeiro conta outra (clientes com faturamento no mês).",
    responsavel: "CEO + Departamento de Receitas",
    growth: NA,
    ops: "CS mantém o cadastro e a Central de Tratativas que sustentam as réguas.",
    cobertura: "depende_decisao",
    estados: noAr("parcial", "Definição de cliente ativo por contexto"),
    resposta:
      "Quatro réguas com sobreposição (rodada 2). A ponte mostra ainda os clientes com faturamento no mês, outra régua.",
    aceite:
      "Definição de cliente ativo por contexto aprovada e aplicada com denominador explícito.",
    pendencia:
      "Escolher, por contexto, qual régua vale; completar CNPJ das empresas sem documento no cadastro.",
    indicadores: [],
    paineis: ["clientes-ativos"],
  },
  {
    id: "C2",
    frente: "portfolio",
    texto: "Onde há oferta disponível para trabalhar agora?",
    origem: "prd",
    pilar: "portfolio",
    apoios: ["base"],
    roadmap: ["F03"],
    fonte: "Base de clientes: regra de elegibilidade de cada produto e disponibilidade no CRM.",
    responsavel: "Departamento de Receitas",
    growth: NA,
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: noAr("integrado"),
    resposta: "Contas únicas prontas em ao menos um produto, sem duplicar sobreposição.",
    aceite:
      "Contas únicas batem com a Base de clientes no mesmo recorte; sobreposição não duplica conta.",
    pendencia: null,
    indicadores: ["contas-prontas"],
    paineis: [],
  },
  {
    id: "C3",
    frente: "portfolio",
    texto: "Quantos clientes ativos consomem cada vertical?",
    origem: "mapa",
    exigencia: 2,
    pilar: "portfolio",
    apoios: ["base"],
    roadmap: ["F03"],
    fonte: "Penetração ganha no CRM (Monetização); consumo ou ativação por vertical não tem fonte.",
    responsavel: "Donos das verticais + Departamento de Receitas",
    growth: NA,
    ops: "Ativação na entrega é o sinal de consumo que falta.",
    cobertura: "depende_decisao",
    estados: noAr("sem_campo", "Definição de cliente ativo"),
    resposta:
      "Só penetração vendida (ganho no CRM), rotulada como tal; penetração efetiva exige evidência de consumo.",
    aceite:
      "Dois denominadores explícitos: clientes ativos e elegíveis à vertical; ganho no CRM não conta como consumo.",
    pendencia: "Definição de cliente ativo e sinal de ativação por vertical.",
    indicadores: [],
    paineis: ["clientes-ativos"],
  },
  // ── Retenção e expansão ──────────────────────────────────────────────────
  {
    id: "T1",
    frente: "retencao",
    texto: "Quem permanece, expande ou sai, por coorte?",
    origem: "mapa",
    exigencia: 4,
    pilar: "retencao",
    apoios: ["governanca"],
    roadmap: ["F06"],
    fonte:
      "Coortes: contratos ganhos × churn datado da Central de Tratativas. Expansão e contração: faturamento por cliente (ponte).",
    responsavel: "CS + Financeiro",
    growth: "A safra de aquisição é o denominador da coorte.",
    ops: "CS registra o churn datado; sem ele a coorte não mede saída.",
    cobertura: "depende_dado",
    estados: nesta("parcial", null, "conferida"),
    resposta:
      "Coortes de logo (teto, porque só 29 churns têm data) e, na ponte, expansão, contração e sem faturamento por mês, pela régua de emissão.",
    aceite: "Denominador fixo da coorte; buraco no histórico não vira retenção zero.",
    pendencia:
      "Datar todo churn; contrato com início e fim por cliente e produto; reproduzir os 2,34% do mapa.",
    indicadores: ["faturamento-saiu"],
    paineis: ["coortes", "ponte"],
  },
  // ── Operação e capacidade ────────────────────────────────────────────────
  {
    id: "O1",
    frente: "operacao",
    texto: "Conseguimos ativar o que vendemos?",
    origem: "desdobramento",
    pilar: "entrega",
    apoios: ["retencao"],
    roadmap: ["F12"],
    fonte:
      "Pipe de Onboarding (ops.cs_onboarding_cards, desde 16/07/2026) ligado ao contrato ganho.",
    responsavel: "Operações + CS",
    growth: NA,
    ops: "Dono da fila: cada card parado é venda que ainda não virou cliente ativo.",
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta:
      "Fila por fase e idade na fase, concluídos, churn no onboarding. As faixas de 30 e 60 dias são de leitura: não há SLA decidido.",
    aceite: "Contagem por fase confere com o Pipefy espelhado; idade pela entrada na fase.",
    pendencia: "SLA de onboarding decidido por Operações.",
    indicadores: ["onboarding-parado"],
    paineis: ["onboarding"],
  },
  {
    id: "O2",
    frente: "operacao",
    texto: "A venda chega até o faturamento e fica?",
    origem: "desdobramento",
    pilar: "entrega",
    apoios: ["distribuicao", "retencao", "governanca"],
    roadmap: ["F12", "F02", "F05"],
    fonte:
      "Cadeia sobre a mesma safra: contrato ganho → card de onboarding → onboarding concluído → CNPJ faturado no Financeiro → churn datado.",
    responsavel: "RevOps + Operações + Controladoria",
    growth: "A venda do Inside Sales é o primeiro elo.",
    ops: "Onboarding é o elo do meio; o tempo até concluir é a medida de ativação.",
    cobertura: "implementada_nao_homologada",
    estados: nesta("parcial"),
    resposta:
      "Contagem por elo, com o que não liga por falta de chave (sem empresa, sem CNPJ, CNPJ fora do cadastro do Omie, nome ambíguo). Recebimento por cliente não é lido.",
    aceite:
      "Cada elo conferido com SQL independente; ligação só por chave (empresa, CNPJ, nome normalizado único).",
    pendencia: "Recebimento por cliente; CNPJ no lançamento do Financeiro.",
    indicadores: [],
    paineis: ["cadeia"],
  },
  {
    id: "T2",
    frente: "operacao",
    texto: "A entrega comporta crescer?",
    origem: "prd",
    pilar: "entrega",
    apoios: ["economia_rede"],
    roadmap: ["F12"],
    fonte:
      "Horas, retrabalho, SLA e custo por cliente não têm fonte; ops.headcount_mensal está vazia.",
    responsavel: "Operações",
    growth: NA,
    ops: "Precisa instrumentar horas, SLA e capacidade por equipe.",
    cobertura: "depende_dado",
    estados: naoIniciada("ausente"),
    resposta: "Não respondida. O único sinal é a fila de onboarding parada (O1).",
    aceite: "Ganho de capacidade tem baseline, período e guardrail de qualidade.",
    pendencia: "Instrumentar a entrega (horas, SLA, retrabalho, capacidade por equipe).",
    indicadores: [],
    paineis: [],
  },
  // ── Unidades ─────────────────────────────────────────────────────────────
  {
    id: "N3",
    frente: "rede",
    texto: "Como estão faturamento, repasses e concentração por unidade?",
    origem: "prd",
    pilar: "economia_rede",
    apoios: ["governanca"],
    roadmap: ["F07", "F02"],
    fonte:
      "Apuração de royalties confirmada por unidade (faturamento, royalties + CSC, concentração).",
    responsavel: "Controladoria",
    growth: NA,
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: noAr("integrado"),
    resposta:
      "Faturamento, participação, royalties + CSC e concentração na janela de meses completos. Recebido por unidade fica fora (régua de competência não confiável).",
    aceite:
      "Repasse por unidade fecha com a apuração confirmada; mês em rascunho não conta como realizado.",
    pendencia: "Recebido por unidade com régua confiável.",
    indicadores: [],
    paineis: ["rede-unidades"],
  },
  {
    id: "N4",
    frente: "rede",
    texto: "Quais unidades cumprem a meta trimestral de venda?",
    origem: "desdobramento",
    pilar: "economia_rede",
    apoios: ["distribuicao"],
    roadmap: ["F05", "F07"],
    fonte: "growth.dist_metas: meta e vendido por unidade e trimestre.",
    responsavel: "Expansão + Growth",
    growth: "Define a meta por unidade e mede o vendido.",
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta: "Meta × vendido por unidade no trimestre, com o total da rede.",
    aceite: "Soma por unidade confere com a tabela do Growth.",
    pendencia: null,
    indicadores: [],
    paineis: ["metas-unidade"],
  },
  {
    id: "N1",
    frente: "rede",
    texto: "Quais unidades crescem com margem?",
    origem: "mapa",
    exigencia: 8,
    pilar: "economia_rede",
    apoios: ["governanca"],
    roadmap: ["F07"],
    fonte: "DRE padronizada por unidade (ainda inexistente).",
    responsavel: "Controladoria",
    growth: NA,
    ops: NA,
    cobertura: "depende_dado",
    estados: naoIniciada("ausente"),
    resposta: "Não respondida: custo por unidade não existe no Brain.",
    aceite: "Receita e custo rastreáveis; cobertura das unidades explícita.",
    pendencia: "Plano de contas gerencial comum por unidade (F07).",
    indicadores: [],
    paineis: [],
  },
  {
    id: "N2",
    frente: "rede",
    texto: "O sócio da unidade está satisfeito?",
    origem: "mapa",
    exigencia: 9,
    pilar: "economia_rede",
    apoios: ["governanca"],
    roadmap: ["F08"],
    fonte:
      "Pesquisa do comitê de sócios recebe respostas pelo formulário público, mas não tem política de leitura.",
    responsavel: "Relacionamento com unidades",
    growth: NA,
    ops: NA,
    cobertura: "depende_decisao",
    estados: naoIniciada("sem_acesso", "Quem lê a pesquisa dos sócios"),
    resposta: "Não respondida: nenhum papel lê a pesquisa pelo app.",
    aceite: "Público, período, amostra e não respondentes visíveis; cobertura baixa sinalizada.",
    pendencia: "Decidir quem lê a pesquisa e criar a política de leitura.",
    indicadores: [],
    paineis: [],
  },
  // ── Portfólio e monetização ──────────────────────────────────────────────
  {
    id: "R4",
    frente: "portfolio",
    texto: "De onde vem o próximo incremento da monetização?",
    origem: "prd",
    pilar: "portfolio",
    apoios: ["distribuicao"],
    roadmap: ["F11"],
    fonte: "Receita prevista declarada no CRM em oportunidades validadas abertas (Monetização).",
    responsavel: "Departamento de Receitas",
    growth: NA,
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: noAr("parcial"),
    resposta: "Soma da receita prevista declarada; negócios sem valor contados à parte.",
    aceite:
      "Soma confere com os negócios do recorte; faltantes e moedas divergentes aparecem à parte.",
    pendencia: "Ligar ao faturamento realizado (F02) antes de projetar contribuição à meta.",
    indicadores: ["receita-prevista-aberta"],
    paineis: [],
  },
  {
    id: "R5",
    frente: "portfolio",
    texto: "Qual produto compensa originar e entregar?",
    origem: "mapa",
    exigencia: 3,
    pilar: "portfolio",
    apoios: ["entrega"],
    roadmap: ["F04", "F12"],
    fonte: "Preço, repasses e custos atribuíveis por produto (ainda inexistente).",
    responsavel: "Produto + Financeiro",
    growth: "Custo de originação por produto sairia da mídia e do comercial.",
    ops: "Custo de entrega por produto sairia das horas da operação.",
    cobertura: "depende_dado",
    estados: naoIniciada("ausente", "Regra de rateio Partners × unidade × parceiro (E09)"),
    resposta: "Não respondida: não há custo por produto.",
    aceite: "Margem com memória de cálculo; sem custo apurado a margem aparece desconhecida.",
    pendencia: "Coletar custos de originação e entrega por produto.",
    indicadores: [],
    paineis: [],
  },
  // ── Caixa e margem ───────────────────────────────────────────────────────
  {
    id: "X1",
    frente: "caixa",
    texto: "Com que margem operamos, e em qual grupo de empresas?",
    origem: "desdobramento",
    pilar: "governanca",
    apoios: ["economia_rede", "portfolio"],
    roadmap: ["F07"],
    fonte:
      "Financial Brain: fn_cockpit_indicadores (receita bruta, lucro bruto, resultado por empresa).",
    responsavel: "Controladoria / CFO",
    growth: NA,
    ops: "Custo da operação está no lucro bruto de cada grupo.",
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta:
      "Receita bruta, lucro bruto (margem de contribuição da DRE) e resultado por grupo de apuração no ano, meses fechados.",
    aceite: "Soma por grupo confere com o total da função; definição da DRE declarada.",
    pendencia: null,
    indicadores: [],
    paineis: ["margem"],
  },
  {
    id: "X2",
    frente: "caixa",
    texto: "Quanto caixa temos no fim do último mês fechado?",
    origem: "desdobramento",
    pilar: "governanca",
    apoios: ["consolidacao"],
    roadmap: ["F07"],
    fonte: "Financial Brain: caixa livre = saldo bancário (decisão da Controladoria de 26/08).",
    responsavel: "Controladoria / CFO",
    growth: NA,
    ops: NA,
    cobertura: "implementada_nao_homologada",
    estados: nesta("parcial"),
    resposta: "Saldo bancário no fim do mês, com as empresas sem saldo nomeadas.",
    aceite: "Mesmo valor da tela de Fluxo de caixa; empresas sem saldo visíveis.",
    pendencia: null,
    indicadores: [],
    paineis: ["caixa"],
  },
  // ── Evidências e capital ─────────────────────────────────────────────────
  {
    id: "K1",
    frente: "capital",
    texto: "O que podemos consolidar, com qual capital e em que ritmo?",
    origem: "mapa",
    exigencia: 10,
    pilar: "consolidacao",
    apoios: ["governanca"],
    roadmap: ["F10", "F11"],
    fonte: "Cadastro de alvos e cenários, separados do realizado (inexistente).",
    responsavel: "CEO + CFO",
    growth: NA,
    ops: "Integração de operações adquiridas depende de capacidade de entrega.",
    cobertura: "depende_decisao",
    estados: naoIniciada("ausente", "Mandato de aquisição"),
    resposta: "Não respondida: aquisições aparecem na ponte como não modeladas.",
    aceite:
      "Cenário distingue preço indicativo, negociação e compromisso; sinergia não vira receita realizada.",
    pendencia: "Mandato de aquisição e acesso restrito ao módulo.",
    indicadores: [],
    paineis: [],
  },
  {
    id: "K2",
    frente: "capital",
    texto: "Conseguimos reproduzir as demonstrações consolidadas?",
    origem: "mapa",
    exigencia: 11,
    pilar: "governanca",
    apoios: ["consolidacao"],
    roadmap: ["F07", "F13"],
    fonte:
      "Financial Brain fecha por competência (cobertura por mês), mas sem fluxo de fechamento versionado.",
    responsavel: "Controladoria / CFO",
    growth: NA,
    ops: NA,
    cobertura: "depende_dado",
    estados: naoIniciada("parcial"),
    resposta:
      "Parcial: a DRE mensal existe e declara meses fechados e parciais; não há versão imutável do fechamento.",
    aceite: "Exportar o mesmo recorte fechado reproduz o número; auditável não é auditado.",
    pendencia: "Fluxo pendente → conciliado → revisado → fechado (F07).",
    indicadores: [],
    paineis: [],
  },
  {
    id: "K3",
    frente: "capital",
    texto: "Podemos demonstrar origem e uso dos dados da base?",
    origem: "mapa",
    exigencia: 5,
    pilar: "governanca",
    apoios: ["base"],
    roadmap: ["F09"],
    fonte: "Inventário de tratamento de dados (inexistente).",
    responsavel: "Jurídico / Privacidade",
    growth: NA,
    ops: NA,
    cobertura: "depende_dado",
    estados: naoIniciada("ausente"),
    resposta: "Não respondida.",
    aceite: "Documento ausente gera pendência, nunca selo automático de conformidade.",
    pendencia: "Inventário de finalidade, base legal e retenção.",
    indicadores: [],
    paineis: [],
  },
  {
    id: "K4",
    frente: "capital",
    texto: "A documentação da rede e o histórico de sócios estão completos?",
    origem: "mapa",
    exigencia: 7,
    pilar: "governanca",
    apoios: ["economia_rede"],
    roadmap: ["F09"],
    fonte: "COF, contratos e desligados dos últimos 24 meses (fora do Brain).",
    responsavel: "Jurídico + Expansão",
    growth: NA,
    ops: NA,
    cobertura: "depende_dado",
    estados: naoIniciada("ausente"),
    resposta: "Não respondida.",
    aceite: "Cada unidade com documento, data e responsável; revisão pelo Jurídico.",
    pendencia: "Fila de documentação da rede.",
    indicadores: [],
    paineis: [],
  },
  {
    id: "G1",
    frente: "capital",
    texto: "Os dados que sustentam o cockpit estão atualizados?",
    origem: "desdobramento",
    pilar: "governanca",
    apoios: [],
    roadmap: ["F13"],
    fonte:
      "Frescor declarado por fonte: Financial Brain (dado_frescor), Growth, carga da Monetização.",
    responsavel: "Dono de cada fonte",
    growth: "Mantém o sync do Growth.",
    ops: "Mantém os syncs do Ops (Pipefy, Pipedrive, Omie).",
    cobertura: "implementada_nao_homologada",
    estados: nesta("integrado"),
    resposta:
      "Data da última carga de cada fonte e aviso quando passa da cadência. Em 23/09 o Financeiro está sem carga desde 20/09.",
    aceite: "Data mostrada igual à registrada pela fonte.",
    pendencia: "Retomar os crons do Financeiro (cobrança das GitHub Actions).",
    indicadores: [],
    paineis: ["frescor"],
  },
];

export const perguntasDaFrente = (f: Frente) => PERGUNTAS.filter((p) => p.frente === f);

/** Pergunta "respondida" para a contagem da tela: dado integrado ou parcial e cálculo no cockpit. */
export function situacaoDaPergunta(p: PerguntaCatalogo): "respondida" | "parcial" | "lacuna" {
  if (p.estados.implementacao === "nao_iniciada") return "lacuna";
  if (p.estados.dado === "integrado" && !p.estados.decisao) return "respondida";
  return "parcial";
}
