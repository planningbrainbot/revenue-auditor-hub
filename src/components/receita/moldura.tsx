import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ValidationBanner } from "@/components/validation-banner";
import { DataFreshnessBar } from "@/components/data-freshness-bar";
import { EstadoErro, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { tooltipProps } from "@/lib/planning/grafico";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";

/**
 * Moldura comum das telas de Receita e Repasses (contrato
 * `docs/design/contratos/receita-e-repasses.md`, "Moldura comum").
 *
 * Existe porque as nove telas da área repetiam, cada uma do seu jeito, o mesmo
 * punhado de coisas: mês em `useState` (some ao recarregar), `brl(undefined)`
 * virando "R$ 0" (ausência que parece zero, N4), tooltip de gráfico montado à
 * mão e o `AppShell`, que não aceita pergunta nem procedência. Aqui cada uma
 * tem um lugar só.
 */

// ---------------------------------------------------------------- mês

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function formatarMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` válido. */
export function ehMes(v: unknown): v is string {
  return typeof v === "string" && MES_RE.test(v);
}

/** O mês corrente, `YYYY-MM`, no fuso de quem usa. */
export function mesCorrente(): string {
  return formatarMes(new Date());
}

/** O mês anterior ao corrente: o padrão das telas de apuração (o mês fechado). */
export function mesAnterior(): string {
  return deslocarMes(mesCorrente(), -1);
}

/** `mes` somado de `delta` meses. */
export function deslocarMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  return formatarMes(new Date(y, m - 1 + delta, 1));
}

/** O mês ainda não terminou (corrente ou futuro): os números vão mudar. */
export function mesEmAndamento(mes: string): boolean {
  return mes >= mesCorrente();
}

/** "Agosto de 2026". */
export function rotuloMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "08/26", para eixo de gráfico. */
export function rotuloMesCurto(mes: string): string {
  const [y, m] = mes.split("-");
  return `${m}/${y.slice(2)}`;
}

/**
 * `YYYY-MM-DD` do banco em `dd/MM`, sem passar por `Date`: `new Date("2026-09-10")`
 * é meia-noite UTC e no fuso de casa vira o dia 09.
 */
export function rotuloDia(iso?: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.slice(0, 10).split("-");
  return m && d ? `${d}/${m}` : null;
}

/**
 * O mês da tela, na URL (`?mes=YYYY-MM`, N7). Valor fora do formato vale o
 * padrão; o padrão não aparece na URL, para o link limpo continuar sendo o da
 * tela sem filtro. Troca com `replace`: navegar entre meses não empilha
 * histórico.
 */
export function useMesNaUrl(padrao: string = mesAnterior()): [string, (mes: string) => void] {
  const [bruto, definir] = useFiltroNaUrl("mes", padrao);
  return [ehMes(bruto) ? bruto : padrao, definir];
}

/**
 * Link para outra tela da área levando o mês (`/unidades/royalties?mes=2026-08`),
 * para o total do destino bater com o de origem (N2). Serve tanto para
 * `KpiCard.abrir.href` quanto para `partesDoLink`.
 */
export function hrefComMes(caminho: string, mes: string): string {
  const [base, busca] = caminho.split("?");
  const params = new URLSearchParams(busca ?? "");
  params.set("mes", mes);
  return `${base}?${params.toString()}`;
}

/**
 * Setas de mês com o rótulo no meio, para o `filtros` do `PageHeader`.
 * `maximo` (inclusivo) trava a seta para frente: abrir mês futuro, na ficha de
 * royalties, cria apuração no banco.
 */
export function SeletorMes({
  mes,
  aoMudar,
  maximo = mesCorrente(),
  minimo,
}: {
  mes: string;
  aoMudar: (mes: string) => void;
  maximo?: string;
  minimo?: string;
}) {
  const anterior = deslocarMes(mes, -1);
  const proximo = deslocarMes(mes, 1);
  const podeVoltar = !minimo || anterior >= minimo;
  const podeAvancar = proximo <= maximo;
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => aoMudar(anterior)}
        disabled={!podeVoltar}
        aria-label={`Mês anterior (${rotuloMes(anterior)})`}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <span
        className="min-w-[160px] rounded-md border bg-background px-3 py-1 text-center text-sm font-medium"
        aria-live="polite"
      >
        {rotuloMes(mes)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => aoMudar(proximo)}
        disabled={!podeAvancar}
        aria-label={
          podeAvancar ? `Próximo mês (${rotuloMes(proximo)})` : "Próximo mês indisponível"
        }
        title={podeAvancar ? undefined : "O mês seguinte ainda não pode ser aberto nesta tela"}
      >
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- números

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/**
 * Real sem centavos, e "—" quando o valor não existe (N4). O `brl` de
 * `audit/format` devolve "R$ 0" para `undefined` e continua assim, porque
 * outras áreas dependem dele; nesta área, ausência é travessão.
 */
export function brlOuTraco(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : BRL.format(v);
}

/** Percentual com uma casa ("15,5%"), "—" quando ausente ou sem base. */
export function pctOuTraco(v: number | null | undefined, casas = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** Eixo de dinheiro em milhares: 12 meses de rótulo inteiro não cabem. */
export function eixoMoeda(v: number): string {
  return Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`;
}

