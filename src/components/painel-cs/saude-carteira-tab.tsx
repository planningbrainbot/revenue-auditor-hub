import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSaudeCarteira } from "@/hooks/use-saude-carteira";
import type { SaudeClienteRow, CategoriaFinanceira, Semaforo } from "@/lib/saude-carteira.functions";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { KpiCard, KpiGrade } from "@/components/planning";

const ALL = "__all__";

// razao_social às vezes vem de um enriquecimento de CNPJ que grava placeholders
// em vez de deixar nulo quando não encontra a razão social oficial (mesmo
// tratamento aplicado em /clientes).
const GARBAGE_RAZAO_SOCIAL = new Set([".", "0", "-", "--", "---", "n/a", "N/A", "NA", "o", "a", "n", "c", "cc", "xx"]);
function displayName(r: Pick<SaudeClienteRow, "razao_social" | "titulo">): string {
  const rs = r.razao_social?.trim();
  if (rs && !GARBAGE_RAZAO_SOCIAL.has(rs)) return rs;
  return r.titulo?.trim() || "—";
}

const CATEGORIA_LABEL: Record<CategoriaFinanceira, string> = {
  ATIVO: "Ativo",
  EM_ATRASO: "Em atraso",
  INADIMPLENTE: "Inadimplente",
  SEM_ATIVIDADE: "Sem atividade",
  NUNCA_PAGOU: "Nunca pagou",
  SEM_AR: "Sem AR",
};

const SEMAFORO_META: Record<Semaforo, { label: string; badge: string; dot: string }> = {
  saudavel: {
    label: "Saudável",
    badge: "bg-success-soft text-success hover:bg-success-soft",
    dot: "bg-success",
  },
  atencao: {
    label: "Atenção",
    badge: "bg-warning-soft text-warning hover:bg-warning-soft",
    dot: "bg-warning",
  },
  risco: {
    label: "Risco",
    badge: "bg-danger-soft text-danger hover:bg-danger-soft",
    dot: "bg-danger",
  },
  sem_medicao: {
    label: "Sem medição",
    badge: "bg-muted text-foreground hover:bg-muted",
    dot: "bg-muted-foreground",
  },
};

