import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Linha de public.idu_ranking(date, date). */
type RankRow = {
  posicao: number;
  unidade_id: number;
  unidade: string;
  curva: string;
  soma_pontos: number | null;
  base_efetiva: number | null;
  idu: number | null;
  faixa: string;
  liberado_pct: number | null;
  falta_corte: number | null;
  pilar_fraco: string | null;
};

/** Linha de public.idu_apuracao(date, date). */
type DetRow = {
  unidade_id: number;
  unidade: string;
  curva: string;
  trimestres: number;
  indicador: string;
  rotulo: string;
  pilar: string;
  peso: number;
  direcao: string;
  unidade_medida: string;
  meta: number | null;
  realizado: number | null;
  atingimento: number | null;
  ajuste: string;
  pontos: number | null;
};

const FAIXA_ESTILO: Record<string, string> = {
  Crítico: "bg-destructive/10 text-destructive border-destructive/30",
  Abaixo: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
  "Na meta": "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  Superação: "bg-sky-500/10 text-sky-600 border-sky-500/30 dark:text-sky-400",
  "sem base": "bg-muted text-muted-foreground border-border",
};

/** Trimestres com fim EXCLUSIVO — é o que idu_apuracao espera. */
function trimestres() {
  const out: { key: string; label: string; ini: string; fim: string }[] = [];
  const hoje = new Date();
  let ano = hoje.getFullYear();
  let q = Math.floor(hoje.getMonth() / 3) + 1;
  for (let i = 0; i < 8; i += 1) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    out.push({
      key: `${ano}-Q${q}`,
      label: `Q${q}/${ano} · ${["jan–mar", "abr–jun", "jul–set", "out–dez"][q - 1]}`,
      ini: iso(new Date(Date.UTC(ano, (q - 1) * 3, 1))),
      fim: iso(new Date(Date.UTC(ano, q * 3, 1))),
    });
    q -= 1;
    if (q === 0) {
      q = 4;
      ano -= 1;
    }
  }
  return out;
}

const fmtNum = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined
    ? NA
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtValor(v: number | null, medida: string) {
  if (v === null || v === undefined) return NA;
  if (medida === "R$/mês")
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  if (medida === "%") return `${fmtNum(v, 1)}%`;
  return fmtNum(v, 0);
}

