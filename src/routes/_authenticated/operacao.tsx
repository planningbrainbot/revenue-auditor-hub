import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { usePermissions, unitMatches } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/operacao")({
  // Página desativada: sem link no menu e acesso direto redireciona.
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: OperacaoPage,
});

type Empresa = {
  pipefy_record_id: string | null;
  titulo: string | null;
  cnpj: string | null;
  unidade: string | null;
  erp: string | null;
  segmento: string | null;
};

type Contrato = {
  cnpj: string | null;
  ganho_em: string | null;
  status_contrato: string | null;
};

type ClienteAtivo = {
  pipefy_record_id: string;
  titulo: string;
  unidade: string;
  erp: string;
  segmento: string;
  inicio: Date | null;
};

const NA = "—";

function norm(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s.length ? s : NA;
}

function tempoOperacao(inicio: Date | null): string {
  if (!inicio) return NA;
  const now = new Date();
  if (inicio > now) {
    return `inicia ${inicio.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}`;
  }
  const months =
    (now.getFullYear() - inicio.getFullYear()) * 12 +
    (now.getMonth() - inicio.getMonth());
  if (months < 1) return "< 1 mês";
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(months / 12);
  const resto = months % 12;
  if (resto === 0) return `${anos} ${anos === 1 ? "ano" : "anos"}`;
  return `${anos}a ${resto}m`;
}

function fmtData(d: Date | null): string {
  if (!d) return NA;
  return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}

