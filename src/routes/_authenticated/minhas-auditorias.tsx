import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";

// Visão do sócio regional sobre o pipe Pipefy "Auditoria Interna" (307181077).
// Não há filtro de unidade aqui: quem recorta é a RLS de `auditorias_internas`
// (RESTRICTIVE `escopo_unidade` + chave `view.minhas_auditorias`, migration
// 20260923200000). A visão da matriz, com ranking entre unidades, é
// /auditoria-interna.
export const Route = createFileRoute("/_authenticated/minhas-auditorias")({
  head: () => ({ meta: [{ title: "Auditorias da unidade – Planning" }] }),
  component: MinhasAuditoriasPage,
});

type Auditoria = {
  pipefy_card_id: string;
  empresa_auditada: string | null;
  unidade: string | null;
  fase_atual: string | null;
  tipo_projeto: string | null;
  prazo_atual: string | null;
  data_conclusao: string | null;
  auditoria_finalizada: boolean | null;
  classificacao_apontamentos: string | null;
  oportunidades_texto: string | null;
  contingencias_texto: string | null;
  oportunidades_valor: number | null;
  contingencias_valor: number | null;
  faturamento_periodo: number | null;
};

const NA = "—";
// Teto da leitura de `auditorias_internas` (a consulta pede .limit(1000)).
const LIMITE = 1000;
// Mesmas regras de /auditoria-interna: concluída é o flag do card ou uma das
// fases finais do pipe.
const FASES_CONCLUIDAS = new Set([
  "Projeto Concluído",
  "Reforma Tributária Concluida",
  "Solicitações Comerciais",
]);

