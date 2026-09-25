// Jev na conversa: classifica a pergunta (domínio e ambiguidade) e a regra abaixo decide o
// encaminhamento. Papel delimitado:
// - escolhe entre opções fixas; não calcula número, não escolhe métrica, não concede acesso;
// - recebe só o texto da pergunta e um resumo dos filtros da visão anterior, nunca dado de negócio;
// - se falhar, a pergunta segue para o modelo principal com todas as ferramentas.
// Os limiares vêm da calibração com as perguntas do Pedro (docs/dev_notes/cockpit-ceo-conversa/).
import { JEV_MODELO, TAXONOMIA_CONVERSA } from "../jev/contrato.ts";
import type { PedidoJev, RespostaJev } from "../jev/contrato.ts";
import { CONSULTAS, NOMES_CONSULTAS } from "./metricas.ts";
import type { Dominio, NomeConsulta } from "./metricas.ts";

export { TAXONOMIA_CONVERSA };

export const OPCOES_DOMINIO = {
  receita:
    "Faturamento da empresa: quanto faturou, variação entre meses, de onde veio a variação, meta anual.",
  aquisicao:
    "Aquisição e vendas novas: MRR novo vendido, plano do Growth, funil de leads, MQL e vendas, ritmo do mês.",
  operacao:
    "Ativação do que foi vendido: onboarding, clientes parados, o caminho da venda até o faturamento.",
  caixa: "Caixa: recebimento, inadimplência, títulos vencidos, margem.",
  unidades: "Unidades da rede: comparar unidades, ranking, quais unidades explicam uma mudança.",
  clientes: "Quantidade de clientes ativos e definição de cliente.",
  retencao: "Quem permanece, sai ou encolhe: churn, coortes, perda de receita da base.",
  portfolio:
    "Monetização da base por produto (Consultoria, Finance, Cella): oportunidades, contratos ganhos, contas prontas.",
  varios: "Pede várias áreas ao mesmo tempo ou uma tela montada com vários indicadores.",
  refinamento:
    "Muda o recorte da resposta anterior (outro período, só uma unidade, só a base nova) sem trocar de assunto.",
  gestao_visao: "Pede para salvar, renomear, abrir ou excluir uma visão já montada.",
  fora_do_escopo: "Não trata dos números ou da gestão da empresa.",
} as const;
export type DominioJev = keyof typeof OPCOES_DOMINIO;
export const DOMINIOS_JEV = Object.keys(OPCOES_DOMINIO) as DominioJev[];

/** Limiares calibrados (ver relatório de calibração). Probabilidade da opção escolhida. */
export const LIMIARES_PADRAO = { dominio: 0.7, ambigua: 0.7, foraDoEscopo: 0.85 } as const;

export function pedidoConversa(pergunta: string, contexto: string): PedidoJev {
  return {
    model: JEV_MODELO,
    state: {
      pergunta: pergunta.slice(0, 2000),
      contexto: contexto ? contexto.slice(0, 1000) : "Sem visão anterior nesta conversa.",
    },
    questions: {
      dominio: {
        type: "choice",
        instructions:
          "O CEO fez a pergunta em `pergunta` ao painel da empresa; `contexto` resume a visão anterior da conversa. De qual assunto são os dados que respondem a ela?",
        criteria: { ...OPCOES_DOMINIO },
      },
      ambigua: {
        type: "noul",
        instructions:
          "Considerando `contexto`, a pergunta em `pergunta` deixa em aberto algo que mudaria a resposta: qual período, qual métrica (por exemplo receita do grupo ou da rede, qual régua de cliente ativo) ou qual unidade?",
        criteria: {
          true: "Falta período, métrica ou entidade, e o contexto não resolve; responder exigiria adivinhar.",
          false:
            "A pergunta, com o contexto, já diz o que medir; o padrão (mês atual, empresa inteira) serve.",
        },
      },
    },
  };
}

const COMUNS: NomeConsulta[] = ["acoes", "frescor"];

export function consultasDoDominio(d: Dominio): NomeConsulta[] {
  return NOMES_CONSULTAS.filter(
    (n) => COMUNS.includes(n) || (CONSULTAS[n].dominios as Dominio[]).includes(d),
  );
}

export interface Encaminhamento {
  modo: "modelo" | "fora_do_escopo";
  /** Domínio aceito (acima do limiar) ou null: o modelo recebe todas as consultas. */
  dominio: Dominio | null;
  classe: DominioJev | null;
  confianca: number | null;
  esclarecer: boolean;
  consultas: NomeConsulta[];
  motivo: "jev_indisponivel" | "confianca_baixa" | "dominio" | "multiplo" | "fora_do_escopo";
}

type SaidaJev =
  | { estado: "ok"; respostas: Record<string, RespostaJev> }
  | { estado: string; codigo?: string; mensagem?: string };

const DOMINIOS_DADO: Dominio[] = [
  "receita",
  "aquisicao",
  "operacao",
  "caixa",
  "unidades",
  "clientes",
  "retencao",
  "portfolio",
];

export function decidirEncaminhamento(
  jev: SaidaJev,
  temContexto: boolean,
  limiares: { dominio: number; ambigua: number; foraDoEscopo: number } = LIMIARES_PADRAO,
): Encaminhamento {
  const todas: Encaminhamento = {
    modo: "modelo",
    dominio: null,
    classe: null,
    confianca: null,
    esclarecer: false,
    consultas: NOMES_CONSULTAS,
    motivo: "jev_indisponivel",
  };
  if (jev.estado !== "ok" || !("respostas" in jev)) return todas;
  const dom = jev.respostas.dominio;
  const amb = jev.respostas.ambigua;
  if (!dom || dom.type !== "choice" || !amb || amb.type !== "noul") return todas;
  const classe = dom.choice as DominioJev;
  const p = dom.probabilities?.[dom.choice] ?? dom.confidence ?? 0;
  const esclarecer = amb.noul >= limiares.ambigua && !temContexto;
  const base = { ...todas, classe, confianca: p, esclarecer };
  if (classe === "fora_do_escopo")
    return p >= limiares.foraDoEscopo
      ? {
          ...base,
          modo: "fora_do_escopo",
          consultas: [],
          motivo: "fora_do_escopo",
          esclarecer: false,
        }
      : { ...base, motivo: "confianca_baixa" };
  if (p < limiares.dominio) return { ...base, motivo: "confianca_baixa" };
  if (!(DOMINIOS_DADO as string[]).includes(classe)) return { ...base, motivo: "multiplo" };
  const dominio = classe as Dominio;
  return { ...base, dominio, consultas: consultasDoDominio(dominio), motivo: "dominio" };
}

/** Resposta fixa para pergunta fora do escopo: sem modelo, sem número. */
export const RESPOSTA_FORA_DO_ESCOPO =
  "Isso está fora do que o Brain responde. Posso mostrar faturamento, aquisição, onboarding, caixa, unidades, clientes, retenção ou portfólio.";
