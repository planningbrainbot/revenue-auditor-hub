import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  type TomStatus,
} from "@/components/planning";
import { cn } from "@/lib/utils";
import { MolduraReceita } from "@/components/receita/moldura";
import { carregarSaidasOmie, type LinhaSaida, type SaidasOmie } from "@/lib/saidas-omie.functions";

// Saídas da Planning Partners: a mesma página do artifact "Saídas Planning Partners" (claude.ai),
// agora lendo `ops.saidas_omie` direto. Foco é o caixa de curto prazo: o que vence em 7, 15 ou 30
// dias e se o saldo em conta cobre. Sem histórico longo de propósito (decisão de 22/10/2026).

const I_PAGO = 0;
const I_VENCER = 1;
const I_HOJE = 2;
const I_ATRASO = 3;
// Pago é cinza: já aconteceu, não deve gritar.
const COR_STATUS = ["bg-muted-foreground", "bg-info", "bg-warning", "bg-danger"];

const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const brl = (n: number) => "R$ " + nf2.format(n);
const brl0 = (n: number) => "R$ " + nf0.format(n);
/** `AAAA-MM-DD` em `dd/mm/aaaa`, sem passar por `Date` (meia-noite UTC vira o dia anterior). */
const dia = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
const DIA_SEM = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const diaCurto = (iso: string) =>
  DIA_SEM[(new Date(iso + "T12:00:00").getDay() + 6) % 7] + " " + dia(iso).slice(0, 5);
const desloca = (iso: string, dias: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const lerReais = (txt: string) => {
  const t = String(txt)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return t === "" || isNaN(+t) ? null : +t;
};

const JANELAS = [7, 15, 30] as const;
type Janela = (typeof JANELAS)[number];
const CHAVE_JANELA = "saidas.janela";
// O saldo do Omie não serve (a conciliação atrasa), então quem informa é a pessoa, olhando o
// banco. Fica só neste navegador e só vale para a leitura do dia em que foi digitado.
const CHAVE_SALDO = "saidas.saldo";

function lerJanela(): Janela {
  try {
    const j = Number(localStorage.getItem(CHAVE_JANELA));
    if ((JANELAS as readonly number[]).includes(j)) return j as Janela;
  } catch {
    /* sem storage, fica em 7 */
  }
  return 7;
}
function lerSaldoGuardado(): { v: number; hoje: string } | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_SALDO) ?? "null");
  } catch {
    return null;
  }
}