function semaforoBadge(s: Semaforo | null) {
  if (!s) return <Badge variant="outline">Churn</Badge>;
  const m = SEMAFORO_META[s];
  return <Badge className={m.badge}>{m.label}</Badge>;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function SaudeCarteiraTab() {
  const { data, isLoading, error } = useSaudeCarteira();
  const perms = usePermissions();

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (perms.scopedToOwnUnit && perms.unidade) {
      return all.filter((r) => unitMatches(perms.unidade, r.unidade));
    }
    return all;
  }, [data, perms.scopedToOwnUnit, perms.unidade]);

  // carteira ativa = exclui clientes já em churn (estagio=Perdido em central_tratativas)
  const ativos = useMemo(() => rows.filter((r) => !r.churn), [rows]);

  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState(ALL);
  const [semaforo, setSemaforo] = useState<Semaforo | typeof ALL>(ALL);

  const unidades = useMemo(
    () => Array.from(new Set(ativos.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [ativos],
  );

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return ativos.filter((r) => {
      if (unidade !== ALL && r.unidade !== unidade) return false;
      if (semaforo !== ALL && r.semaforo !== semaforo) return false;
      if (qn) {
        const hay = `${displayName(r)} ${r.cnpj ?? ""}`.toLowerCase();
        if (!hay.includes(qn)) return false;
      }
      return true;
    });
  }, [ativos, q, unidade, semaforo]);

  const kpis = useMemo(() => {
    const saudavel = ativos.filter((r) => r.semaforo === "saudavel").length;
    const atencao = ativos.filter((r) => r.semaforo === "atencao").length;
    const risco = ativos.filter((r) => r.semaforo === "risco").length;
    const semMedicao = ativos.filter((r) => r.semaforo === "sem_medicao").length;
    const mrrEmRisco = ativos
      .filter((r) => r.semaforo === "risco" || r.semaforo === "atencao")
      .reduce((acc, r) => acc + r.mrr_ativo, 0);
    const valorTotalEmAtraso = ativos.reduce((acc, r) => acc + r.valor_em_atraso, 0);
    return { total: ativos.length, saudavel, atencao, risco, semMedicao, mrrEmRisco, valorTotalEmAtraso };
  }, [ativos]);

  const porUnidade = useMemo(() => {
    const map = new Map<string, { saudavel: number; atencao: number; risco: number; semMedicao: number; mrrRisco: number }>();
    for (const r of ativos) {
      const u = r.unidade ?? "—";
      const cur = map.get(u) ?? { saudavel: 0, atencao: 0, risco: 0, semMedicao: 0, mrrRisco: 0 };
      if (r.semaforo === "saudavel") cur.saudavel += 1;
      else if (r.semaforo === "atencao") cur.atencao += 1;
      else if (r.semaforo === "risco") cur.risco += 1;
      else if (r.semaforo === "sem_medicao") cur.semMedicao += 1;
      if (r.semaforo === "risco" || r.semaforo === "atencao") cur.mrrRisco += r.mrr_ativo;
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([unidade, v]) => ({ unidade, ...v, total: v.saudavel + v.atencao + v.risco + v.semMedicao }))
      .sort((a, b) => b.risco - a.risco || b.atencao - a.atencao);
  }, [ativos]);

  const hasFilters = q || unidade !== ALL || semaforo !== ALL;
  const clearFilters = () => {
    setQ("");
    setUnidade(ALL);
    setSemaforo(ALL);
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      {/* O semáforo fica no número (tom do KpiCard), com ícone de status junto
          da cor (V7); "Sem medição" e os totais são neutros. */}
      <KpiGrade colunas={6}>
        <KpiCard rotulo="Carteira ativa" valor={kpis.total} />
        <KpiCard rotulo="Saudável" valor={kpis.saudavel} tom="sucesso" />
        <KpiCard rotulo="Atenção" valor={kpis.atencao} tom="atencao" />
        <KpiCard rotulo="Risco" valor={kpis.risco} tom="perigo" />
        <KpiCard rotulo="Sem medição" valor={kpis.semMedicao} />
        <KpiCard rotulo="MRR em atenção/risco" valor={fmtBRL(kpis.mrrEmRisco)} />
      </KpiGrade>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando saúde da carteira…</Card>}
      {error && <Card className="p-6 text-sm text-danger">Erro ao carregar dados.</Card>}

      <Tabs defaultValue="unidades" className="w-full">
        <TabsList>
          <TabsTrigger value="unidades">Por unidade</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
        </TabsList>

        <TabsContent value="unidades" className="space-y-4">
          <Card>
            <div className="border-b p-3 text-sm font-medium">Semáforo por unidade</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Saudável</TableHead>
                  <TableHead className="text-right">Atenção</TableHead>
                  <TableHead className="text-right">Risco</TableHead>
                  <TableHead className="text-right">Sem medição</TableHead>
                  <TableHead className="text-right">MRR em atenção/risco</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porUnidade.map((u) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right text-success">{u.saudavel}</TableCell>
                    <TableCell className="text-right text-warning">{u.atencao}</TableCell>
                    <TableCell className="text-right text-danger">{u.risco}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{u.semMedicao}</TableCell>
                    <TableCell className="text-right">{fmtBRL(u.mrrRisco)}</TableCell>
                  </TableRow>
                ))}
                {porUnidade.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      Sem dados no filtro atual.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="clientes" className="space-y-4">
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar cliente ou CNPJ..."
                  className="pl-8"
                />
              </div>
              <Select value={unidade} onValueChange={setUnidade}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas as unidades</SelectItem>
                  {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={semaforo} onValueChange={(v) => setSemaforo(v as Semaforo | typeof ALL)}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Semáforo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  <SelectItem value="saudavel">Saudável</SelectItem>
                  <SelectItem value="atencao">Atenção</SelectItem>
                  <SelectItem value="risco">Risco</SelectItem>
                  <SelectItem value="sem_medicao">Sem medição</SelectItem>
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="mr-1 h-4 w-4" /> Limpar
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <div className="text-sm font-medium">Clientes</div>
              <div className="text-xs text-muted-foreground">{filtered.length} registro(s)</div>
            </div>
            <div className="relative max-h-[600px] overflow-auto">
              <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-background">Cliente</TableHead>
                    <TableHead className="bg-background">Unidade</TableHead>
                    <TableHead className="bg-background text-right">MRR ativo</TableHead>
                    <TableHead className="bg-background">Categoria financeira</TableHead>
                    <TableHead className="bg-background text-right">Dias em atraso</TableHead>
                    <TableHead className="bg-background text-right">Valor em atraso</TableHead>
                    <TableHead className="bg-background">Tratativa ativa</TableHead>
                    <TableHead className="bg-background">Semáforo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{displayName(r)}</TableCell>
                      <TableCell>{r.unidade ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmtBRL(r.mrr_ativo)}</TableCell>
                      <TableCell>{CATEGORIA_LABEL[r.categoria_financeira]}</TableCell>
                      <TableCell className="text-right">{r.dias_atraso ?? "—"}</TableCell>
                      <TableCell className="text-right">{r.valor_em_atraso > 0 ? fmtBRL(r.valor_em_atraso) : "—"}</TableCell>
                      <TableCell>
                        {r.tratativa_ativa ? (
                          <Badge variant="outline">{r.tratativa_estagio ?? "Sim"}</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{semaforoBadge(r.semaforo)}</TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                        Nenhum cliente encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