// ---------------------------------------------------------------- gráfico

type ItemTooltip = { dataKey?: string | number; name?: string; value?: number; color?: string };

/**
 * Conteúdo de tooltip de dinheiro (Recharts `content`), com a superfície do
 * tema (`tooltipProps.contentStyle`) e o total quando há mais de uma série.
 * Use junto com `cursor={tooltipProps.cursor}`.
 */
export function TooltipMoeda({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ItemTooltip[];
  label?: ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div style={tooltipProps.contentStyle} className="px-3 py-2">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: p.color }}
              aria-hidden
            />
            {p.name}
          </span>
          <span className="num">{brlOuTraco(p.value)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
          <span className="text-muted-foreground">Total</span>
          <span className="num">{brlOuTraco(total)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- texto de apoio

/**
 * Selo da régua de data ("caixa", "competência") ao lado do título de bloco,
 * com a explicação no tooltip. O mesmo mês significa coisas diferentes em cada
 * bloco da área, e confundi-los é o erro que mais custa (DECISIONS 20/07).
 */
export function SeloRegua({ regua, children }: { regua: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <UiTooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            className="cursor-help font-normal text-muted-foreground"
          >
            régua: {regua}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

/**
 * Nota de `KpiCard` com "O que significa?" que abre a explicação. Não use em
 * card com `abrir`: botão dentro de link é HTML inválido.
 */
export function NotaComAjuda({ nota, ajuda }: { nota?: ReactNode; ajuda: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <>
      {nota}
      {nota ? " · " : null}
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={id}
        onClick={() => setAberta((s) => !s)}
        className="rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        O que significa?
      </button>
      <span id={id} className={aberta ? "mt-1 block leading-snug text-foreground" : "hidden"}>
        {ajuda}
      </span>
    </>
  );
}

/**
 * "Como ler estes números": a explicação de cada card de um bloco, aberta sob
 * demanda logo abaixo da grade. Existe para o card com `abrir`, que não pode
 * levar o "O que significa?" (botão dentro de link é HTML inválido).
 */
export function ComoLer({
  itens,
  rotulo = "Como ler estes números",
}: {
  itens: { rotulo: string; texto: ReactNode }[];
  rotulo?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <div className="text-[13px]">
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={id}
        onClick={() => setAberta((s) => !s)}
        className="inline-flex items-center gap-1 rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ChevronDown
          className={aberta ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"}
          aria-hidden
        />
        {rotulo}
      </button>
      <dl
        id={id}
        className={aberta ? "mt-2 grid gap-2 rounded-xl border bg-card p-4 md:grid-cols-2" : "hidden"}
      >
        {itens.map((i) => (
          <div key={i.rotulo} className="space-y-0.5">
            <dt className="font-semibold text-foreground">{i.rotulo}</dt>
            <dd className="leading-snug text-muted-foreground">{i.texto}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- estados

/**
 * Erro de consulta. Mensagem de "Acesso negado" do servidor vira
 * `EstadoSemAcesso` com a chave (`chaves`), não erro genérico; o resto vira
 * `EstadoErro` com "Tentar de novo".
 */
export function ErroDaConsulta({
  erro,
  chaves,
  tentarNovamente,
  titulo,
}: {
  erro: unknown;
  chaves?: string;
  tentarNovamente?: () => void;
  titulo?: string;
}) {
  const mensagem = erro instanceof Error ? erro.message : String(erro ?? "");
  if (chaves && /acesso negado/i.test(mensagem)) return <EstadoSemAcesso oQueFalta={chaves} />;
  return <EstadoErro titulo={titulo} detalhe={mensagem || undefined} tentarNovamente={tentarNovamente} />;
}

// ---------------------------------------------------------------- página

/**
 * A casca das telas da área: faixa de validação, `PageHeader` com pergunta,
 * universo e procedência, linha de frescor e o conteúdo. Mesmo desenho do
 * `AppShell` (que não aceita pergunta nem procedência e é casca de todo o
 * Brain, por isso não muda).
 */
export function MolduraReceita({
  titulo,
  pergunta,
  descricao,
  procedencia,
  filtros,
  acoes,
  children,
}: {
  /** Rótulo do item do menu. */
  titulo: string;
  pergunta: string;
  /** Universo e régua de data (caixa ou competência). */
  descricao?: ReactNode;
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null; regua?: string };
  filtros?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <ValidationBanner />
      <div className="border-b px-4 pt-6 md:px-6">
        <PageHeader
          titulo={titulo}
          pergunta={pergunta}
          descricao={descricao}
          procedencia={procedencia}
          filtros={filtros}
          acoes={acoes}
          className="border-b-0"
        />
      </div>
      <DataFreshnessBar />
      <div className="flex-1">{children}</div>
    </div>
  );
}
