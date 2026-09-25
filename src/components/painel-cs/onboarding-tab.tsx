import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TriangleAlert } from "lucide-react";
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
import { CORES_SERIE, COR_NEUTRA, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";
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
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { Carregando, EstadoErro, EstadoVazio, KpiCard, KpiGrade, Secao } from "@/components/planning";
import { BotaoAtualizarPipefy } from "./botao-atualizar";
import { LinkPipefy } from "./link-pipefy";

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
  synced_at: string | null;
};

const NA = "—";
const DIAS_ALERTA_GARGALO = 7; // card parado há mais de 7 dias na fase atual entra na lista de atenção
const OUTRAS_FASES = "Outras fases";
const ID_GARGALOS = "cs-onboarding-gargalos";

// Rola sem animação para quem pediu menos movimento (V16) e leva o foco junto,
// para o leitor de tela e o teclado continuarem a partir da lista.
function irParaGargalos() {
  const alvo = document.getElementById(ID_GARGALOS);
  if (!alvo) return;
  const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
  alvo.focus({ preventScroll: true });
}

function fmtDate(s: string | null) {
  if (!s) return NA;
  // Data pura ("aaaa-mm-dd") sai da própria string: `new Date` a leria em UTC
  // e, no fuso de Brasília, mostraria o dia anterior.
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
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

/**
 * `aoSincronizar` devolve o maior `synced_at` lido (ou null), para a
 * procedência do cabeçalho dizer de quando é o dado (N3).
 */
export function OnboardingTab({ aoSincronizar }: { aoSincronizar?: (quando: string | null) => void } = {}) {
  const perms = usePermissions();
  const [rows, setRows] = useState<OnboardingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("cs_onboarding_cards")
      .select("pipefy_card_id,titulo,fase_atual,fase_atual_ordem,entrou_fase_atual_em,criado_em,concluido,unidade,fases_history,synced_at")
      .limit(5000);
    // Erro de leitura era engolido e a tela mostrava zeros (N4).
    setErro(error ? error.message : null);
    if (data) {
      const lidas = data as OnboardingCard[];
      setRows(lidas);
      // Date.parse, não comparação de texto: timestamptz pode vir com "Z" ou "+00:00".
      let maior = 0;
      for (const r of lidas) {
        const t = r.synced_at ? Date.parse(r.synced_at) : NaN;
        if (Number.isFinite(t) && t > maior) maior = t;
      }
      aoSincronizar?.(maior > 0 ? new Date(maior).toISOString() : null);
    }
    setLoading(false);
  }, [aoSincronizar]);

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
    // Sem data de entrada na fase não dá para dizer se está parado: conta à
    // parte, na nota, em vez de sumir como se tivesse 0 dia.
    const semDataDeFase = ativos.filter((r) => diasDesde(r.entrou_fase_atual_em) == null).length;
    const ciclos = concluidos.map(cicloDias).filter((d): d is number => d != null);
    const cicloMedio = ciclos.length > 0 ? Math.round(ciclos.reduce((s, d) => s + d, 0) / ciclos.length) : null;
    return {
      ativos: ativos.length,
      concluidos: concluidos.length,
      gargalos,
      semDataDeFase,
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
    const conhecidas = FASES_ORDEM.map((name) => ({ name, value: map.get(name) ?? 0 }));
    // Fase fora da ordem conhecida (renomeada no Pipefy, ou sem fase) sumia do
    // gráfico e o funil não fechava com "Clientes em onboarding".
    let outras = 0;
    for (const [f, n] of map) if (!FASES_ORDEM.includes(f)) outras += n;
    return outras > 0 ? [...conhecidas, { name: OUTRAS_FASES, value: outras }] : conhecidas;
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
      <BotaoAtualizarPipefy atualizando={sync.isPending} onClick={() => sync.mutate()} />

      {erro ? (
        <EstadoErro
          detalhe={`Fonte: cs_onboarding_cards (Pipefy, onboarding). ${erro}`}
          tentarNovamente={() => {
            setErro(null);
            setLoading(true);
            void carregar();
          }}
        />
      ) : loading ? (
        <div className="space-y-4">
          <Carregando variante="kpis" />
          <Carregando variante="grafico" />
          <Carregando variante="tabela" />
        </div>
      ) : (
      <>
      {/* KPIs */}
      <KpiGrade colunas={4}>
        <KpiCard rotulo="Clientes em onboarding" valor={kpis.ativos} />
        <KpiCard rotulo="Onboardings concluídos" valor={kpis.concluidos} tom="sucesso" />
        <KpiCard
          rotulo={`Parados há ${DIAS_ALERTA_GARGALO}+ dias na fase`}
          valor={kpis.gargalos}
          tom={kpis.gargalos > 0 ? "perigo" : undefined}
          nota={kpis.semDataDeFase > 0 ? `${kpis.semDataDeFase} sem data de fase` : undefined}
          abrir={kpis.gargalos > 0 ? { onClick: irParaGargalos, rotulo: "Ver cards parados" } : undefined}
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
      <Secao titulo="Em que fase estão os clientes em onboarding?" descricao="Cards ativos por fase atual, na ordem do pipe">
      <Card className="p-4">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funil} layout="vertical" margin={{ left: 24 }}>
              {/* Barra horizontal: a grade acompanha o eixo de valor (vertical). */}
              <CartesianGrid {...gradeProps} vertical horizontal={false} />
              <XAxis {...eixoProps} type="number" allowDecimals={false} />
              <YAxis {...eixoProps} type="category" dataKey="name" width={220} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [v, "Cards"]} />
              <Bar dataKey="value" name="Cards" radius={[0, 4, 4, 0]}>
                {funil.map((f) => (
                  <Cell key={f.name} fill={f.name === OUTRAS_FASES ? COR_NEUTRA : CORES_SERIE[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      </Secao>

      {/* Throughput — aguardando dados */}
      {!kpis.temDadosDeCiclo && (
        <Secao titulo="Quantos onboardings fechamos por mês?">
          <EstadoVazio
            titulo="Ainda sem onboarding concluído"
            descricao={'Nenhum card chegou em "Concluído" até agora. O gráfico de concluídos por mês aparece assim que os primeiros clientes completarem o funil.'}
          />
        </Secao>
      )}

      {/* Gargalos */}
      <div id={ID_GARGALOS} tabIndex={-1} className="scroll-mt-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Secao
        titulo={`Quais clientes estão parados há ${DIAS_ALERTA_GARGALO}+ dias na mesma fase?`}
        descricao="Do mais parado para o menos; o card se destrava no Pipefy"
        acoes={gargalos.length > 0 ? <TriangleAlert className="size-4 text-danger" aria-hidden /> : undefined}
      >
        {gargalos.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum card parado além do esperado"
            descricao={kpis.semDataDeFase > 0 ? `${kpis.semDataDeFase} card(s) sem data de fase ficam fora desta conta.` : undefined}
          />
        ) : (
          <Card className="p-0 overflow-hidden">
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Cliente</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background">Fase atual</TableHead>
                  <TableHead className="bg-background text-right">Entrou na fase em</TableHead>
                  <TableHead className="bg-background text-right">Dias na fase</TableHead>
                  <TableHead className="bg-background"><span className="sr-only">Pipefy</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gargalos.map(({ r, dias }) => (
                  <TableRow key={r.pipefy_card_id}>
                    <TableCell className="font-medium">{r.titulo ?? NA}</TableCell>
                    <TableCell>{r.unidade ?? NA}</TableCell>
                    <TableCell>{r.fase_atual ?? NA}</TableCell>
                    <TableCell className="num text-right">{fmtDate(r.entrou_fase_atual_em)}</TableCell>
                    <TableCell className="num text-right font-semibold text-danger">{dias}d</TableCell>
                    <TableCell><LinkPipefy cardId={r.pipefy_card_id} titulo={r.titulo} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          </Card>
        )}
      </Secao>
      </div>

      {/* Lista operacional */}
      <Secao titulo="Quem está em onboarding agora?" descricao="Todos os cards ativos, na ordem das fases do pipe">
        {listaOperacional.length === 0 ? (
          <EstadoVazio titulo="Nenhum cliente em onboarding no momento" />
        ) : (
          <Card className="p-0 overflow-hidden">
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Cliente</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background">Fase atual</TableHead>
                  <TableHead className="bg-background text-right">Criado em</TableHead>
                  <TableHead className="bg-background text-right">Dias na fase atual</TableHead>
                  <TableHead className="bg-background"><span className="sr-only">Pipefy</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaOperacional.map((r) => (
                  <TableRow key={r.pipefy_card_id}>
                    <TableCell className="font-medium">{r.titulo ?? NA}</TableCell>
                    <TableCell>{r.unidade ?? NA}</TableCell>
                    <TableCell>{r.fase_atual ?? NA}</TableCell>
                    <TableCell className="num text-right">{fmtDate(r.criado_em)}</TableCell>
                    <TableCell className="num text-right">{fmtDias(diasDesde(r.entrou_fase_atual_em))}</TableCell>
                    <TableCell><LinkPipefy cardId={r.pipefy_card_id} titulo={r.titulo} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          </Card>
        )}
      </Secao>
      </>
      )}
    </div>
  );
}

// "—d" não é número: sem data de fase, só o travessão (N4).
function fmtDias(dias: number | null): string {
  return dias == null ? NA : `${dias}d`;
}
