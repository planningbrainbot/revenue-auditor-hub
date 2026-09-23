import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, AlertTriangle, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { syncPainelCs, FASES_ORDEM } from "@/lib/painel-cs.functions";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { CORES_SERIE } from "@/lib/planning/grafico";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import { KpiCard, KpiGrade } from "@/components/planning";

type CardHistoryEntry = { fase: string | null; entrou_em: string | null; saiu_em: string | null };

type OnboardingCard = {
  pipefy_card_id: string;
  titulo: string | null;
  fase_atual: string | null;
  fase_atual_ordem: number | null;
  entrou_fase_atual_em: string | null;
  criado_em: string | null;
  concluido: boolean | null;
  unidade: string | null;
  fases_history: CardHistoryEntry[] | null;
};

const NA = "—";
const DIAS_ALERTA_GARGALO = 7; // card parado há mais de 7 dias na fase atual entra na lista de atenção

function fmtDate(s: string | null) {
  if (!s) return NA;
  const d = new Date(s);
  if (isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("pt-BR");
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function cicloDias(card: OnboardingCard): number | null {
  if (!card.concluido || !card.criado_em) return null;
  const concluidoEm = card.entrou_fase_atual_em ?? null;
  if (!concluidoEm) return null;
  const inicio = new Date(card.criado_em).getTime();
  const fim = new Date(concluidoEm).getTime();
  if (isNaN(inicio) || isNaN(fim)) return null;
  return Math.round((fim - inicio) / (1000 * 60 * 60 * 24));
}

export function OnboardingTab() {
  const perms = usePermissions();
  const [rows, setRows] = useState<OnboardingCard[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("cs_onboarding_cards")
      .select("pipefy_card_id,titulo,fase_atual,fase_atual_ordem,entrou_fase_atual_em,criado_em,concluido,unidade,fases_history")
      .limit(5000);
    if (data) setRows(data as OnboardingCard[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const syncFn = useServerFn(syncPainelCs);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: async (res) => {
      await carregar();
      toast.success(`Onboarding atualizado do Pipefy: ${res.total} card(s).`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      toast.error(msg);
    },
  });

  const escopados = useMemo(() => {
    if (perms.scopedToOwnUnit && perms.unidade) {
      return rows.filter((r) => unitMatches(perms.unidade, r.unidade));
    }
    return rows;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  const ativos = useMemo(() => escopados.filter((r) => !r.concluido), [escopados]);
  const concluidos = useMemo(() => escopados.filter((r) => r.concluido), [escopados]);

  const kpis = useMemo(() => {
    const gargalos = ativos.filter((r) => (diasDesde(r.entrou_fase_atual_em) ?? 0) >= DIAS_ALERTA_GARGALO).length;
    const ciclos = concluidos.map(cicloDias).filter((d): d is number => d != null);
    const cicloMedio = ciclos.length > 0 ? Math.round(ciclos.reduce((s, d) => s + d, 0) / ciclos.length) : null;
    return {
      ativos: ativos.length,
      concluidos: concluidos.length,
      gargalos,
      cicloMedio,
      temDadosDeCiclo: ciclos.length > 0,
    };
  }, [ativos, concluidos]);

  const funil = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of FASES_ORDEM) map.set(f, 0);
    for (const r of ativos) {
      const f = (r.fase_atual ?? NA).trim();
      map.set(f, (map.get(f) ?? 0) + 1);
    }
    return FASES_ORDEM.map((name) => ({ name, value: map.get(name) ?? 0 }));
  }, [ativos]);

  const gargalos = useMemo(
    () =>
      ativos
        .map((r) => ({ r, dias: diasDesde(r.entrou_fase_atual_em) ?? 0 }))
        .filter((x) => x.dias >= DIAS_ALERTA_GARGALO)
        .sort((a, b) => b.dias - a.dias),
    [ativos],
  );

  const listaOperacional = useMemo(
    () => [...ativos].sort((a, b) => (a.fase_atual_ordem ?? 999) - (b.fase_atual_ordem ?? 999)),
    [ativos],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
          Forçar atualização
        </Button>
      </div>

      {/* KPIs */}
      <KpiGrade colunas={4}>
        <KpiCard rotulo="Clientes em onboarding" valor={kpis.ativos} />
        <KpiCard rotulo="Onboardings concluídos" valor={kpis.concluidos} />
        <KpiCard
          rotulo={`Gargalos (parado ≥ ${DIAS_ALERTA_GARGALO}d na fase)`}
          valor={kpis.gargalos}
        />
        {/* Sem nenhum ciclo fechado o tempo médio não existe ainda: "não
            apurado", com o porquê na nota, e não um 0d (N4). */}
        <KpiCard
          rotulo="Tempo médio de ciclo"
          valor={kpis.temDadosDeCiclo ? `${kpis.cicloMedio}d` : "—"}
          estado={kpis.temDadosDeCiclo ? "ok" : "nao-apurado"}
          nota={kpis.temDadosDeCiclo ? undefined : "Aguardando 1º fechamento"}
        />
      </KpiGrade>

      {/* Funil */}
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold">Funil por fase (cards ativos)</div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funil} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={220} />
              <Tooltip />
              <Bar dataKey="value" fill={CORES_SERIE[0]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Throughput — aguardando dados */}
      {!kpis.temDadosDeCiclo && (
        <Card className="p-4 flex items-center gap-3 border-dashed">
          <Hourglass className="h-5 w-5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Throughput (onboardings concluídos por mês) ainda não tem dado real — nenhum card chegou em
            "Concluído" até agora. Esse gráfico aparece assim que os primeiros clientes completarem o funil.
          </p>
        </Card>
      )}

      {/* Gargalos */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          {gargalos.length > 0 && <AlertTriangle className="h-4 w-4 text-destructive" />}
          <div className="text-sm font-semibold">Atenção — cards parados há {DIAS_ALERTA_GARGALO}+ dias na fase atual</div>
        </div>
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-6">Carregando…</div>
        ) : gargalos.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhum card parado além do esperado.</div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Cliente</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background">Fase atual</TableHead>
                  <TableHead className="bg-background text-right">Entrou na fase em</TableHead>
                  <TableHead className="bg-background text-right">Dias na fase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gargalos.map(({ r, dias }) => (
                  <TableRow key={r.pipefy_card_id}>
                    <TableCell className="font-medium">{r.titulo ?? NA}</TableCell>
                    <TableCell>{r.unidade ?? NA}</TableCell>
                    <TableCell>{r.fase_atual ?? NA}</TableCell>
                    <TableCell className="text-right">{fmtDate(r.entrou_fase_atual_em)}</TableCell>
                    <TableCell className="text-right text-destructive font-semibold">{dias}d</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>

      {/* Lista operacional */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Clientes em onboarding</div>
        </div>
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-6">Carregando…</div>
        ) : listaOperacional.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhum cliente em onboarding no momento.</div>
        ) : (
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Cliente</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background">Fase atual</TableHead>
                  <TableHead className="bg-background text-right">Criado em</TableHead>
                  <TableHead className="bg-background text-right">Dias na fase atual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaOperacional.map((r) => (
                  <TableRow key={r.pipefy_card_id}>
                    <TableCell className="font-medium">{r.titulo ?? NA}</TableCell>
                    <TableCell>{r.unidade ?? NA}</TableCell>
                    <TableCell>{r.fase_atual ?? NA}</TableCell>
                    <TableCell className="text-right">{fmtDate(r.criado_em)}</TableCell>
                    <TableCell className="text-right">{diasDesde(r.entrou_fase_atual_em) ?? NA}d</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
