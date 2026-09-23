import type { CSSProperties, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  Lock,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { partesDoLink } from "@/lib/areas";
import { corDaArea } from "@/lib/planning/cores-area";
import { Degrau } from "./grafismos";
import { Procedencia } from "./procedencia";
import { StatusBadge } from "./status-badge";

/**
 * O card de número do Brain. Substitui as 20 versões locais e os ~70 inline
 * (spec §1): o mesmo número tem a mesma cara em toda área.
 *
 * O que ele garante, e por quê:
 * - Ausência não é zero (N4). Fora do estado `ok`/`parcial` o valor NUNCA
 *   aparece: "não apurado", "fonte indisponível" e "sem acesso" mostram "—" ou
 *   cadeado com o motivo. Quem passa `valor={0}` enquanto carrega mente.
 * - Meta ao lado do realizado (N13), nunca somada a ele.
 * - Procedência na última linha (N3), discreta, sem cor de alerta.
 * - Só reage a hover se abre algo (N2, V11): com `abrir`, o card inteiro vira
 *   link ou botão, ganha o filete da área e diz "Abrir registros →". Sem
 *   `abrir`, nem borda nem cursor mudam, para não prometer um clique que não
 *   existe.
 * - Tom de negócio opcional (`tom`): quando o número em si é bom ou ruim
 *   ("Perdidos", "Risco", saúde abaixo da régua), o valor sai na cor do tom,
 *   com ícone de status ao lado e filete lateral fixo no tom. Cor nunca
 *   sozinha (V7): o ícone acompanha sempre, e a palavra vem em `tomRotulo`
 *   (ou, sem ela, só para leitor de tela). Neutro não é tom: não passe nada.
 * - HTML válido na variante clicável: dentro de `<a>`/`<button>` só há
 *   `<span>` (com `block`/`flex`), porque os dois só aceitam conteúdo de frase.
 */
export type EstadoKpi = "ok" | "parcial" | "nao-apurado" | "indisponivel" | "sem-acesso";

export type TomKpi = "sucesso" | "atencao" | "perigo" | "info";

const TONS: Record<TomKpi, { texto: string; filete: string; icone: LucideIcon; palavra: string }> = {
  sucesso: { texto: "text-success", filete: "bg-success", icone: CheckCircle2, palavra: "positivo" },
  atencao: { texto: "text-warning", filete: "bg-warning", icone: AlertTriangle, palavra: "atenção" },
  perigo: { texto: "text-danger", filete: "bg-danger", icone: AlertOctagon, palavra: "crítico" },
  info: { texto: "text-info", filete: "bg-info", icone: Info, palavra: "informação" },
};

/**
 * Traduz o `tone`/`accent` dos cards locais antigos para o tom do KpiCard,
 * preservando o sentido: verde → sucesso, vermelho → perigo, âmbar/laranja →
 * atenção, azul/índigo/ciano → info. Neutro, cinza, roxo e o que não for
 * reconhecido → sem tom (card neutro).
 */
export function tomDoLegado(tone: string | boolean | null | undefined): TomKpi | undefined {
  if (tone === true) return "sucesso";
  switch (tone) {
    case "emerald":
    case "green":
    case "ok":
    case "sucesso":
      return "sucesso";
    case "red":
    case "danger":
    case "destructive":
    case "perigo":
      return "perigo";
    case "amber":
    case "orange":
    case "warn":
    case "warning":
    case "atencao":
      return "atencao";
    case "indigo":
    case "sky":
    case "blue":
    case "info":
      return "info";
    default:
      return undefined;
  }
}

export type KpiCardProps = {
  rotulo: string;
  valor: ReactNode;
  unidade?: string;
  /**
   * Contexto do número, abaixo do valor: a régua ("MRR ÷ clientes ativos"), a
   * contagem de apoio ("de 57 cadastrados") ou um desdobramento curto. Existe
   * porque os 20 cards locais que este substitui quase todos tinham essa
   * linha; sem ela, migrar apagava informação. Continua em "não apurado" e
   * "fonte indisponível", onde costuma ser o porquê ("sem mídia no período");
   * some só em "sem acesso", porque nota com número vazaria o que o cadeado
   * esconde.
   */
  nota?: ReactNode;
  /** Variação em % (12 = +12%). `rotulo` completa a frase: "vs ago". */
  delta?: { valor: number; rotulo?: string; sentido?: "maior-melhor" | "menor-melhor" };
  /**
   * Meta do período. A porcentagem atingida aparece quando `progresso` (0–1)
   * vem pronto ou quando `valor` e `meta.valor` são números.
   */
  meta?: { valor: ReactNode; rotulo?: string; progresso?: number };
  estado?: EstadoKpi;
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null };
  /** Drill-down: o card inteiro abre os registros que compõem o número. */
  abrir?: { href?: string; onClick?: () => void; rotulo?: string };
  /** Cor do filete no hover. Sem ela, a área da página (`--area-atual`). */
  area?: string;
  /**
   * Tom de negócio do número: pinta o valor, põe o ícone do tom ao lado e fixa
   * o filete lateral na cor do tom (no lugar do filete de área do hover).
   * Só vale com o valor à mostra (`ok`/`parcial`). Sem tom = neutro.
   */
  tom?: TomKpi;
  /** Palavra ao lado do ícone do tom ("em risco", "acima da meta"). Sem ela, o ícone vai só com texto para leitor de tela. */
  tomRotulo?: string;
  className?: string;
};

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function KpiCard({
  rotulo,
  valor,
  unidade,
  nota,
  delta,
  meta,
  estado = "ok",
  procedencia,
  abrir,
  area,
  tom,
  tomRotulo,
  className,
}: KpiCardProps) {
  const mostraValor = estado === "ok" || estado === "parcial";
  const t = tom && mostraValor ? TONS[tom] : undefined;
  // `sub && …` dos cards antigos: string vazia e false também não ocupam linha.
  const temNota = nota !== undefined && nota !== null && nota !== false && nota !== "";
  // Sem acesso não abre nada: o destino também estaria fechado.
  const clicavel = !!abrir && (!!abrir.href || !!abrir.onClick) && estado !== "sem-acesso";

  const progresso =
    meta?.progresso ??
    (typeof valor === "number" && typeof meta?.valor === "number" && meta.valor !== 0
      ? valor / meta.valor
      : undefined);

  const conteudo = (
    <>
      {t ? (
        // Filete fixo no tom: o sinal do número se lê de longe, sem hover.
        <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r-full", t.filete)} />
      ) : (
        clicavel && (
          <span
            aria-hidden
            className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[var(--filete)] opacity-0 transition-opacity duration-[120ms] ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )
      )}

      <span className="flex min-h-5 items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase leading-5 tracking-wider text-muted-foreground">
          {rotulo}
        </span>
        {estado === "parcial" && <StatusBadge tom="atencao">parcial</StatusBadge>}
        {/* Absoluto para não roubar largura do rótulo enquanto está invisível. */}
        {clicavel && estado !== "parcial" && (
          <span className="absolute right-3 top-3.5 whitespace-nowrap rounded-md bg-card px-1 text-xs font-medium leading-5 text-primary-text opacity-0 transition-opacity duration-[120ms] ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
            {abrir?.rotulo ?? "Abrir registros"} →
          </span>
        )}
      </span>

      <span className="mt-2 flex min-h-9 flex-wrap items-baseline gap-x-1.5">
        {mostraValor ? (
          <>
            <span className={cn("num text-[30px] font-bold leading-9 tracking-tight", t ? t.texto : "text-foreground")}>
              {valor}
            </span>
            {unidade && (
              <span className="text-sm font-medium text-muted-foreground">{unidade}</span>
            )}
            {t && <SinalTom tom={tom!} rotulo={tomRotulo} />}
          </>
        ) : (
          <Ausencia estado={estado} />
        )}
      </span>

      {estado !== "sem-acesso" && temNota && (
        <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{nota}</span>
      )}

      {mostraValor && (delta || meta) && (
        <span className="mt-2 block space-y-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {delta && <Delta {...delta} />}
            {meta && (
              <span className="num text-muted-foreground">
                {meta.rotulo ?? "meta"} {meta.valor}
                {progresso !== undefined && ` · ${NUM.format(progresso * 100)}%`}
              </span>
            )}
          </span>
          {progresso !== undefined && <BarraMeta progresso={progresso} />}
        </span>
      )}

      {procedencia && (
        // Quebra em até duas linhas em vez de cortar numa só: cortada, a linha
        // mostrava "atualizado em 23…" e escondia justo a data (N3).
        <Procedencia
          fonte={procedencia.fonte}
          atualizadoEm={procedencia.atualizadoEm}
          como="span"
          className="mt-auto items-start pt-3 [&>svg]:mt-px [&>span:last-child]:line-clamp-2"
        />
      )}
    </>
  );

  const base = cn(
    "group relative flex h-full min-w-0 flex-col rounded-xl border bg-card p-4 text-left text-card-foreground",
    className,
  );
  const interativo =
    "cursor-pointer outline-none transition-colors duration-[120ms] ease-out hover:border-input focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const estilo = { "--filete": area ? corDaArea(area) : "var(--area-atual, var(--primary))" } as CSSProperties;

  if (clicavel && abrir?.href) {
    if (abrir.href.startsWith("/")) {
      const { to, search } = partesDoLink(abrir.href);
      return (
        <Link
          to={to as never}
          search={search as never}
          onClick={abrir.onClick}
          className={cn(base, interativo)}
          style={estilo}
        >
          {conteudo}
        </Link>
      );
    }
    return (
      <a href={abrir.href} onClick={abrir.onClick} className={cn(base, interativo)} style={estilo}>
        {conteudo}
      </a>
    );
  }
  if (clicavel && abrir?.onClick) {
    return (
      <button type="button" onClick={abrir.onClick} className={cn(base, interativo, "w-full")} style={estilo}>
        {conteudo}
      </button>
    );
  }
  return <div className={base}>{conteudo}</div>;
}