export function Saidas() {
  const fn = useServerFn(carregarSaidasOmie);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["saidas-omie"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  return (
    <MolduraReceita
      titulo="Previsibilidade de caixa"
      pergunta="O saldo em conta paga o que vence nos próximos dias?"
      descricao="Títulos a pagar do Omie da Planning Partners (Matriz), pela data de vencimento. Os em aberto entram se vencem entre 30 dias atrás e 30 dias à frente."
      procedencia={
        data
          ? {
              fonte: "Omie da Planning Partners · ListarContasPagar",
              atualizadoEm: data.gravadoEm,
              regua: "vencimento",
            }
          : undefined
      }
    >
      <div className="mx-auto flex max-w-[1140px] flex-col gap-5 p-4 md:p-6">
        {isLoading ? (
          <Carregando variante="pagina" />
        ) : error ? (
          <EstadoErro detalhe={(error as Error).message} tentarNovamente={() => refetch()} />
        ) : !data ? (
          <EstadoVazio
            titulo="As saídas ainda não foram lidas"
            descricao="O tools/saidas_omie.py grava o primeiro retrato em ops.saidas_omie na próxima rodada."
          />
        ) : (
          <Conteudo D={data.payload} />
        )}
      </div>
    </MolduraReceita>
  );
}

interface Titulo {
  id: number;
  venc: string;
  st: number;
  v: number;
  forn: number;
  cats: Set<number>;
}

function Conteudo({ D }: { D: SaidasOmie }) {
  const M = D.meta;
  // Status (atrasado, vence hoje) é relativo ao dia da leitura no Omie, não ao relógio de quem abre.
  const HOJE = M.hoje;
  const retratoVelho = HOJE !== hojeLocal();

  const base = useMemo(() => {
    // Título em aberto só aparece se vence entre 30 dias atrás e 30 dias à frente. Atrasado mais
    // velho é, na prática, título que já saiu e não foi baixado no Omie; o que vence depois de
    // 30 dias ainda não pede ação. Pago fica inteiro. Decisão do usuário, 22/10/2026.
    const ini = desloca(HOJE, -30);
    const fim = desloca(HOJE, 30);
    const rows = D.rows.filter((r) => r[2] === I_PAGO || (r[0] >= ini && r[0] <= fim));

    // Três baldes por dia. ATRASADO sai hoje na projeção: já devia ter saído e continua devendo.
    const pagarDia = new Map<string, number>();
    const pagoDia = new Map<string, number>();
    const atrasoDia = new Map<string, number>();
    let atraso = 0;
    const soma1 = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    for (const r of rows) {
      if (r[2] === I_ATRASO) {
        atraso += r[3];
        soma1(atrasoDia, r[0], r[3]);
      } else if (r[2] === I_PAGO) soma1(pagoDia, r[0], r[3]);
      else soma1(pagarDia, r[0], r[3]);
    }
    return { rows, pagarDia, pagoDia, atrasoDia, atraso, receber: new Map(D.receber ?? []) };
  }, [D, HOJE]);

  /** Títulos que passam no filtro, com as fatias de rateio juntadas de volta. */
  const titulosDe = (filtro: (r: LinhaSaida) => boolean): Titulo[] => {
    const mapa = new Map<number, Titulo>();
    for (const r of base.rows) {
      if (!filtro(r)) continue;
      const t = mapa.get(r[9]);
      if (t) {
        t.v += r[3];
        t.cats.add(r[4]);
        continue;
      }
      mapa.set(r[9], {
        id: r[9],
        venc: r[0],
        st: r[2],
        v: r[3],
        forn: r[5],
        cats: new Set([r[4]]),
      });
    }
    return [...mapa.values()].sort((a, b) => b.v - a.v);
  };

  return (
    <>
      {retratoVelho && (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Esta leitura do Omie é de {dia(HOJE)}. Atrasado, vence hoje e os dias abaixo contam a
          partir dessa data.
        </div>
      )}
      <Semana D={D} HOJE={HOJE} base={base} titulosDe={titulosDe} />
      <Tiles HOJE={HOJE} rows={base.rows} />
      <EmAberto D={D} HOJE={HOJE} rows={base.rows} />
      <Notas />
      <p className="text-xs text-muted-foreground">
        Gerado por tools/saidas_omie.py a partir de ListarContasPagar. {M.rateio_categoria} títulos
        rateados entre categorias entram quebrados, uma linha por fatia. Descartados:{" "}
        {Object.keys(M.descartados).length
          ? Object.entries(M.descartados)
              .map(([k, v]) => v + " " + k)
              .join(", ")
          : "nenhum"}
        . Leitura de {dia(M.hoje)} · {nf0.format(M.titulos)} títulos · vencimentos de {dia(M.de)} a{" "}
        {dia(M.ate)}.
      </p>
    </>
  );
}

// ------------------------------------------------------------------ semana

type Base = {
  rows: LinhaSaida[];
  pagarDia: Map<string, number>;
  pagoDia: Map<string, number>;
  atrasoDia: Map<string, number>;
  atraso: number;
  receber: Map<string, number>;
};

function Semana({
  D,
  HOJE,
  base,
  titulosDe,
}: {
  D: SaidasOmie;
  HOJE: string;
  base: Base;
  titulosDe: (f: (r: LinhaSaida) => boolean) => Titulo[];
}) {
  const { pagarDia, pagoDia, atrasoDia, receber } = base;
  const ATRASO = base.atraso;
  const guardado = useMemo(lerSaldoGuardado, []);
  const [janela, setJanela] = useState<Janela>(lerJanela);
  const [saldo, setSaldo] = useState<number | null>(
    guardado && guardado.hoje === HOJE ? guardado.v : null,
  );
  const [campo, setCampo] = useState(saldo != null ? nf2.format(saldo) : "");
  const [comReceber, setComReceber] = useState(false);
  // O atrasado fica fora da conta por padrão: o bolo encobria os dias.
  const [comAtrasoEstado, setComAtraso] = useState(false);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const N = janela;
  const dias = Array.from({ length: N }, (_, i) => desloca(HOJE, i));
  const fim = dias[N - 1];
  const fimTxt = diaCurto(fim);
  const CX = saldo != null;
  const comAtraso = comAtrasoEstado && ATRASO > 0;

  /** Saldo em conta ao fim de cada dia, de hoje até o fim da janela. */
  const projecao = (somarReceber: boolean) => {
    const out = new Map<string, number>();
    if (saldo == null) return out;
    let s = saldo - (comAtrasoEstado ? ATRASO : 0);
    for (const d of dias) {
      s -= pagarDia.get(d) ?? 0;
      if (somarReceber) s += receber.get(d) ?? 0;
      out.set(d, s);
    }
    return out;
  };
  const proj = projecao(comReceber);
  const projSem = projecao(false);

  const pagarSem = dias.reduce((a, d) => a + (pagarDia.get(d) ?? 0), 0) + (comAtraso ? ATRASO : 0);
  const recSem = dias.reduce((a, d) => a + (receber.get(d) ?? 0), 0);
  const saldoFim = CX ? proj.get(fim)! : null;
  const minimo = CX ? Math.min(...dias.map((d) => proj.get(d)!)) : null;
  const furo = CX ? dias.find((d) => proj.get(d)! < 0) : undefined;
  const furoSem = CX ? dias.find((d) => projSem.get(d)! < 0) : undefined;

  // ------------------------------------------------------------ aviso
  let tom: TomStatus;
  let titulo: string;
  const linhas: string[] = [];
  if (!CX) {
    tom = "neutro";
    titulo = `Informe o saldo em conta para saber se os próximos ${N} dias fecham`;
    linhas.push(
      `Digite no campo acima o saldo que está no banco hoje (${dia(HOJE)}). A pagar até ${fimTxt}: ${brl0(pagarSem)}.` +
        (guardado && guardado.hoje !== HOJE
          ? ` Último saldo informado: ${brl0(guardado.v)} em ${dia(guardado.hoje)}.`
          : ""),
    );
  } else if (furo) {
    tom = "perigo";
    titulo = "Saldo não cobre: falta dinheiro a partir de " + diaCurto(furo);
    linhas.push(`No pior dia faltam ${brl0(-minimo!)} para pagar tudo o que vence até ${fimTxt}.`);
    if (!comReceber && recSem > 0)
      linhas.push(
        `${brl0(recSem)} a receber vencem no período; ligue “Contar recebimentos previstos” para ver se resolvem.`,
      );
  } else if (comReceber && furoSem) {
    tom = "atencao";
    titulo = "Cobre só se os recebimentos previstos entrarem";
    linhas.push(
      `Só com o que está em conta, falta dinheiro a partir de ${diaCurto(furoSem)}. Sobra ${brl0(saldoFim!)} em ${fimTxt} contando os recebimentos.`,
    );
  } else {
    tom = "sucesso";
    titulo = pagarSem
      ? `O saldo em conta cobre os próximos ${N} dias`
      : `Nada a pagar nos próximos ${N} dias`;
    linhas.push(
      `Depois de pagar ${brl0(pagarSem)}, sobram ${brl0(saldoFim!)} em ${fimTxt}` +
        (comReceber ? ", contando os recebimentos previstos." : ", sem contar nada a receber."),
    );
  }
  if (CX && ATRASO && !comAtraso)
    linhas.push(
      `Não entram na conta os ${brl0(ATRASO)} em atraso dos últimos 30 dias (botão “Incluir atrasados”).`,
    );
  const CAIXA_AVISO: Record<TomStatus, string> = {
    sucesso: "border-l-success bg-success-soft",
    atencao: "border-l-warning bg-warning-soft",
    perigo: "border-l-danger bg-danger-soft",
    info: "border-l-info bg-info-soft",
    neutro: "border-l-border bg-muted/50",
  };

  // ------------------------------------------------------------- dias
  const colunas: string[] = [...(comAtraso ? ["atraso"] : []), ...dias];
  const diaAberto =
    diaSel && colunas.includes(diaSel) ? diaSel : (dias.find((d) => pagarDia.get(d)) ?? dias[0]);
  const teto = Math.max(1, ...dias.map((d) => pagarDia.get(d) ?? 0));
  // 7 dias cabem numa linha; 15 e 30 quebram em linhas de 7, como calendário.
  const nCols = N === 7 ? colunas.length : 7;

  const abrir = (d: string) => {
    setDiaSel(d);
    requestAnimationFrame(() =>
      listaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };

  const nTitulos = titulosDe((r) => r[2] !== I_PAGO && dias.includes(r[0])).length;

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">A pagar nos próximos {N} dias</h2>
          <p className="text-sm text-muted-foreground">
            {CX
              ? "Saldo informado, menos cada título no dia em que vence. Clique num dia para ver os títulos."
              : "Clique num dia para ver os títulos."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex overflow-hidden rounded-md border"
            role="group"
            aria-label="Janela"
          >
            {JANELAS.map((j) => (
              <button
                key={j}
                type="button"
                aria-pressed={j === N}
                onClick={() => {
                  setJanela(j);
                  try {
                    localStorage.setItem(CHAVE_JANELA, String(j));
                  } catch {
                    /* vale até fechar */
                  }
                }}
                className={cn(
                  "border-l px-3 py-1.5 text-xs first:border-l-0",
                  j === N
                    ? "bg-foreground font-medium text-background"
                    : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {j} dias
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            Saldo em conta hoje
            <Input
              value={campo}
              inputMode="decimal"
              placeholder="R$ 0,00"
              autoComplete="off"
              className="h-8 w-36 text-right font-mono tabular-nums"
              onChange={(e) => {
                setCampo(e.target.value);
                const v = lerReais(e.target.value);
                setSaldo(v);
                if (v != null) {
                  try {
                    localStorage.setItem(CHAVE_SALDO, JSON.stringify({ v, hoje: HOJE }));
                  } catch {
                    /* sem storage, vale até fechar */
                  }
                }
              }}
              onBlur={() => saldo != null && setCampo(nf2.format(saldo))}
            />
          </label>
          <Button
            variant={comReceber ? "default" : "outline"}
            size="sm"
            aria-pressed={comReceber}
            onClick={() => setComReceber((v) => !v)}
          >
            Contar recebimentos previstos
          </Button>
          {ATRASO > 0 && (
            <Button
              variant={comAtrasoEstado ? "default" : "outline"}
              size="sm"
              aria-pressed={comAtrasoEstado}
              onClick={() => {
                setComAtraso((v) => !v);
                if (comAtrasoEstado && diaSel === "atraso") setDiaSel(null);
              }}
            >
              {comAtrasoEstado ? "Tirar atrasados" : "Incluir atrasados"} ({brl0(ATRASO)})
            </Button>
          )}
        </div>
      </div>

      <div
        role="status"
        className={cn(
          "flex flex-col gap-1 rounded-md border border-l-4 px-4 py-3",
          CAIXA_AVISO[tom],
        )}
      >
        <b className="text-[15px] font-semibold text-foreground">{titulo}</b>
        {linhas.map((l) => (
          <p key={l} className="text-sm text-muted-foreground">
            {l}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Resumo
          k="Saldo em conta hoje"
          v={CX ? brl0(saldo!) : "não informado"}
          s={CX ? "informado por você" : ""}
          neg={CX && saldo! < 0}
        />
        <Resumo
          k={`A pagar em ${N} dias`}
          v={brl0(pagarSem)}
          s={
            comAtraso
              ? `inclui ${brl0(ATRASO)} já em atraso`
              : ATRASO
                ? `fora ${brl0(ATRASO)} em atraso`
                : `${nTitulos} títulos`
          }
        />
        <Resumo
          k={`Saldo previsto em ${fimTxt}`}
          v={CX ? brl0(saldoFim!) : "não informado"}
          s={comReceber ? `com ${brl0(recSem)} a receber` : "sem contar recebimentos"}
          neg={CX && saldoFim! < 0}
        />
      </div>

      <div
        className="grid grid-cols-1 gap-1.5 md:[grid-template-columns:var(--cols)]"
        style={{ "--cols": `repeat(${nCols}, minmax(0, 1fr))` } as CSSProperties}
      >
        {colunas.map((d) => {
          const sel = diaAberto === d;
          const classe = cn(
            "flex min-w-0 flex-col gap-0.5 rounded-md border bg-card p-2.5 text-left hover:border-foreground/30",
            sel && "border-foreground ring-1 ring-foreground",
          );
          if (d === "atraso")
            return (
              <button
                key={d}
                type="button"
                aria-pressed={sel}
                onClick={() => abrir(d)}
                className={cn(classe, "border-t-4 border-t-danger")}
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Em atraso
                </span>
                <span className="truncate text-base font-semibold tabular-nums">
                  {brl0(ATRASO)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {titulosDe((r) => r[2] === I_ATRASO).length} títulos · sai hoje
                </span>
              </button>
            );
          if (d < HOJE) {
            const atr = atrasoDia.get(d) ?? 0;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={sel}
                onClick={() => abrir(d)}
                className={cn(classe, "bg-muted/60 text-muted-foreground")}
              >
                <span className="text-[11px] font-medium uppercase tracking-wide">
                  {diaCurto(d)}
                </span>
                <span className="truncate text-base font-semibold tabular-nums">
                  {brl0(pagoDia.get(d) ?? 0)}
                </span>
                <span className="text-xs">pago{atr ? ` · ${brl0(atr)} atrasou` : ""}</span>
              </button>
            );
          }
          const v = pagarDia.get(d) ?? 0;
          const n = titulosDe((r) => r[0] === d && r[2] !== I_PAGO && r[2] !== I_ATRASO).length;
          const rec = receber.get(d) ?? 0;
          const s = proj.get(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={sel}
              onClick={() => abrir(d)}
              className={classe}
            >
              <span className="flex items-center justify-between gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {diaCurto(d)}
                {d === HOJE && (
                  <span className="rounded-sm bg-foreground px-1.5 text-[10px] text-background">
                    hoje
                  </span>
                )}
              </span>
              <span className="truncate text-base font-semibold tabular-nums">
                {v ? brl0(v) : "—"}
              </span>
              <span className="text-xs text-muted-foreground">
                {n ? `${n} ${n === 1 ? "título" : "títulos"}` : "nada vence"}
              </span>
              <span className="my-1 hidden h-1 rounded-full bg-muted md:block">
                <span
                  className="block h-full rounded-full bg-info"
                  style={{ width: `${(v / teto) * 100}%` }}
                />
              </span>
              {comReceber && rec > 0 && (
                <span className="font-mono text-xs text-success">+ {brl0(rec)} entra</span>
              )}
              {CX && s != null && (
                <span className="mt-auto border-t pt-1.5 text-[10.5px] leading-tight text-muted-foreground">
                  saldo depois
                  <span
                    className={cn(
                      "block font-mono text-xs tabular-nums",
                      s < 0 ? "font-semibold text-danger" : "text-foreground",
                    )}
                  >
                    {brl0(s)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div ref={listaRef} className="scroll-m-4">
        <ListaDia D={D} d={diaAberto} HOJE={HOJE} titulosDe={titulosDe} />
      </div>
    </Card>
  );
}

function Resumo({ k, v, s, neg }: { k: string; v: string; s: string; neg?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {k}
      </span>
      <span className={cn("text-xl font-semibold tabular-nums", neg && "text-danger")}>{v}</span>
      <span className="text-xs text-muted-foreground">{s}</span>
    </div>
  );
}

function Situacao({ D, st }: { D: SaidasOmie; st: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <span className={cn("size-1.5 rounded-full", COR_STATUS[st])} />
      {D.meta.status[st].toLowerCase()}
    </span>
  );
}

const TH =
  "whitespace-nowrap border-b pb-2 pr-3 text-left text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground";
const TD = "border-b py-2 pr-3 align-top";
const NUM = "text-right font-mono tabular-nums whitespace-nowrap";

function ListaDia({
  D,
  d,
  HOJE,
  titulosDe,
}: {
  D: SaidasOmie;
  d: string;
  HOJE: string;
  titulosDe: (f: (r: LinhaSaida) => boolean) => Titulo[];
}) {
  const atraso = d === "atraso";
  const passado = !atraso && d < HOJE;
  // Dia que já passou mostra o que foi pago e o que ficou para trás; atrasado ordena primeiro.
  const lista = atraso
    ? titulosDe((r) => r[2] === I_ATRASO)
    : passado
      ? titulosDe((r) => r[0] === d && (r[2] === I_PAGO || r[2] === I_ATRASO)).sort(
          (a, b) => Number(b.st === I_ATRASO) - Number(a.st === I_ATRASO) || b.v - a.v,
        )
      : titulosDe((r) => r[0] === d && r[2] !== I_PAGO && r[2] !== I_ATRASO);
  const total = lista.reduce((a, t) => a + t.v, 0);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-foreground p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">
          {atraso
            ? "Contas em atraso (vencidas nos últimos 30 dias)"
            : `Contas de ${diaCurto(d)}${d === HOJE ? " (hoje)" : ""}`}
        </h3>
        {lista.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {lista.length} {lista.length === 1 ? "título" : "títulos"} · {brl(total)}
          </p>
        )}
      </div>
      {!lista.length ? (
        <p className="py-1 text-sm text-muted-foreground">
          {passado ? "Nada venceu neste dia." : "Nenhuma conta vence neste dia."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr>
                {atraso && <th className={TH}>Venceu</th>}
                <th className={TH}>Fornecedor</th>
                <th className={TH}>Categoria</th>
                <th className={TH}>Situação</th>
                <th className={cn(TH, "text-right")}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((x) => {
                const cats = [...x.cats];
                return (
                  <tr key={x.id}>
                    {atraso && (
                      <td className={cn(TD, "font-mono text-muted-foreground")}>{dia(x.venc)}</td>
                    )}
                    <td className={TD}>{D.forn[x.forn]}</td>
                    <td className={cn(TD, "text-muted-foreground")}>
                      {cats.length > 1 ? `${cats.length} categorias (rateado)` : D.cats[cats[0]][1]}
                    </td>
                    <td className={TD}>
                      <Situacao D={D} st={x.st} />
                    </td>
                    <td className={cn(TD, NUM)}>{brl(x.v)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="pt-2" colSpan={atraso ? 4 : 3}>
                  Total do dia
                </td>
                <td className={cn("pt-2", NUM)}>{brl(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- tiles

function Tiles({ HOJE, rows }: { HOJE: string; rows: LinhaSaida[] }) {
  const lim30 = desloca(HOJE, 30);
  const atraso = rows.filter((r) => r[2] === I_ATRASO);
  const hoje = rows.filter((r) => r[2] === I_HOJE);
  const prox = rows.filter((r) => r[2] === I_VENCER && r[0] > HOJE && r[0] <= lim30);
  const soma = (a: LinhaSaida[]) => a.reduce((s, r) => s + r[3], 0);
  const titulos = (a: LinhaSaida[]) => new Set(a.map((r) => r[9])).size;
  const maisVelho = atraso.reduce((min, r) => (r[0] < min ? r[0] : min), "9999");
  const diasAtraso = atraso.length
    ? Math.round((new Date(HOJE).getTime() - new Date(maisVelho).getTime()) / 864e5)
    : 0;

  return (
    <KpiGrade colunas={3}>
      <KpiCard
        rotulo="Atrasado"
        valor={brl0(soma(atraso))}
        tom={atraso.length ? "perigo" : undefined}
        nota={`${titulos(atraso)} títulos · mais antigo há ${diasAtraso} dias`}
      />
      <KpiCard
        rotulo="Vence hoje"
        valor={brl0(soma(hoje))}
        tom={hoje.length ? "atencao" : undefined}
        nota={`${titulos(hoje)} títulos · ${dia(HOJE)}`}
      />
      <KpiCard
        rotulo="Próximos 30 dias"
        valor={brl0(soma(prox))}
        tom="info"
        nota={`${titulos(prox)} títulos · até ${dia(lim30)}`}
      />
    </KpiGrade>
  );
}

// --------------------------------------------------------------- em aberto

function EmAberto({ D, HOJE, rows }: { D: SaidasOmie; HOJE: string; rows: LinhaSaida[] }) {
  const [depto, setDepto] = useState("todos");
  const lim30 = desloca(HOJE, 30);
  const dep = depto === "todos" ? null : D.deptos.indexOf(depto);
  const linhas = rows
    .filter((r) => r[2] !== I_PAGO && r[0] <= lim30)
    .filter((r) => dep === null || r[6] === dep)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : b[3] - a[3]));
  const soma = linhas.reduce((a, r) => a + r[3], 0);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Em aberto</h2>
          <p className="text-sm text-muted-foreground">
            {linhas.length
              ? `${linhas.length} títulos somando ${brl0(soma)}: vencidos nos últimos 30 dias, vencendo hoje e com vencimento até ${dia(lim30)}`
              : "Nada vencido nem a vencer nos próximos 30 dias neste recorte."}
          </p>
        </div>
        <select
          aria-label="Departamento"
          value={depto}
          onChange={(e) => setDepto(e.target.value)}
          className="h-8 max-w-[230px] rounded-md border border-input bg-card px-2 text-xs"
        >
          <option value="todos">Todos os departamentos</option>
          {[...D.deptos].sort().map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Vence</th>
              <th className={TH}>Situação</th>
              <th className={TH}>Fornecedor</th>
              <th className={TH}>Categoria</th>
              <th className={TH}>Departamento</th>
              <th className={cn(TH, "text-right")}>Valor</th>
              <th className={cn(TH, "text-right")}>Título</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((r, i) => (
              <tr key={`${r[9]}-${r[4]}-${r[6]}-${i}`}>
                <td className={cn(TD, "font-mono text-muted-foreground")}>{dia(r[0])}</td>
                <td className={TD}>
                  <Situacao D={D} st={r[2]} />
                </td>
                <td className={TD}>{D.forn[r[5]]}</td>
                <td className={TD}>
                  {D.cats[r[4]][1]}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {D.cats[r[4]][0]}
                  </span>
                </td>
                <td className={cn(TD, "text-muted-foreground")}>{D.deptos[r[6]]}</td>
                <td className={cn(TD, NUM)}>{brl(r[3])}</td>
                <td className={cn(TD, NUM, "text-muted-foreground")}>{r[9]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------- notas

const NOTAS: [string, ReactNode][] = [
  [
    "De onde vem o saldo",
    "De quem abre a página: o saldo do Omie não é usado porque a conciliação nunca está em dia. O valor digitado fica guardado só neste navegador e vale para a leitura do dia. A projeção tira cada título em aberto no dia em que vence, e os atrasados saem hoje. Recebimentos só entram se a opção estiver ligada, e só os que ainda não venceram.",
  ],
  [
    "Não é caixa",
    "O Omie não guarda data de baixa no título a pagar. “Pago” diz que saiu, não diz em que dia. Desembolso por data é o extrato de conta corrente, na aba Entradas e saídas do BI Financeiro.",
  ],
  [
    "Só o que já foi lançado",
    "A projeção traz os títulos que já estão no Omie. Conta que ainda vai ser lançada não aparece, então os dias mais distantes sempre parecem mais leves do que serão.",
  ],
  [
    "Só a Matriz",
    "Conta Planning Partners. Cada unidade tem plano de contas próprio, onde o mesmo código significa outra coisa; consolidar a rede exige um de-para que ainda não existe.",
  ],
];

function Notas() {
  return (
    <Card className="flex flex-col gap-2 p-4 md:p-5">
      <h2 className="text-base font-semibold text-foreground">O que este painel não mede</h2>
      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        {NOTAS.map(([h, p]) => (
          <div key={h} className="border-t py-3">
            <h3 className="text-[13px] font-semibold">{h}</h3>
            <p className="text-[13px] text-muted-foreground">{p}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