const TIPO_ORDER = [
  "Auditoria",
  "Contas Perdidas",
  "Solicitações Comerciais",
  "Reforma Tributária",
] as const;
const TIPO_LABEL: Record<string, string> = {
  Auditoria: "Auditoria",
  "Contas Perdidas": "Recuperação de Contas",
  "Solicitações Comerciais": "Apoio a Grandes Contas",
  "Reforma Tributária": "Reforma Tributária",
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
// Valor não informado no card não é R$ 0 (N4).
const fmtBRLouNA = (v: number | null) => (v == null ? NA : fmtBRL(v));

function fmtData(s: string | null) {
  if (!s) return NA;
  const d = new Date(s);
  return isNaN(d.getTime()) ? NA : d.toLocaleDateString("pt-BR");
}

function isConcluida(r: Auditoria) {
  return !!r.auditoria_finalizada || FASES_CONCLUIDAS.has(r.fase_atual ?? "");
}

function diasAtraso(r: Auditoria): number | null {
  if (isConcluida(r) || !r.prazo_atual) return null;
  const prazo = new Date(r.prazo_atual).getTime();
  if (isNaN(prazo) || prazo >= Date.now()) return null;
  return Math.floor((Date.now() - prazo) / 86_400_000);
}

// O campo do Pipefy é texto livre; "Não Identificado" (e variações) é o jeito
// do time dizer que não houve achado, não um achado.
function semAchado(texto: string | null) {
  const t = (texto ?? "").trim().toLowerCase();
  return !t || t.startsWith("não identificad") || t.startsWith("nao identificad") || t === "n/a";
}

function tomClassificacao(c: string | null): TomStatus {
  const t = (c ?? "").toLowerCase();
  if (t.includes("alta")) return "perigo";
  if (t.includes("média") || t.includes("media")) return "atencao";
  return "neutro";
}

function MinhasAuditoriasPage() {
  const { unidade, loading: permLoading } = usePermissions();
  const [rows, setRows] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Tipo na URL (N7): recarregar ou colar o link mantém o recorte.
  const [tipo, setTipo] = useFiltroNaUrl("tipo", "todos");
  const [tentativa, setTentativa] = useState(0);
  const [lidoEm, setLidoEm] = useState<Date | null>(null);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    supabase
      .from("auditorias_internas")
      .select(
        "pipefy_card_id,empresa_auditada,unidade,fase_atual,tipo_projeto,prazo_atual,data_conclusao,auditoria_finalizada,classificacao_apontamentos,oportunidades_texto,contingencias_texto,oportunidades_valor,contingencias_valor,faturamento_periodo",
      )
      .limit(1000)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else {
          setRows((data ?? []) as Auditoria[]);
          setLidoEm(new Date());
        }
        setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  const tiposPresentes = useMemo(
    () => TIPO_ORDER.filter((t) => rows.some((r) => r.tipo_projeto === t)),
    [rows],
  );

  // Link velho ou tipo que sumiu da base cai em "todos", em vez de filtrar para vazio.
  const tipoAtivo =
    tiposPresentes.length > 1 && (tiposPresentes as readonly string[]).includes(tipo) ? tipo : "todos";

  const filtradas = useMemo(
    () => (tipoAtivo === "todos" ? rows : rows.filter((r) => r.tipo_projeto === tipoAtivo)),
    [rows, tipoAtivo],
  );

  const { concluidas, andamento, kpis } = useMemo(() => {
    const concluidas = filtradas
      .filter(isConcluida)
      .sort((a, b) => (b.data_conclusao ?? "").localeCompare(a.data_conclusao ?? ""));
    const andamento = filtradas
      .filter((r) => !isConcluida(r))
      .sort((a, b) => (a.prazo_atual ?? "9999").localeCompare(b.prazo_atual ?? "9999"));
    let oportunidades = 0;
    let contingencias = 0;
    let faturamento = 0;
    let achadoComFat = 0;
    for (const r of filtradas) {
      oportunidades += r.oportunidades_valor ?? 0;
      contingencias += r.contingencias_valor ?? 0;
      // Exposição só fecha com numerador e denominador da mesma auditoria.
      if (r.faturamento_periodo) {
        faturamento += r.faturamento_periodo;
        achadoComFat += (r.oportunidades_valor ?? 0) + (r.contingencias_valor ?? 0);
      }
    }
    return {
      concluidas,
      andamento,
      kpis: {
        oportunidades,
        contingencias,
        atrasadas: andamento.filter((r) => diasAtraso(r) != null).length,
        exposicao: faturamento > 0 ? achadoComFat / faturamento : null,
      },
    };
  }, [filtradas]);

  const carregando = loading || permLoading;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Auditorias"
        pergunta="O que as auditorias encontraram nos clientes da minha unidade?"
        descricao={
          <>
            Projetos do time fiscal para clientes{" "}
            {unidade ? (
              <>
                de <strong>{unidade}</strong>
              </>
            ) : (
              "da unidade"
            )}
            . Valores estimados, somados a partir dos relatórios de cada auditoria.
          </>
        }
        procedencia={{
          fonte: "Pipefy · pipe Auditoria Interna",
          atualizadoEm: lidoEm,
          regua: "leitura de até 1.000 auditorias",
        }}
      />

      {carregando ? (
        <Carregando variante="kpis" />
      ) : erro ? (
        <EstadoErro detalhe={erro} tentarNovamente={() => setTentativa((n) => n + 1)} />
      ) : rows.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma auditoria para a sua unidade ainda"
          descricao="Quando o time fiscal abrir um projeto para um cliente da unidade, ele aparece aqui com o resultado."
        />
      ) : (
        <>
          {rows.length >= LIMITE && (
            <p className="text-[13px] text-muted-foreground">
              A leitura chegou ao teto de {LIMITE.toLocaleString("pt-BR")} auditorias: pode haver projetos da
              unidade fora desta tela.
            </p>
          )}
          {tiposPresentes.length > 1 && (
            <Tabs value={tipoAtivo} onValueChange={setTipo}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="todos">Todos ({rows.length})</TabsTrigger>
                {tiposPresentes.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {TIPO_LABEL[t]} ({rows.filter((r) => r.tipo_projeto === t).length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <KpiGrade colunas={4}>
            <KpiCard
              rotulo="Concluídas"
              valor={concluidas.length}
              nota={`${andamento.length} em andamento${kpis.atrasadas ? `, ${kpis.atrasadas} com prazo vencido` : ""}`}
            />
            <KpiCard
              rotulo="Oportunidades identificadas"
              valor={fmtBRL(kpis.oportunidades)}
              tom={kpis.oportunidades > 0 ? "sucesso" : undefined}
              nota="Crédito ou recolhimento a maior que o cliente pode recuperar"
            />
            <KpiCard
              rotulo="Contingências identificadas"
              valor={fmtBRL(kpis.contingencias)}
              tom={kpis.contingencias > 0 ? "atencao" : undefined}
              nota="Passivo ou risco fiscal que o cliente precisa corrigir"
            />
            <KpiCard
              rotulo="Exposição"
              valor={
                kpis.exposicao == null
                  ? NA
                  : `${(kpis.exposicao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
              }
              estado={kpis.exposicao == null ? "nao-apurado" : "ok"}
              nota={
                kpis.exposicao == null
                  ? "Nenhuma auditoria com faturamento do período informado"
                  : "Achado total ÷ faturamento do período auditado"
              }
            />
          </KpiGrade>

          <Secao
            titulo="Resultados"
            descricao="Auditorias concluídas, da mais recente para a mais antiga"
          >
            {concluidas.length === 0 ? (
              <EstadoVazio titulo="Nenhuma concluída neste recorte" total={filtradas.length} />
            ) : (
              <div className="space-y-3">
                {concluidas.map((r) => (
                  <CartaoAuditoria key={r.pipefy_card_id} r={r} />
                ))}
              </div>
            )}
          </Secao>

          {andamento.length > 0 && (
            <Secao titulo="Em andamento" descricao="Projetos abertos, pelo prazo mais próximo">
              <div className="space-y-3">
                {andamento.map((r) => (
                  <CartaoAuditoria key={r.pipefy_card_id} r={r} />
                ))}
              </div>
            </Secao>
          )}
        </>
      )}
    </div>
  );
}

function CartaoAuditoria({ r }: { r: Auditoria }) {
  const concluida = isConcluida(r);
  const atraso = diasAtraso(r);
  const temTexto = !semAchado(r.oportunidades_texto) || !semAchado(r.contingencias_texto);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="font-semibold leading-snug">{r.empresa_auditada ?? NA}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tom="info" icone={false}>
              {TIPO_LABEL[r.tipo_projeto ?? ""] ?? r.tipo_projeto ?? NA}
            </StatusBadge>
            {concluida ? (
              <StatusBadge tom="sucesso">Concluída em {fmtData(r.data_conclusao)}</StatusBadge>
            ) : atraso != null ? (
              <StatusBadge tom="perigo">Prazo vencido há {atraso}d</StatusBadge>
            ) : (
              <StatusBadge tom="neutro">
                {r.fase_atual ?? "Em andamento"}
                {r.prazo_atual ? `, prazo ${fmtData(r.prazo_atual)}` : ""}
              </StatusBadge>
            )}
            {r.classificacao_apontamentos && (
              <StatusBadge tom={tomClassificacao(r.classificacao_apontamentos)}>
                Apontamentos: {r.classificacao_apontamentos}
              </StatusBadge>
            )}
          </div>
        </div>
        <div className="flex gap-5 text-right shrink-0">
          <div>
            <div className="text-xs text-muted-foreground">Oportunidade</div>
            <div
              className={`font-semibold tabular-nums ${r.oportunidades_valor == null ? "text-muted-foreground" : "text-success"}`}
            >
              {fmtBRLouNA(r.oportunidades_valor)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Contingência</div>
            <div
              className={`font-semibold tabular-nums ${r.contingencias_valor == null ? "text-muted-foreground" : "text-warning"}`}
            >
              {fmtBRLouNA(r.contingencias_valor)}
            </div>
          </div>
        </div>
      </div>

      {temTexto && (
        <div className="grid gap-3 md:grid-cols-2">
          <Achado titulo="Oportunidades" texto={r.oportunidades_texto} />
          <Achado titulo="Contingências" texto={r.contingencias_texto} />
        </div>
      )}
    </Card>
  );
}

function Achado({ titulo, texto }: { titulo: string; texto: string | null }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{titulo}</div>
      {semAchado(texto) ? (
        <div className="text-sm text-muted-foreground">Nada identificado</div>
      ) : (
        <div className="whitespace-pre-line text-sm leading-relaxed">{texto!.trim()}</div>
      )}
    </div>
  );
}