function OperacaoPage() {
  const perms = usePermissions();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [unidadeFilter, setUnidadeFilter] = useState<string>("__all__");
  const [erpFilter, setErpFilter] = useState<string>("__all__");
  const [segmentoFilter, setSegmentoFilter] = useState<string>("__all__");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [e, c] = await Promise.all([
        supabase
          .from("empresas")
          .select("pipefy_record_id,titulo,cnpj,unidade,erp,segmento")
          .eq("tipo_unidade", "franquia")
          .limit(5000),
        supabase
          .from("contratos")
          .select("cnpj,ganho_em,status_contrato")
          .eq("status_contrato", "Ativo")
          .eq("tipo_unidade", "franquia")
          .limit(10000),
      ]);
      if (!mounted) return;
      if (e.data) setEmpresas(e.data as Empresa[]);
      if (c.data) setContratos(c.data as Contrato[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Clientes ativos = empresas com ao menos 1 contrato Ativo (join por CNPJ)
  const clientes = useMemo<ClienteAtivo[]>(() => {
    const normCnpj = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
    const inicioPorCnpj = new Map<string, Date>();
    for (const c of contratos) {
      const key = normCnpj(c.cnpj);
      if (!key || !c.ganho_em) continue;
      const d = new Date(c.ganho_em);
      if (isNaN(d.getTime())) continue;
      const cur = inicioPorCnpj.get(key);
      if (!cur || d < cur) inicioPorCnpj.set(key, d);
    }
    const out: ClienteAtivo[] = [];
    for (const emp of empresas) {
      const key = normCnpj(emp.cnpj);
      const id = emp.pipefy_record_id ? String(emp.pipefy_record_id) : key;
      if (!key) continue;
      if (!inicioPorCnpj.has(key)) continue;
      out.push({
        pipefy_record_id: id,
        titulo: emp.titulo ?? NA,
        unidade: norm(emp.unidade),
        erp: norm(emp.erp).toUpperCase() === "NÃO POSSUI" ? "Não possui" : norm(emp.erp),
        segmento: norm(emp.segmento),
        inicio: inicioPorCnpj.get(key) ?? null,
      });
    }
    return out;
  }, [empresas, contratos]);

  // Escopo por unidade do usuário
  const visiveis = useMemo(() => {
    if (perms.scopedToOwnUnit && perms.unidade) {
      return clientes.filter((c) => unitMatches(perms.unidade, c.unidade));
    }
    return clientes;
  }, [clientes, perms.scopedToOwnUnit, perms.unidade]);

  const unidades = useMemo(
    () => Array.from(new Set(visiveis.map((c) => c.unidade))).sort(),
    [visiveis],
  );
  const erps = useMemo(
    () => Array.from(new Set(visiveis.map((c) => c.erp))).sort(),
    [visiveis],
  );
  const segmentos = useMemo(
    () => Array.from(new Set(visiveis.map((c) => c.segmento))).sort(),
    [visiveis],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visiveis.filter((c) => {
      if (unidadeFilter !== "__all__" && c.unidade !== unidadeFilter) return false;
      if (erpFilter !== "__all__" && c.erp !== erpFilter) return false;
      if (segmentoFilter !== "__all__" && c.segmento !== segmentoFilter) return false;
      if (term && !c.titulo.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [visiveis, unidadeFilter, erpFilter, segmentoFilter, q]);

  // Agrupar por unidade
  const porUnidade = useMemo(() => {
    const map = new Map<
      string,
      {
        unidade: string;
        clientes: ClienteAtivo[];
        erps: Set<string>;
        segmentos: Set<string>;
        maisAntigo: Date | null;
      }
    >();
    for (const c of filtered) {
      const g = map.get(c.unidade) ?? {
        unidade: c.unidade,
        clientes: [],
        erps: new Set<string>(),
        segmentos: new Set<string>(),
        maisAntigo: null as Date | null,
      };
      g.clientes.push(c);
      g.erps.add(c.erp);
      g.segmentos.add(c.segmento);
      if (c.inicio && (!g.maisAntigo || c.inicio < g.maisAntigo)) g.maisAntigo = c.inicio;
      map.set(c.unidade, g);
    }
    return Array.from(map.values()).sort((a, b) => b.clientes.length - a.clientes.length);
  }, [filtered]);

  // Pivot por ERP × unidade
  const pivotErp = useMemo(() => {
    const rows = new Map<string, Map<string, number>>();
    for (const c of filtered) {
      const r = rows.get(c.erp) ?? new Map<string, number>();
      r.set(c.unidade, (r.get(c.unidade) ?? 0) + 1);
      rows.set(c.erp, r);
    }
    const us = Array.from(new Set(filtered.map((c) => c.unidade))).sort();
    const data = Array.from(rows.entries())
      .map(([erp, m]) => ({
        erp,
        por: us.map((u) => m.get(u) ?? 0),
        total: Array.from(m.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);
    return { unidades: us, rows: data };
  }, [filtered]);

  const pivotSeg = useMemo(() => {
    const rows = new Map<string, Map<string, number>>();
    for (const c of filtered) {
      const r = rows.get(c.segmento) ?? new Map<string, number>();
      r.set(c.unidade, (r.get(c.unidade) ?? 0) + 1);
      rows.set(c.segmento, r);
    }
    const us = Array.from(new Set(filtered.map((c) => c.unidade))).sort();
    const data = Array.from(rows.entries())
      .map(([seg, m]) => ({
        seg,
        por: us.map((u) => m.get(u) ?? 0),
        total: Array.from(m.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);
    return { unidades: us, rows: data };
  }, [filtered]);

  const toggle = (u: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  };

  const totalClientes = filtered.length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary-text" />
        <div>
          <h1 className="text-2xl font-bold">Operação por Unidade</h1>
          <p className="text-sm text-muted-foreground">
            ERPs, segmentos e tempo de casa dos clientes ativos
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Unidades</div>
          <div className="text-2xl font-bold">{porUnidade.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Clientes ativos</div>
          <div className="text-2xl font-bold">{totalClientes}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">ERPs distintos</div>
          <div className="text-2xl font-bold">{new Set(filtered.map((c) => c.erp)).size}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Segmentos</div>
          <div className="text-2xl font-bold">{new Set(filtered.map((c) => c.segmento)).size}</div>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={unidadeFilter}
          onValueChange={setUnidadeFilter}
          disabled={perms.scopedToOwnUnit}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as unidades</SelectItem>
            {unidades.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={erpFilter} onValueChange={setErpFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="ERP" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os ERPs</SelectItem>
            {erps.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={segmentoFilter} onValueChange={setSegmentoFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Segmento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os segmentos</SelectItem>
            {segmentos.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Tabs defaultValue="unidades">
        <TabsList>
          <TabsTrigger value="unidades">Por Unidade</TabsTrigger>
          <TabsTrigger value="erp">Por ERP</TabsTrigger>
          <TabsTrigger value="segmento">Por Segmento</TabsTrigger>
        </TabsList>

        <TabsContent value="unidades" className="space-y-3">
          {loading ? (
            <Card className="p-6 text-sm text-muted-foreground">Carregando...</Card>
          ) : porUnidade.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">Nenhum cliente ativo encontrado.</Card>
          ) : (
            porUnidade.map((g) => {
              const isOpen = expanded.has(g.unidade);
              // agrupar por ERP x Segmento
              const combos = new Map<
                string,
                { erp: string; seg: string; clientes: ClienteAtivo[]; min: Date | null; max: Date | null }
              >();
              for (const c of g.clientes) {
                const k = `${c.erp}||${c.segmento}`;
                const cur = combos.get(k) ?? {
                  erp: c.erp,
                  seg: c.segmento,
                  clientes: [],
                  min: null as Date | null,
                  max: null as Date | null,
                };
                cur.clientes.push(c);
                if (c.inicio) {
                  if (!cur.min || c.inicio < cur.min) cur.min = c.inicio;
                  if (!cur.max || c.inicio > cur.max) cur.max = c.inicio;
                }
                combos.set(k, cur);
              }
              const combosArr = Array.from(combos.values()).sort(
                (a, b) => b.clientes.length - a.clientes.length,
              );

              return (
                <Card key={g.unidade} className="overflow-hidden">
                  <button
                    onClick={() => toggle(g.unidade)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <div className="flex-1">
                      <div className="font-semibold">{g.unidade}</div>
                      <div className="text-xs text-muted-foreground">
                        Mais antigo: {fmtData(g.maisAntigo)} ({tempoOperacao(g.maisAntigo)})
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <Badge variant="secondary">{g.clientes.length} clientes</Badge>
                      <Badge variant="outline">{g.erps.size} ERPs</Badge>
                      <Badge variant="outline">{g.segmentos.size} segmentos</Badge>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>ERP</TableHead>
                            <TableHead>Segmento</TableHead>
                            <TableHead className="text-right">Clientes</TableHead>
                            <TableHead>Mais antigo</TableHead>
                            <TableHead>Tempo</TableHead>
                            <TableHead>Mais recente</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {combosArr.map((cb) => (
                            <TableRow key={`${cb.erp}||${cb.seg}`}>
                              <TableCell className="font-medium">{cb.erp}</TableCell>
                              <TableCell>{cb.seg}</TableCell>
                              <TableCell className="text-right">{cb.clientes.length}</TableCell>
                              <TableCell>{fmtData(cb.min)}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {tempoOperacao(cb.min)}
                              </TableCell>
                              <TableCell>{fmtData(cb.max)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="erp">
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ERP</TableHead>
                  {pivotErp.unidades.map((u) => (
                    <TableHead key={u} className="text-right">
                      {u}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivotErp.rows.map((r) => (
                  <TableRow key={r.erp}>
                    <TableCell className="font-medium">{r.erp}</TableCell>
                    {r.por.map((n, i) => (
                      <TableCell key={i} className="text-right">
                        {n || ""}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">{r.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="segmento">
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Segmento</TableHead>
                  {pivotSeg.unidades.map((u) => (
                    <TableHead key={u} className="text-right">
                      {u}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivotSeg.rows.map((r) => (
                  <TableRow key={r.seg}>
                    <TableCell className="font-medium">{r.seg}</TableCell>
                    {r.por.map((n, i) => (
                      <TableCell key={i} className="text-right">
                        {n || ""}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">{r.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
