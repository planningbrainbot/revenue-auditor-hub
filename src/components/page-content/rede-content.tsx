import { Fragment, useEffect, useMemo, useState } from "react";
import { Building2, Info, Search, ChevronDown, ChevronRight, Mail, Phone, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/use-permissions";

type Unidade = {
  id: number;
  nome_da_praca: string | null;
  tipo: string | null;
  data_inauguracao: string | null;
  royalties_percentual: number | null;
  csc_valor_fixo: number | null;
  csc_percentual_base_antiga: number | null;
  midia_mensal: number | null;
  midia_cac: boolean | null;
  paga_cac: boolean | null;
  absorve_midia: boolean | null;
  observacoes_financeiras: string | null;
  cnpj: string | null;
  razao_social: string | null;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtMesAno = (d: Date | null) =>
  d ? d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—";

function tempoDeCasa(inicio: Date | null): string {
  if (!inicio) return "—";
  const now = new Date();
  if (inicio > now) return `inicia ${fmtMesAno(inicio)}`;
  const months =
    (now.getFullYear() - inicio.getFullYear()) * 12 + (now.getMonth() - inicio.getMonth());
  if (months < 1) return "< 1 mês";
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(months / 12);
  const resto = months % 12;
  if (resto === 0) return `${anos} ${anos === 1 ? "ano" : "anos"}`;
  return `${anos}a ${resto}m`;
}

function cscLabel(u: Unidade): string {
  if (u.csc_valor_fixo != null) return `${fmtBRL(u.csc_valor_fixo)} fixo`;
  if (u.csc_percentual_base_antiga != null) return `${u.csc_percentual_base_antiga}% base antiga`;
  return "—";
}

type Socio = {
  id: number;
  nome_completo: string | null;
  cargo: string | null;
  area: string | null;
  unidade: string | null;
  email: string | null;
  telefone: string | null;
};

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sociosFor(unidadeNome: string | null, all: Socio[]): Socio[] {
  const n = normalize(unidadeNome);
  if (!n) return [];
  return all.filter((s) => {
    const u = normalize(s.unidade);
    if (!u) return false;
    if (u === n) return true;
    const tokens = n.split(" ").filter((t) => t.length >= 3);
    return tokens.some((t) => u.includes(t));
  });
}

export function RedeContent() {
  const { can, loading: loadingPerm } = usePermissions();
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todas" | "ativas" | "futuras" | "internas">("todas");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [uRes, sRes] = await Promise.all([
        supabase
          .from("unidades")
          .select(
            "id,nome_da_praca,tipo,data_inauguracao,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,midia_mensal,midia_cac,paga_cac,absorve_midia,observacoes_financeiras,cnpj,razao_social",
          )
          .order("data_inauguracao", { ascending: true, nullsFirst: false }),
        supabase
          .from("socios")
          .select("id,nome_completo,cargo,area,unidade,email,telefone")
          .order("nome_completo"),
      ]);
      if (!mounted) return;
      if (uRes.data) setUnidades(uRes.data as Unidade[]);
      if (sRes.data) setSocios(sRes.data as Socio[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);


  const enriched = useMemo(() => {
    const now = new Date();
    return unidades.map((u) => {
      const ing = u.data_inauguracao ? new Date(u.data_inauguracao) : null;
      let status: "ativa" | "futura" | "interna";
      if ((u.tipo ?? "").toLowerCase() === "interna") status = "interna";
      else if (ing && ing > now) status = "futura";
      else status = "ativa";
      return { ...u, inauguracao: ing, status };
    });
  }, [unidades]);

  const ativas = enriched.filter((u) => u.status === "ativa");
  const futuras = enriched.filter((u) => u.status === "futura");
  const internas = enriched.filter((u) => u.status === "interna");
  const totalMidia = ativas.reduce((sum, u) => sum + (u.midia_mensal ?? 0), 0);

  const regionais = enriched.filter((u) => u.status !== "interna");

  const filteredRegionais = useMemo(() => {
    const term = q.trim().toLowerCase();
    return regionais.filter((u) => {
      if (statusFilter === "ativas" && u.status !== "ativa") return false;
      if (statusFilter === "futuras" && u.status !== "futura") return false;
      if (statusFilter === "internas") return false;
      if (term && !(u.nome_da_praca ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [regionais, q, statusFilter]);

  const filteredInternas = useMemo(() => {
    if (statusFilter !== "todas" && statusFilter !== "internas") return [];
    const term = q.trim().toLowerCase();
    return internas.filter(
      (u) => !term || (u.nome_da_praca ?? "").toLowerCase().includes(term),
    );
  }, [internas, q, statusFilter]);

  if (loadingPerm) {
    return <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!can("view.clientes")) {
    return <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground">Você não tem permissão para visualizar esta página.</div>;
  }

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 className="h-4 w-4" /> Unidades ativas
            </div>
            <div className="mt-2 text-2xl font-bold">{ativas.length}</div>
            <div className="text-xs text-muted-foreground">Regionais já inauguradas</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Unidades futuras</div>
            <div className="mt-2 text-2xl font-bold">{futuras.length}</div>
            <div className="text-xs text-muted-foreground">Inauguração pendente</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Unidades internas</div>
            <div className="mt-2 text-2xl font-bold">{internas.length}</div>
            <div className="text-xs text-muted-foreground">Matriz e áreas</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Mídia mensal (ativas)</div>
            <div className="mt-2 text-2xl font-bold">{fmtBRL(totalMidia)}</div>
            <div className="text-xs text-muted-foreground">Investimento agregado</div>
          </Card>
        </div>

        <Card className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar unidade..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="ativas">Ativas</SelectItem>
              <SelectItem value="futuras">Futuras</SelectItem>
              <SelectItem value="internas">Internas</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        {statusFilter !== "internas" && (
          <Card className="overflow-x-auto">
            <div className="border-b p-3 text-sm font-semibold">Regras por unidade (regionais)</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Razão social</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Inauguração</TableHead>
                  <TableHead>Tempo de casa</TableHead>
                  <TableHead className="text-right">Royalties</TableHead>
                  <TableHead>CSC</TableHead>
                  <TableHead className="text-right">Mídia mensal</TableHead>
                  <TableHead>CAC</TableHead>
                  <TableHead>Absorve mídia</TableHead>
                  <TableHead>Obs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-sm text-muted-foreground">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : filteredRegionais.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-sm text-muted-foreground">
                      Nenhuma unidade encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRegionais.map((u) => {
                    const isOpen = expandedId === u.id;
                    const usocios = sociosFor(u.nome_da_praca, socios);
                    return (
                      <Fragment key={u.id}>
                        <TableRow
                          key={u.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedId(isOpen ? null : u.id)}
                        >
                          <TableCell className="w-8 p-2">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">
                            {u.nome_da_praca ?? "—"}
                            {usocios.length > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">({usocios.length})</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-pre-line text-muted-foreground">{u.razao_social ?? "—"}</TableCell>
                          <TableCell className="whitespace-pre-line text-muted-foreground">{u.cnpj ?? "—"}</TableCell>
                          <TableCell>
                            {u.status === "ativa" ? (
                              <Badge variant="default">Ativa</Badge>
                            ) : (
                              <Badge variant="secondary">Futura</Badge>
                            )}
                          </TableCell>
                          <TableCell>{fmtMesAno(u.inauguracao)}</TableCell>
                          <TableCell className="text-muted-foreground">{tempoDeCasa(u.inauguracao)}</TableCell>
                          <TableCell className="text-right">
                            {u.royalties_percentual != null ? `${u.royalties_percentual}%` : "—"}
                          </TableCell>
                          <TableCell>{cscLabel(u)}</TableCell>
                          <TableCell className="text-right">
                            {u.midia_cac ? (
                              <span className="text-xs text-muted-foreground">mídia = CAC</span>
                            ) : (
                              fmtBRL(u.midia_mensal)
                            )}
                          </TableCell>
                          <TableCell>
                            {u.paga_cac ? (
                              <Badge variant="outline">Paga</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Não paga</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {u.absorve_midia ? (
                              <Badge variant="outline">Sim</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Não</span>
                            )}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {u.observacoes_financeiras ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-4 w-4 cursor-help text-warning" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {u.observacoes_financeiras}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={`${u.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={12} className="py-3">
                              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Sócios &amp; contatos
                              </div>
                              {usocios.length === 0 ? (
                                <div className="text-sm text-muted-foreground">
                                  Nenhum sócio cadastrado para esta unidade.
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                                  {usocios.map((s) => (
                                    <div key={s.id} className="rounded-md border bg-background p-3">
                                      <div className="flex items-start gap-2">
                                        <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-medium">{s.nome_completo ?? "—"}</div>
                                          <div className="truncate text-xs text-muted-foreground">
                                            {[s.cargo, s.area].filter(Boolean).join(" · ") || "—"}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="mt-2 space-y-1 text-xs">
                                        {s.email && (
                                          <a
                                            href={`mailto:${s.email}`}
                                            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                                          >
                                            <Mail className="h-3 w-3" /> {s.email}
                                          </a>
                                        )}
                                        {s.telefone && (
                                          <a
                                            href={`tel:${s.telefone.replace(/\D/g, "")}`}
                                            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                                          >
                                            <Phone className="h-3 w-3" /> {s.telefone}
                                          </a>
                                        )}
                                        {!s.email && !s.telefone && (
                                          <div className="text-muted-foreground">Sem contato cadastrado.</div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        )}

        {(statusFilter === "todas" || statusFilter === "internas") && filteredInternas.length > 0 && (
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold">Unidades internas</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {filteredInternas.map((u) => (
                <div key={u.id} className="rounded-md border p-3">
                  <div className="font-medium">{u.nome_da_praca ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    Mídia mensal: {fmtBRL(u.midia_mensal)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
