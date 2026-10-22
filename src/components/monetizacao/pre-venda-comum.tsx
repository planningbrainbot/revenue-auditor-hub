// O que as três visões da Pré-venda dividem: o controle segmentado, os estados de leitura, os formatos de número e os
// selos de nota e de situação. Contrato docs/design/contratos/monetizacao-pre-venda.md.
import type { ReactNode } from "react";
import { CircleCheck, Clock, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  StatusBadge,
  type TomKpi,
  type TomStatus,
} from "@/components/planning";
import { cn } from "@/lib/utils";
import {
  classificarErroPreVenda,
  faixa,
  ROTULO_FAIXA,
  ROTULO_SITUACAO_LIGACAO,
  situacaoDaLigacao,
  type Faixa,
  type StatusAvaliacao,
} from "@/lib/monetizacao/pre-venda";
import type { BuscaMonetizacao, VisaoPreVenda as Visao } from "./busca";

export const FONTE_PRE_VENDA =
  "Pipedrive, pipeline 39 (cards e atividades da cadência) · ligações do ramal Api4Com · avaliação pelo script de 09/10";

export const INT = new Intl.NumberFormat("pt-BR");
export const DEC1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
/** "70%": a aderência e as taxas sem casa decimal (bate o olho). */
export const pct = (v: number) => `${Math.round(v)}%`;
export const plural = (n: number, um: string, varios: string) =>
  `${INT.format(n)} ${n === 1 ? um : varios}`;

/** Tom de status de cada faixa de aderência, com ícone: cor nunca sozinha (V7). */
export const TOM_FAIXA: Record<Faixa, { tom: TomStatus; icone: LucideIcon; celula: string }> = {
  bom: { tom: "sucesso", icone: CircleCheck, celula: "bg-success-soft text-success" },
  atencao: { tom: "atencao", icone: TriangleAlert, celula: "bg-warning-soft text-warning" },
  critico: { tom: "perigo", icone: OctagonAlert, celula: "bg-danger-soft text-danger" },
};

/** O mesmo tom no `KpiCard` (que não tem neutro). */
export const TOM_KPI_FAIXA: Record<Faixa, TomKpi> = {
  bom: "sucesso",
  atencao: "atencao",
  critico: "perigo",
};

/** Nota da ligação em selo: o número e o ícone da faixa; a palavra da faixa vai para o leitor de tela. */
export function SeloNota({ nota }: { nota: number | null }) {
  if (nota === null) return <span className="text-muted-foreground">—</span>;
  const f = faixa(nota);
  return (
    <StatusBadge tom={TOM_FAIXA[f].tom} icone={TOM_FAIXA[f].icone} className="num">
      {pct(nota)}
      <span className="sr-only"> ({ROTULO_FAIXA[f]})</span>
    </StatusBadge>
  );
}

/** Situação da ligação na fila de avaliação: pendente e transcrevendo aparecem como "Na fila". */
export function SeloSituacao({ status }: { status: StatusAvaliacao }) {
  const s = situacaoDaLigacao(status);
  const tom: TomStatus = s === "erro" ? "perigo" : s === "avaliada" ? "neutro" : "info";
  const icone = s === "avaliada" ? CircleCheck : s === "erro" ? undefined : Clock;
  return (
    <StatusBadge tom={tom} icone={icone}>
      {ROTULO_SITUACAO_LIGACAO[s]}
    </StatusBadge>
  );
}

/** O que é próprio de cada visão: trocar de visão limpa, e ficam o período e a pessoa. */
export const LIMPA_VISAO: Partial<BuscaMonetizacao> = {
  ficha: undefined,
  ligacao: undefined,
  falta: undefined,
  antipadrao: undefined,
  reuniao: undefined,
  mes: undefined,
  gravacao: undefined,
  q: undefined,
  aposentada: undefined,
};

export const visaoDa = (b: Pick<BuscaMonetizacao, "visao">): Visao =>
  b.visao === "aderencia" || b.visao === "ficha" ? b.visao : "ritmo";

/**
 * Controle segmentado do DS (o mesmo do período da barra): grupo de botões com `aria-pressed`, o ativo em
 * `foreground`. Serve às três visões e ao "Ligações | Reuniões" da Ficha.
 */
export function Segmentado<T extends string>({
  rotulo,
  opcoes,
  valor,
  mudar,
  tamanho = "md",
}: {
  rotulo: string;
  opcoes: { chave: T; rotulo: ReactNode }[];
  valor: T;
  mudar: (v: T) => void;
  tamanho?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-input bg-card p-0.5",
        tamanho === "md" ? "h-10" : "h-9",
      )}
    >
      {opcoes.map((o) => {
        const ativo = o.chave === valor;
        return (
          <button
            key={o.chave}
            type="button"
            aria-pressed={ativo}
            onClick={() => !ativo && mudar(o.chave)}
            className={cn(
              "inline-flex h-full shrink-0 items-center gap-1.5 rounded-md font-medium outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring",
              tamanho === "md" ? "px-4 text-sm" : "px-3 text-[13px]",
              ativo
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Uma leitura de RPC como a tela precisa: dado, erro, carregando e o "tentar de novo". */
export type Consulta<T> = {
  data?: T;
  erro: Error | null;
  carregando: boolean;
  tentarNovamente: () => void;
};

/**
 * Carregando, sem acesso, "ainda não ativada" e erro, iguais nas três visões. Devolve `null` quando o dado chegou.
 * "Ainda não ativada" é vazio, não erro: a migration do agente de avaliação ainda não foi aplicada (N4).
 */
export function estadoDaLeitura({
  consultas,
  fonte,
  variante,
}: {
  consultas: Consulta<unknown>[];
  fonte: string;
  variante: "kpis" | "tabela";
}) {
  const comErro = consultas.find((c) => c.erro);
  if (comErro?.erro) {
    const tipo = classificarErroPreVenda(comErro.erro.message);
    if (tipo === "sem-acesso") return <EstadoSemAcesso oQueFalta="view.monetizacao" />;
    if (tipo === "nao-ativada")
      return (
        <EstadoVazio
          titulo="A Pré-venda ainda não foi ativada no banco"
          descricao={comErro.erro.message}
        />
      );
    return (
      <EstadoErro
        detalhe={`Fonte: ${fonte}. ${comErro.erro.message}`}
        tentarNovamente={() => consultas.forEach((c) => c.erro && c.tentarNovamente())}
      />
    );
  }
  if (consultas.some((c) => c.carregando || !c.data))
    return (
      <div className="space-y-4">
        <Carregando variante={variante} />
        {variante === "kpis" && <Carregando variante="grafico" />}
      </div>
    );
  return null;
}

/** Linha de uma caixa de atenção (arquétipo Visão geral): uma linha por item, com destino. */
export function LinhaAtencao({
  selo,
  children,
  acao,
}: {
  selo: ReactNode;
  children: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:py-2.5">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
        <span className="shrink-0 sm:w-28">{selo}</span>
        <div className="min-w-0 flex-1 text-sm">{children}</div>
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </li>
  );
}
