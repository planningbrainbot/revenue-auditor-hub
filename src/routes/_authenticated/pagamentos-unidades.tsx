import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Carregando, EstadoErro, EstadoVazio, PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/pagamentos-unidades")({
  head: () => ({ meta: [{ title: "Títulos por vencimento · Planning Brain" }] }),
  component: PagamentosUnidadesPage,
});

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PfRow = {
  id: number;
  unidade: string | null;
  razao_social: string | null;
  codigo_categoria: string | null;
  data_vencimento: string | null;
  valor_documento: number;
  status_titulo: string;
};

async function fetchAll(ano: string): Promise<PfRow[]> {
  const all: PfRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  const start = `${ano}-01-01`;
  const end = `${ano}-12-31`;
  while (true) {
    const { data, error } = await supabase
      .from("partners_financeiro")
      .select("id,unidade,razao_social,codigo_categoria,data_vencimento,valor_documento,status_titulo")
      .eq("tipo", "RECEBER")
      .neq("status_titulo", "CANCELADO")
      .gte("data_vencimento", start)
      .lte("data_vencimento", end)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows: PfRow[] = (data ?? []).map((r: any) => ({
      id: r.id,
      unidade: r.unidade ?? null,
      razao_social: r.razao_social ?? null,
      codigo_categoria: r.codigo_categoria ?? null,
      data_vencimento: r.data_vencimento ?? null,
      valor_documento: Number(r.valor_documento ?? 0),
      status_titulo: r.status_titulo ?? "",
    }));
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

type MonthMap = Record<number, number>;

type CatPivot = {
  descricao: string;
  monthly: MonthMap;
  total: number;
};

type UnidadePivot = {
  nomeDisplay: string;
  razaoSocial: string;
  monthly: MonthMap;
  total: number;
  cats: CatPivot[];
};

// "Pagamentos" era o nome, mas a tela soma títulos a receber pelo mês de
// vencimento, pagos ou não: o título diz isso (contrato de 24/09/2026).
function PagamentosUnidadesPage() {
  const anoAtual = String(new Date().getFullYear());
  const [ano, setAno] = useState(anoAtual);
  const [unidadeFilter, setUnidadeFilter] = useState<string>("__all__");

  const [rows, setRows] = useState<PfRow[]>([]);
  const [categoriasMap, setCategoriasMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchAll(ano),
      supabase.from("categorias_omie").select("codigo,descricao").then(({ data }) => data ?? []),
    ])
      .then(([pfRows, cats]) => {
        setRows(pfRows);
        setCategoriasMap(
          new Map((cats as any[]).map((c) => [c.codigo as string, c.descricao as string])),
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ano, tentativa]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filtered = useMemo(() => {
    if (unidadeFilter === "__all__") return rows;
    return rows.filter((r) => (r.unidade ?? r.razao_social ?? "—") === unidadeFilter);
  }, [rows, unidadeFilter]);

  const { pivot, months } = useMemo(() => {
    const unitMap = new Map<string, UnidadePivot>();
    const monthsSet = new Set<number>();

    for (const r of filtered) {
      const rs = r.razao_social ?? "—";
      const display = r.unidade ?? rs;
      const v = r.valor_documento;
      const month = r.data_vencimento ? parseInt(r.data_vencimento.slice(5, 7)) : null;
      if (!month) continue;
      monthsSet.add(month);

      let u = unitMap.get(display);
      if (!u) {
        u = { nomeDisplay: display, razaoSocial: rs, monthly: {}, total: 0, cats: [] };
        unitMap.set(display, u);
      }
      u.monthly[month] = (u.monthly[month] ?? 0) + v;
      u.total += v;

      const cat = r.codigo_categoria ?? "";
      const descricao = categoriasMap.get(cat) ?? (cat || "Sem categoria");
      let c = u.cats.find((x) => x.descricao === descricao);
      if (!c) {
        c = { descricao, monthly: {}, total: 0 };
        u.cats.push(c);
      }
      c.monthly[month] = (c.monthly[month] ?? 0) + v;
      c.total += v;
    }

    const sortedMonths = Array.from(monthsSet).sort((a, b) => a - b);
    const sortedUnits = Array.from(unitMap.values())
      .sort((a, b) => b.total - a.total)
      .map((u) => ({ ...u, cats: u.cats.sort((a, b) => b.total - a.total) }));

    return { pivot: sortedUnits, months: sortedMonths };
  }, [filtered, categoriasMap]);

  const grandTotal = useMemo(() => {
    const monthly: MonthMap = {};
    let total = 0;
    for (const u of pivot) {
      for (const [m, v] of Object.entries(u.monthly)) {
        monthly[Number(m)] = (monthly[Number(m)] ?? 0) + v;
        total += v;
      }
    }
    return { monthly, total };
  }, [pivot]);

  const unidadeOpcoes = useMemo(
    () =>
      Array.from(new Set(rows.map((r: PfRow) => r.unidade ?? r.razao_social ?? "—"))).sort(),
    [rows],
  );

  const anos = Array.from({ length: 4 }, (_, i) => String(Number(anoAtual) - 1 + i));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Títulos por vencimento"
        pergunta="Quanto cada unidade tem em títulos a receber, mês a mês pelo vencimento?"
        descricao={`Títulos a receber da Partners no Omie, pagos ou não, somados pelo mês de vencimento · ${ano} · valor do documento, sem cancelados. Tela fora do menu desde 14/09/2026; continua aberta por link direto.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={ano} onValueChange={setAno}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anos.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as unidades</SelectItem>
            {unidadeOpcoes.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!loading && pivot.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {pivot.length} unidades · Total: <strong>{BRL(grandTotal.total)}</strong>
          </span>
        )}
      </div>

      {error ? (
        <EstadoErro
          titulo="Não foi possível carregar os títulos"
          detalhe={error}
          tentarNovamente={() => setTentativa((n) => n + 1)}
        />
      ) : loading ? (
        <Carregando variante="tabela" />
      ) : pivot.length === 0 ? (
        <EstadoVazio
          titulo={`Nenhum título a receber com vencimento em ${ano}`}
          total={unidadeFilter !== "__all__" ? rows.length : undefined}
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[280px] font-semibold sticky left-0 bg-muted/50">
                  Projeto / Categoria
                </TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right font-semibold min-w-[120px]">
                    {MONTH_NAMES[m - 1]}
                  </TableHead>
                ))}
                <TableHead className="text-right font-semibold min-w-[130px]">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.map((u) => {
                const isOpen = expanded.has(u.nomeDisplay);
                return (
                  <React.Fragment key={u.nomeDisplay}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40 bg-muted/20"
                      onClick={() => toggle(u.nomeDisplay)}
                    >
                      <TableCell className="py-2 font-semibold sticky left-0 bg-muted/20">
                        <div className="flex items-center gap-2">
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          {u.nomeDisplay}
                        </div>
                      </TableCell>
                      {months.map((m) => (
                        <TableCell key={m} className="text-right tabular-nums py-2 font-semibold">
                          {u.monthly[m] ? BRL(u.monthly[m]) : ""}
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular-nums py-2 font-bold">
                        {BRL(u.total)}
                      </TableCell>
                    </TableRow>

                    {isOpen &&
                      u.cats.map((c) => (
                        <TableRow
                          key={`${u.nomeDisplay}|${c.descricao}`}
                          className="hover:bg-muted/10"
                        >
                          <TableCell className="py-1.5 pl-10 text-sm sticky left-0 bg-background">
                            {c.descricao}
                          </TableCell>
                          {months.map((m) => (
                            <TableCell
                              key={m}
                              className="text-right tabular-nums py-1.5 text-sm"
                            >
                              {c.monthly[m] ? BRL(c.monthly[m]) : ""}
                            </TableCell>
                          ))}
                          <TableCell className="text-right tabular-nums py-1.5 text-sm font-medium">
                            {BRL(c.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })}
            </TableBody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-bold">
                <td className="py-2.5 px-4 text-sm sticky left-0 bg-muted/40">Total</td>
                {months.map((m) => (
                  <td key={m} className="py-2.5 px-4 text-right tabular-nums text-sm">
                    {grandTotal.monthly[m] ? BRL(grandTotal.monthly[m]) : ""}
                  </td>
                ))}
                <td className="py-2.5 px-4 text-right tabular-nums text-sm">
                  {BRL(grandTotal.total)}
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}
    </div>
  );
}