function Delta({
  valor,
  rotulo,
  sentido = "maior-melhor",
}: {
  valor: number;
  rotulo?: string;
  sentido?: "maior-melhor" | "menor-melhor";
}) {
  const direcao = valor > 0 ? "sobe" : valor < 0 ? "desce" : "estavel";
  // A cor vem do sentido do indicador, não da seta: churn que desce é bom.
  const bom = sentido === "maior-melhor" ? valor > 0 : valor < 0;
  const cor = direcao === "estavel" ? "text-muted-foreground" : bom ? "text-success" : "text-danger";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return (
    <span className={cn("num inline-flex items-center gap-1 font-semibold", cor)}>
      <Degrau sentido={direcao} />
      {sinal}
      {NUM.format(Math.abs(valor))}%
      {rotulo && <span className="font-normal text-muted-foreground">{rotulo}</span>}
    </span>
  );
}

function SinalTom({ tom, rotulo }: { tom: TomKpi; rotulo?: string }) {
  const { texto, icone: Icone, palavra } = TONS[tom];
  return (
    <span className={cn("inline-flex items-center gap-1 self-center text-[13px] font-medium", texto)}>
      <Icone className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      {rotulo ? rotulo : <span className="sr-only">{palavra}</span>}
    </span>
  );
}

function BarraMeta({ progresso }: { progresso: number }) {
  const pct = Math.max(0, Math.min(1, progresso)) * 100;
  const real = NUM.format(progresso * 100);
  return (
    // aria-valuenow fica em 0–100 (fora disso o leitor de tela se perde);
    // meta superada aparece com o percentual real no valuetext.
    <span
      className="block h-1 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={`${real}% da meta`}
      aria-label="Realizado da meta"
    >
      <span
        className={cn("block h-full rounded-full", progresso >= 1 ? "bg-success" : "bg-primary-text")}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

const AUSENCIAS = {
  "nao-apurado": { icone: CircleDashed, texto: "não apurado" },
  indisponivel: { icone: Unplug, texto: "fonte indisponível" },
  "sem-acesso": { icone: Lock, texto: "sem acesso" },
} as const;

function Ausencia({ estado }: { estado: Exclude<EstadoKpi, "ok" | "parcial"> }) {
  const { icone: Icone, texto } = AUSENCIAS[estado];
  return (
    <>
      {estado === "sem-acesso" ? (
        <Lock className="size-5 self-center text-muted-foreground" aria-hidden />
      ) : (
        <span className="text-[30px] font-bold leading-9 text-muted-foreground" aria-hidden>
          —
        </span>
      )}
      <span className="inline-flex items-center gap-1 self-center text-[13px] text-muted-foreground">
        {estado !== "sem-acesso" && <Icone className="size-3.5" aria-hidden />}
        {texto}
      </span>
    </>
  );
}

/** Grade de KPIs: 2 colunas no celular, até 6 no desktop (DESIGN.md §9). */
export function KpiGrade({
  children,
  colunas = 4,
  className,
}: {
  children: ReactNode;
  colunas?: 2 | 3 | 4 | 6;
  className?: string;
}) {
  const grade = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  }[colunas];
  return <div className={cn("grid gap-3", grade, className)}>{children}</div>;
}