export function IduView() {
  const periodos = useMemo(trimestres, []);
  // Default: trimestre anterior ao corrente — o último fechado.
  const [periodo, setPeriodo] = useState(periodos[1] ?? periodos[0]);
  const [rank, setRank] = useState<RankRow[]>([]);
  const [det, setDet] = useState<DetRow[]>([]);
  const [aberta, setAberta] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  const { can, loading: permLoading } = usePermissions();
  const podeEditarMetas = can("edit.idu_metas");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const args = { p_inicio: periodo.ini, p_fim: periodo.fim };
    const [r, d] = await Promise.all([
      supabase.rpc("idu_ranking", args),
      supabase.rpc("idu_apuracao", args),
    ]);
    if (r.error || d.error) {
      setErro(r.error?.message ?? d.error?.message ?? "erro desconhecido");
      setRank([]);
      setDet([]);
    } else {
      setRank((r.data ?? []) as RankRow[]);
      setDet((d.data ?? []) as DetRow[]);
    }
    setLoading(false);
  }, [periodo]);

  useEffect(() => {
    if (!permLoading) void carregar();
  }, [carregar, permLoading]);

  async function salvarMeta(unidadeId: number, indicador: string, valor: string) {
    const meta = Number(valor.replace(",", "."));
    if (!Number.isFinite(meta)) return;
    const { error } = await supabase.from("idu_metas").upsert(
      {
        unidade_id: unidadeId,
        periodo_inicio: periodo.ini,
        periodo_fim: periodo.fim,
        indicador,
        meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "unidade_id,periodo_inicio,indicador" },
    );
    setEditando(null);
    if (error) setErro(error.message);
    else await carregar();
  }

  if (permLoading || loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (erro) {
    return (
      <Card className="border-destructive/40 p-6">
        <p className="text-sm font-medium text-destructive">Não foi possível carregar o IDU.</p>
        <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
      </Card>
    );
  }

  if (!rank.length) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium">Sem apuração para este trimestre.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Se você acabou de ganhar acesso, confira se a permissão{" "}
          <code className="rounded bg-muted px-1">view.idu</code> está liberada para o seu perfil em
          Administração › Permissões.
        </p>
      </Card>
    );
  }

  const semMeta = det.filter((d) => d.meta === null).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={periodo.key}
          onChange={(e) => setPeriodo(periodos.find((p) => p.key === e.target.value) ?? periodo)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {periodos.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {semMeta > 0 && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
            {semMeta} indicador{semMeta > 1 ? "es" : ""} sem meta — fora do denominador
          </Badge>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Trophy className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Ranking da rede</h2>
          <span className="text-xs text-muted-foreground">
            a nota mede quanto do combinado foi entregue, não o tamanho da unidade
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Curva</TableHead>
                <TableHead className="text-right">IDU</TableHead>
                <TableHead>Faixa</TableHead>
                <TableHead className="text-right">Libera</TableHead>
                <TableHead className="text-right">Falta p/ 75</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead>Pilar mais fraco</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rank.map((r) => {
                const aberto = aberta === r.unidade_id;
                const linhas = det.filter((d) => d.unidade_id === r.unidade_id);
                return [
                  <TableRow
                    key={r.unidade_id}
                    className="cursor-pointer"
                    onClick={() => setAberta(aberto ? null : r.unidade_id)}
                  >
                    <TableCell>
                      {aberto ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.posicao}
                    </TableCell>
                    <TableCell className="font-medium">{r.unidade}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.curva}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtNum(r.idu)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs", FAIXA_ESTILO[r.faixa])}>
                        {r.faixa}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.liberado_pct === null ? NA : `${fmtNum(r.liberado_pct, 0)}%`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.falta_corte === null || r.falta_corte === 0 ? "cruzou" : fmtNum(r.falta_corte)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.base_efetiva ?? NA}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.pilar_fraco ?? NA}
                    </TableCell>
                  </TableRow>,
                  aberto && (
                    <TableRow key={`${r.unidade_id}-det`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={10} className="p-0">
                        <div className="overflow-x-auto p-4">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Indicador</TableHead>
                                <TableHead>Pilar</TableHead>
                                <TableHead className="text-right">Peso</TableHead>
                                <TableHead className="text-right">Meta</TableHead>
                                <TableHead className="text-right">Realizado</TableHead>
                                <TableHead className="text-right">Ating.</TableHead>
                                <TableHead className="text-right">Pontos</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {linhas.map((l) => {
                                const chave = `${l.unidade_id}:${l.indicador}`;
                                return (
                                  <TableRow key={chave}>
                                    <TableCell className="font-medium">{l.rotulo}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {l.pilar}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{l.peso}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {editando === chave ? (
                                        <div className="flex items-center justify-end gap-1">
                                          <Input
                                            autoFocus
                                            value={rascunho}
                                            onChange={(e) => setRascunho(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter")
                                                void salvarMeta(l.unidade_id, l.indicador, rascunho);
                                              if (e.key === "Escape") setEditando(null);
                                            }}
                                            className="h-7 w-24 text-right"
                                          />
                                          <Button
                                            size="sm"
                                            className="h-7"
                                            onClick={() =>
                                              void salvarMeta(l.unidade_id, l.indicador, rascunho)
                                            }
                                          >
                                            ok
                                          </Button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={!podeEditarMetas}
                                          onClick={() => {
                                            setEditando(chave);
                                            setRascunho(l.meta === null ? "" : String(l.meta));
                                          }}
                                          className={cn(
                                            "inline-flex items-center gap-1",
                                            podeEditarMetas && "hover:underline",
                                            l.meta === null && "text-amber-600 dark:text-amber-400",
                                          )}
                                        >
                                          {l.meta === null
                                            ? "definir meta"
                                            : fmtValor(l.meta, l.unidade_medida)}
                                          {podeEditarMetas && <Pencil className="h-3 w-3 opacity-50" />}
                                        </button>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {fmtValor(l.realizado, l.unidade_medida)}
                                    </TableCell>
                                    <TableCell
                                      className={cn(
                                        "text-right tabular-nums",
                                        l.ajuste === "piso" && "text-destructive",
                                        l.ajuste === "teto" && "text-sky-600 dark:text-sky-400",
                                        l.ajuste === "sem dado" && "text-muted-foreground",
                                      )}
                                    >
                                      {l.atingimento === null
                                        ? l.meta === null
                                          ? "sem meta"
                                          : "sem dado"
                                        : `${fmtNum(l.atingimento, 0)}%${
                                            l.ajuste === "piso"
                                              ? " ↓piso"
                                              : l.ajuste === "teto"
                                                ? " ↑teto"
                                                : ""
                                          }`}
                                    </TableCell>
                                    <TableCell className="text-right font-medium tabular-nums">
                                      {l.pontos === null ? NA : fmtNum(l.pontos, 1)}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              <TableRow className="bg-muted/50">
                                <TableCell colSpan={6} className="font-medium">
                                  Soma sobre base efetiva de {r.base_efetiva ?? 0} pontos
                                </TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">
                                  {fmtNum(r.soma_pontos)}
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Piso de 50% zera o indicador · teto de 120% · nota limitada a 100 · abaixo de 75 a nota é o
        próprio percentual liberado, de 75 a 89 libera 100%, de 90 a 100 libera até 120%. Indicador
        sem meta pactuada ou sem dado sai do denominador. Churn é o que está lançado no pipe de
        Tratativas.
      </p>
    </div>
  );
}
