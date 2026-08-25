import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const NA = "—";

/** Linha devolvida por public.indicadores_trimestre(date, date). */
type Row = {
  unidade_id: number;
  unidade: string;
  data_inauguracao: string | null;
  meses_apurados: number;
  tem_omie: boolean;
  fat_base_nova: number | null;
  fat_total: number | null;
  clientes_base_nova: number;
  inad_a_cobrar: number | null;
  inad_aberto: number | null;
  inad_pct: number | null;
  roy_csc: number | null;
  take_rate_pct: number | null;
  midia: number | null;
  novos_contratos: number;
  mrr_vendido: number | null;
  ticket_medio: number | null;
  receita_anualizada: number | null;
  receita_bookada_ltv: number | null;
  roas: number | null;
  churn_pipefy_n: number;
  churn_pipefy_mrr: number | null;
  churn_faturamento_n: number;
  churn_faturamento_mrr: number | null;
  estoque_aberto: number | null;
  estoque_mais_1ano: number | null;
};

const fmtBRL = (v: number | null | undefined, casas = 0) =>
  v === null || v === undefined
    ? NA
    : v.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: casas,
      });

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const fmtX = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;

const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? NA : v.toLocaleString("pt-BR");

/** Trimestres civis disponíveis, do mais recente pro mais antigo. */
function trimestresDisponiveis(): { key: string; label: string; ini: string; fim: string }[] {
  const out: { key: string; label: string; ini: string; fim: string }[] = [];
  const hoje = new Date();
  let ano = hoje.getFullYear();
  let q = Math.floor(hoje.getMonth() / 3) + 1;
  for (let i = 0; i < 8; i += 1) {
    const mesIni = (q - 1) * 3;
    const ini = new Date(Date.UTC(ano, mesIni, 1));
    const fim = new Date(Date.UTC(ano, mesIni + 3, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    out.push({
      key: `${ano}-Q${q}`,
      label: `Q${q}/${ano} · ${["jan–mar", "abr–jun", "jul–set", "out–dez"][q - 1]}`,
      ini: iso(ini),
      fim: iso(fim),
    });
    q -= 1;
    if (q === 0) {
      q = 4;
      ano -= 1;
    }
  }
  return out;
}

/**
 * Maturação da safra de inadimplência. O indicador só estabiliza ~60 dias depois do
 * vencimento — antes disso ele mede fatura recente, não perda (DATA-RULES 25/08/2026).
 */
function maturacao(fim: string): { madura: boolean; dias: number } {
  const dias = Math.floor((Date.now() - new Date(`${fim}T00:00:00Z`).getTime()) / 86400000);
  return { madura: dias >= 60, dias };
}

function CardKPI({
  label,
  valor,
  hint,
  alerta,
}: {
  label: string;
  valor: string;
  hint?: string;
  alerta?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {alerta ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={alerta} />
        ) : null}
      </div>
      <p className={cn("mt-2 text-2xl font-bold", valor === NA && "text-muted-foreground")}>
        {valor}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {alerta ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">{alerta}</p> : null}
    </Card>
  );
}

export function IndicadoresTrimestreView() {
  const trimestres = useMemo(trimestresDisponiveis, []);
  // Default: trimestre anterior ao corrente — o último com apuração fechada e safra madura.
  const [periodo, setPeriodo] = useState(trimestres[1] ?? trimestres[0]);
  const [rows, setRows] = useState<Row[]>([]);
  const [unidadeSel, setUnidadeSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // A página é usada para apresentar os números PARA a unidade, na reunião trimestral.
  // Por isso o comparativo da rede nasce fechado e é opt-in: ninguém abre a tela na frente
  // de um franqueado e mostra, sem querer, o resultado dos outros. Mesma lógica da decisão
  // de 11/08/2026 em /rede-overview (dados agregados de rede ficam fechados por padrão).
  const [mostrarRede, setMostrarRede] = useState(false);
  const { can, loading: permLoading } = usePermissions();
  const podeVerRede = can("view.network.benchmarks");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErro(null);
    (async () => {
      const { data, error } = await supabase.rpc("indicadores_trimestre", {
        _ini: periodo.ini,
        _fim: periodo.fim,
      });
      if (!alive) return;
      if (error) {
        setErro(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as Row[]);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [periodo]);

  const selecionada = useMemo(
    () => rows.find((r) => r.unidade === unidadeSel) ?? rows[0] ?? null,
    [rows, unidadeSel],
  );

  const mat = maturacao(periodo.fim);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (erro) {
    return (
      <Card className="border-destructive/40 p-6">
        <p className="text-sm font-medium text-destructive">
          Não foi possível carregar os indicadores.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
      </Card>
    );
  }

  if (!rows.length) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium">Sem dados para este período.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Se você acabou de ganhar acesso, confira se a permissão{" "}
          <code className="rounded bg-muted px-1">view.indicadores_trimestre</code> está liberada
          para o seu perfil em Administração › Permissões.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* seletores */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={periodo.key}
          onChange={(e) => setPeriodo(trimestres.find((t) => t.key === e.target.value) ?? periodo)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {trimestres.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {rows.map((r) => (
            <button
              key={r.unidade_id}
              type="button"
              onClick={() => setUnidadeSel(r.unidade)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                selecionada?.unidade === r.unidade
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.unidade}
            </button>
          ))}
        </div>
      </div>

      {!mat.madura ? (
        <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-medium">Trimestre ainda não maturou.</p>
            <p className="text-muted-foreground">
              Fechou há {mat.dias} dias. A inadimplência só estabiliza cerca de 60 dias depois do
              vencimento — até lá ela mede fatura recente, não perda, e sai superestimada.
            </p>
          </div>
        </Card>
      ) : null}

      {selecionada ? <DetalheUnidade row={selecionada} /> : null}

      {/* Comparativo da rede — fechado por padrão. Ver comentário em `mostrarRede`. */}
      {permLoading || !podeVerRede ? null : (
        <div>
          <button
            type="button"
            onClick={() => setMostrarRede((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={mostrarRede}
          >
            {mostrarRede ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Comparativo da rede
          </button>
          {!mostrarRede ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Fechado por padrão — esta tela é usada para apresentar os números para a própria
              unidade.
            </p>
          ) : null}
        </div>
      )}

      {permLoading || !podeVerRede || !mostrarRede ? null : (
        <div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Faturamento base nova</TableHead>
                  <TableHead className="text-right">Inadimplência</TableHead>
                  <TableHead className="text-right">Royalties + CSC</TableHead>
                  <TableHead className="text-right">Take rate</TableHead>
                  <TableHead className="text-right">Novos</TableHead>
                  <TableHead className="text-right">MRR vendido</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Churn (clientes)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const rampa = r.meses_apurados < 3;
                  return (
                    <TableRow
                      key={r.unidade_id}
                      className={cn(
                        "cursor-pointer",
                        selecionada?.unidade === r.unidade && "bg-muted/50",
                      )}
                      onClick={() => setUnidadeSel(r.unidade)}
                    >
                      <TableCell className="font-medium">
                        {r.unidade}
                        {rampa ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {r.meses_apurados}/3 meses
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.tem_omie ? (
                          fmtBRL(r.fat_base_nova)
                        ) : (
                          <span className="text-muted-foreground">sem Omie</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPct(r.inad_pct)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(r.roy_csc)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rampa && r.take_rate_pct !== null ? (
                          <span
                            className="text-muted-foreground"
                            title="Unidade em rampa: CSC fixo domina o cálculo"
                          >
                            {fmtPct(r.take_rate_pct)}*
                          </span>
                        ) : (
                          fmtPct(r.take_rate_pct)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(r.novos_contratos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtBRL(r.mrr_vendido)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtBRL(r.ticket_medio)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtX(r.roas)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.tem_omie ? (
                          <span
                            className={cn(
                              r.churn_faturamento_n > r.churn_pipefy_n &&
                                "text-amber-600 dark:text-amber-500",
                            )}
                          >
                            {fmtNum(r.churn_faturamento_n)}
                          </span>
                        ) : (
                          fmtNum(r.churn_pipefy_n)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            * Take rate de unidade em rampa não é comparável — o CSC fixo domina uma base ainda
            pequena.
          </p>
        </div>
      )}
    </div>
  );
}

function DetalheUnidade({ row: r }: { row: Row }) {
  const gapChurn = r.tem_omie && r.churn_faturamento_n > r.churn_pipefy_n;
  const rampa = r.meses_apurados < 3;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {r.unidade} · Indicadores financeiros
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <CardKPI
            label="Faturamento base nova"
            valor={r.tem_omie ? fmtBRL(r.fat_base_nova) : NA}
            hint={
              r.tem_omie
                ? `${fmtNum(r.clientes_base_nova)} clientes · total da unidade ${fmtBRL(r.fat_total)}`
                : undefined
            }
            alerta={
              r.tem_omie
                ? undefined
                : "Unidade sem títulos no Omie — não é zero, é ausência de fonte."
            }
          />
          <CardKPI
            label="Inadimplência"
            valor={fmtPct(r.inad_pct)}
            hint={
              r.inad_a_cobrar
                ? `${fmtBRL(r.inad_aberto)} em aberto de ${fmtBRL(r.inad_a_cobrar)} a cobrar`
                : undefined
            }
          />
          <CardKPI
            label="Royalties + CSC"
            valor={fmtBRL(r.roy_csc)}
            hint={r.midia ? `Tráfego pago à parte: ${fmtBRL(r.midia)}` : undefined}
          />
          <CardKPI
            label="Take rate da franquia"
            valor={fmtPct(r.take_rate_pct)}
            alerta={
              rampa && r.take_rate_pct !== null
                ? "Unidade em rampa: CSC fixo distorce o percentual."
                : undefined
            }
          />
          <CardKPI
            label="Receita anualizada"
            valor={fmtBRL(r.receita_anualizada)}
            hint="MRR vendido no trimestre × 12"
          />
          <CardKPI
            label="Receita bookada (LTV)"
            valor={fmtBRL(r.receita_bookada_ltv)}
            hint="MRR vendido × 60 meses"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {r.unidade} · Performance comercial
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <CardKPI label="Novos contratos" valor={fmtNum(r.novos_contratos)} />
          <CardKPI label="Ticket médio mensal" valor={fmtBRL(r.ticket_medio)} />
          <CardKPI
            label="Receita recorrente"
            valor={fmtBRL(r.mrr_vendido)}
            hint="MRR vendido no trimestre"
          />
          <CardKPI
            label="ROAS"
            valor={fmtX(r.roas)}
            hint={r.midia ? `Valor 12m ÷ ${fmtBRL(r.midia)} de mídia` : undefined}
            alerta={
              r.roas === null ? "Sem investimento de mídia registrado no período." : undefined
            }
          />
          <CardKPI
            label="Churn de clientes"
            valor={fmtNum(r.tem_omie ? r.churn_faturamento_n : r.churn_pipefy_n)}
            hint={r.tem_omie ? "Última fatura caiu no trimestre" : "Cards do pipe de Tratativas"}
          />
          <CardKPI
            label="Churn de receita"
            valor={fmtBRL(r.tem_omie ? r.churn_faturamento_mrr : r.churn_pipefy_mrr)}
            hint="MRR perdido no trimestre"
          />
        </div>
      </div>

      {gapChurn ? (
        <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-medium">
              O pipe de Tratativas registra menos churn do que o faturamento mostra.
            </p>
            <p className="text-muted-foreground">
              {fmtNum(r.churn_pipefy_n)} card(s) no Pipefy ({fmtBRL(r.churn_pipefy_mrr)}) contra{" "}
              {fmtNum(r.churn_faturamento_n)} cliente(s) cuja última fatura caiu no trimestre (
              {fmtBRL(r.churn_faturamento_mrr)}). Os cards em falta nunca foram lançados — os
              números acima usam o faturamento, que é a fonte mais completa.
            </p>
          </div>
        </Card>
      ) : null}

      {r.tem_omie && (r.estoque_aberto ?? 0) > 0 ? (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">Estoque de contas a receber em aberto (foto de hoje)</p>
              <p className="text-muted-foreground">
                {fmtBRL(r.estoque_aberto)} no total, dos quais{" "}
                <strong className="text-foreground">{fmtBRL(r.estoque_mais_1ano)}</strong> estão
                vencidos há mais de um ano
                {r.estoque_aberto
                  ? ` (${Math.round((100 * (r.estoque_mais_1ano ?? 0)) / r.estoque_aberto)}%)`
                  : ""}
                . Esse saldo é independente do trimestre e não entra no card de inadimplência acima.
              </p>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
