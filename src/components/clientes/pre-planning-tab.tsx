import { useMemo, useState } from "react";
import { Search, X, UserPlus, FileSpreadsheet } from "lucide-react";
import { exportRowsToXlsx } from "@/lib/xlsx-export";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { useClientesPrePlanning } from "@/hooks/use-clientes-pre-planning";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";

const ALL = "__all__";

function formatCnpjCpf(v: string | null): string {
  if (!v) return "—";
  const d = v.replace(/\D/g, "");
  if (d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  if (d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return v;
}

function fmtBRL(v: number | null): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function isPagamentoAtrasado(v: string | null): boolean {
  if (!v) return false;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > 60 * 24 * 60 * 60 * 1000;
}

export function PrePlanningTab() {
  const { data, isLoading, error } = useClientesPrePlanning();
  const perms = usePermissions();
  const rows = data?.rows ?? [];

  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState(ALL);
  const [uf, setUf] = useState(ALL);

  const visiveis = useMemo(() => {
    if (perms.scopedToOwnUnit && perms.unidade) {
      return rows.filter((r) => unitMatches(perms.unidade, r.unidade));
    }
    return rows;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  const unidades = useMemo(
    () =>
      Array.from(new Set(visiveis.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [visiveis],
  );
  const ufs = useMemo(
    () =>
      Array.from(new Set(visiveis.map((r) => r.estado).filter(Boolean) as string[])).sort(),
    [visiveis],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visiveis.filter((r) => {
      if (unidade !== ALL && r.unidade !== unidade) return false;
      if (uf !== ALL && r.estado !== uf) return false;
      if (term) {
        const hay = [r.razao_social, r.nome_fantasia, r.cnpj_cpf]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [visiveis, q, unidade, uf]);

  const porUnidade = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of visiveis) {
      const k = r.unidade ?? "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [visiveis]);

  const hasFilters = q !== "" || unidade !== ALL || uf !== ALL;
  const clearFilters = () => {
    setQ("");
    setUnidade(ALL);
    setUf(ALL);
  };

  if (error) {
    return (
      <Card className="p-6 text-sm text-destructive">
        Erro ao carregar clientes pré-Planning: {(error as Error).message}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <UserPlus className="h-4 w-4" />
            Total pré-Planning
          </div>
          <div className="mt-2 text-3xl font-bold">
            {isLoading ? "—" : visiveis.length.toLocaleString("pt-BR")}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Clientes Omie ativos ainda não convertidos para Planning
          </div>
        </Card>
        <Card className="p-4 md:col-span-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Top unidades
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {isLoading && (
              <span className="text-sm text-muted-foreground">Carregando…</span>
            )}
            {!isLoading && porUnidade.length === 0 && (
              <span className="text-sm text-muted-foreground">Sem dados</span>
            )}
            {porUnidade.slice(0, 8).map(([u, n]) => (
              <Badge key={u} variant="secondary" className="text-sm">
                {u} · {n}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="flex flex-wrap items-center gap-2 p-3 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por razão social, fantasia ou CNPJ/CPF..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        {perms.scopedToOwnUnit && perms.unidade ? (
          <Badge variant="secondary" className="h-9 px-3 text-sm">
            Unidade: {perms.unidade}
          </Badge>
        ) : (
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as unidades</SelectItem>
              {unidades.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={uf} onValueChange={setUf}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="UF" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas UF</SelectItem>
            {ufs.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-4 w-4" /> Limpar
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={isLoading || filtered.length === 0}
          onClick={() => {
            const data = filtered.map((r) => ({
              Unidade: r.unidade || "",
              "Razão Social": r.razao_social || "",
              "Nome Fantasia": r.nome_fantasia || "",
              "CNPJ/CPF": formatCnpjCpf(r.cnpj_cpf),
              Cidade: r.cidade || "",
              UF: r.estado || "",
              Email: r.email || "",
              Telefone: r.telefone || "",
              Honorário: r.honorario != null ? Number(r.honorario) : "",
              "Último pagamento": r.ultimo_pagamento
                ? fmtDate(r.ultimo_pagamento)
                : "",
              Tipo: r.pessoa_fisica ? "PF" : "PJ",
              "Código Omie": r.codigo_omie ?? "",
              "Sincronizado em": r.synced_at
                ? new Date(r.synced_at).toLocaleString("pt-BR")
                : "",
            }));
            exportRowsToXlsx(data, "clientes-pre-planning", "Pré-Planning", [
              14, 40, 30, 20, 20, 6, 28, 16, 14, 14, 6, 12, 18,
            ]);
          }}
        >
          <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Excel
        </Button>
      </Card>

      {/* Table */}
      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">
            {isLoading
              ? "Carregando..."
              : `${filtered.length.toLocaleString("pt-BR")} cliente(s)`}
          </span>
        </div>
        <div className="max-h-[calc(100vh-360px)] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
              <TableRow>
                <TableHead className="bg-card">Razão Social</TableHead>
                <TableHead className="bg-card">CNPJ / CPF</TableHead>
                <TableHead className="bg-card">Unidade</TableHead>
                <TableHead className="bg-card">Cidade / UF</TableHead>
                <TableHead className="bg-card">E-mail</TableHead>
                <TableHead className="bg-card">Telefone</TableHead>
                <TableHead className="bg-card text-right">Honorário</TableHead>
                <TableHead className="bg-card">Último pagamento</TableHead>
                <TableHead className="bg-card text-right">Código Omie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <div>{r.razao_social || "—"}</div>
                    {r.nome_fantasia && r.nome_fantasia !== r.razao_social && (
                      <div className="text-xs text-muted-foreground">
                        {r.nome_fantasia}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatCnpjCpf(r.cnpj_cpf)}
                  </TableCell>
                  <TableCell>
                    {r.unidade ? (
                      <Badge variant="secondary">{r.unidade}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {[r.cidade, r.estado].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{r.email || "—"}</TableCell>
                  <TableCell className="text-sm">{r.telefone || "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {fmtBRL(r.honorario)}
                  </TableCell>
                  <TableCell
                    className={
                      "text-sm tabular-nums " +
                      (isPagamentoAtrasado(r.ultimo_pagamento)
                        ? "text-amber-600 dark:text-amber-400"
                        : "")
                    }
                  >
                    {fmtDate(r.ultimo_pagamento)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.codigo_omie ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Nenhum cliente encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
