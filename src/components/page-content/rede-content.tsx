import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Info, Mail, Phone, Search, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
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
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { ErroDaConsulta } from "@/components/receita/moldura";
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
    .replace(/[̀-ͯ]/g, "")
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

type FiltroStatus = "todas" | "ativas" | "futuras" | "internas";
const STATUS_VALIDOS: FiltroStatus[] = ["todas", "ativas", "futuras", "internas"];
const ROTULO_STATUS: Record<FiltroStatus, string> = {
  todas: "Todas",
  ativas: "Ativas",
  futuras: "Futuras",
  internas: "Internas",
};

const FOCO =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function RedeContent() {
  const { can, loading: loadingPerm } = usePermissions();
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [tentativa, setTentativa] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Busca e status na URL (N7). A busca digitada grava com uma pausa curta;
  // a URL só sobrescreve o campo quando muda por fora ("Limpar", link colado).
  const [q, setQUrl] = useFiltroNaUrl("q", "");
  const [statusBruto, setStatusUrl] = useFiltroNaUrl("status", "todas");
  const statusFilter: FiltroStatus = STATUS_VALIDOS.includes(statusBruto as FiltroStatus)
    ? (statusBruto as FiltroStatus)
    : "todas";
  const limparFiltros = useLimparFiltrosNaUrl(["q", "status"]);

  const [busca, setBusca] = useState(q);
  const gravada = useRef(q);
  useEffect(() => {
    if (q === gravada.current) return;
    gravada.current = q;
    setBusca(q);
  }, [q]);
  useEffect(() => {
    const v = busca.trim();
    if (v === gravada.current) return;
    const t = setTimeout(() => {
      gravada.current = v;
      setQUrl(v || undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [busca, setQUrl]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErro(null);
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
      // Antes o erro era ignorado e a tela mostrava "Nenhuma unidade" e R$ 0.
      // Sem as unidades não há tela; sem os sócios, só o detalhe fica sem contato.
      if (uRes.error) setErro(uRes.error);
      if (uRes.data) setUnidades(uRes.data as Unidade[]);
      if (sRes.data) setSocios(sRes.data as Socio[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [tentativa]);

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
  const ativasMidiaCac = ativas.filter((u) => u.midia_cac).length;

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

  const temFiltro = q.trim() !== "" || statusFilter !== "todas";
  const alternarStatus = (s: FiltroStatus) => setStatusUrl(statusFilter === s ? undefined : s);

  if (loadingPerm) {
    return <Carregando variante="pagina" className="mx-auto max-w-7xl px-4 py-6 md:px-6" />;
  }

  if (!can("view.clientes")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <EstadoSemAcesso oQueFalta="view.clientes" />
      </div>
    );
  }

  if (erro) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <ErroDaConsulta
          erro={erro}
          chaves="view.unidades_rede"
          titulo="Não foi possível carregar as unidades"
          tentarNovamente={() => setTentativa((n) => n + 1)}
        />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6">
        {loading ? (
          <Carregando variante="kpis" />
        ) : (
          <KpiGrade>
            <KpiCard
              rotulo="Unidades ativas"
              valor={ativas.length}
              nota="Regionais já inauguradas"
              abrir={{ onClick: () => alternarStatus("ativas"), rotulo: "Filtrar" }}
            />
            <KpiCard
              rotulo="Unidades futuras"
              valor={futuras.length}
              nota="Inauguração pendente"
              abrir={{ onClick: () => alternarStatus("futuras"), rotulo: "Filtrar" }}
            />
            <KpiCard
              rotulo="Unidades internas"
              valor={internas.length}
              nota="Matriz e áreas"
              abrir={{ onClick: () => alternarStatus("internas"), rotulo: "Filtrar" }}
            />
            <KpiCard
              rotulo="Mídia mensal (ativas)"
              valor={fmtBRL(totalMidia)}
              nota={
                ativasMidiaCac > 0
                  ? `Soma o cadastro de todas as ativas, inclusive as ${ativasMidiaCac} em que mídia = CAC (na tabela, sem valor)`
                  : "Soma do cadastro das unidades ativas"
              }
            />
          </KpiGrade>
        )}

        <BarraFiltros aoLimpar={temFiltro ? limparFiltros : undefined}>
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Buscar unidade..."
              aria-label="Buscar unidade"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusUrl(v === "todas" ? undefined : v)}
          >
            <SelectTrigger className="w-[180px]" aria-label="Status da unidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_VALIDOS.map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusFilter !== "todas" && (
            <ChipFiltro
              rotulo="Status"
              valor={ROTULO_STATUS[statusFilter]}
              aoRemover={() => setStatusUrl(undefined)}
            />
          )}
          {q.trim() && (
            <ChipFiltro rotulo="Busca" valor={q.trim()} aoRemover={() => setQUrl(undefined)} />
          )}
        </BarraFiltros>

        {statusFilter !== "internas" && (
          <Secao
            titulo="Qual regra vale para cada unidade regional?"
            descricao={
              loading
                ? undefined
                : `${filteredRegionais.length} de ${regionais.length} regionais · clique na linha para ver sócios e contatos`
            }
          >
            {loading ? (
              <Carregando variante="tabela" />
            ) : filteredRegionais.length === 0 ? (
              <EstadoVazio titulo="Nenhuma unidade regional encontrada" total={regionais.length} />
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <span className="sr-only">Detalhe</span>
                      </TableHead>
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
                    {filteredRegionais.map((u) => {
                      const isOpen = expandedId === u.id;
                      const usocios = sociosFor(u.nome_da_praca, socios);
                      const alternar = () => setExpandedId(isOpen ? null : u.id);
                      return (
                        <Fragment key={u.id}>
                          <TableRow className="cursor-pointer" onClick={alternar}>
                            <TableCell className="w-8 p-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  alternar();
                                }}
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Fechar" : "Abrir"} sócios e contatos de ${u.nome_da_praca ?? "unidade"}`}
                                className={`inline-flex size-6 items-center justify-center text-muted-foreground hover:text-foreground ${FOCO}`}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4" aria-hidden />
                                ) : (
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                )}
                              </button>
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
                                <StatusBadge tom="sucesso">Ativa</StatusBadge>
                              ) : (
                                <StatusBadge tom="info">Futura</StatusBadge>
                              )}
                            </TableCell>
                            <TableCell className="num">{fmtMesAno(u.inauguracao)}</TableCell>
                            <TableCell className="text-muted-foreground">{tempoDeCasa(u.inauguracao)}</TableCell>
                            <TableCell className="num text-right">
                              {u.royalties_percentual != null ? `${u.royalties_percentual}%` : "—"}
                            </TableCell>
                            <TableCell className="num">{cscLabel(u)}</TableCell>
                            <TableCell className="num text-right">
                              {u.midia_cac ? (
                                <span className="text-xs text-muted-foreground">mídia = CAC</span>
                              ) : (
                                fmtBRL(u.midia_mensal)
                              )}
                            </TableCell>
                            <TableCell>
                              {u.paga_cac ? (
                                <StatusBadge tom="neutro" icone={false}>Paga</StatusBadge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Não paga</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {u.absorve_midia ? (
                                <StatusBadge tom="neutro" icone={false}>Sim</StatusBadge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Não</span>
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {u.observacoes_financeiras ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`Observação financeira de ${u.nome_da_praca ?? "unidade"}`}
                                      className={`inline-flex cursor-help text-muted-foreground hover:text-foreground ${FOCO}`}
                                    >
                                      <Info className="h-4 w-4" aria-hidden />
                                    </button>
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
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
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
                                          <User className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
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
                                              className={`flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline ${FOCO}`}
                                            >
                                              <Mail className="h-3 w-3" aria-hidden /> {s.email}
                                            </a>
                                          )}
                                          {s.telefone && (
                                            <a
                                              href={`tel:${s.telefone.replace(/\D/g, "")}`}
                                              className={`flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline ${FOCO}`}
                                            >
                                              <Phone className="h-3 w-3" aria-hidden /> {s.telefone}
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
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Secao>
        )}

        {!loading && (statusFilter === "todas" || statusFilter === "internas") && (
          <Secao titulo="Quais unidades são internas?" descricao="Matriz e áreas.">
            {filteredInternas.length === 0 ? (
              <EstadoVazio titulo="Nenhuma unidade interna encontrada" total={internas.length} />
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {filteredInternas.map((u) => (
                  <div key={u.id} className="rounded-xl border bg-card p-3">
                    <div className="font-medium">{u.nome_da_praca ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      Mídia mensal: <span className="num">{fmtBRL(u.midia_mensal)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Secao>
        )}
      </div>
    </TooltipProvider>
  );
}
