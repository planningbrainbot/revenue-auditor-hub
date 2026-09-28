import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, Clock, MessagesSquare, TriangleAlert } from "lucide-react";
import { Carregando, StatusBadge, formatarQuando } from "@/components/planning";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FRENTES, ORDEM_FRENTES } from "@/lib/cockpit-ceo/contrato";
import type { Estado, Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { montarLeituraExecutiva } from "@/lib/cockpit-ceo/visao-executiva";
import type { SaudeDados } from "@/lib/cockpit-ceo/visao-executiva";
import {
  mesAnterior,
  modeloChurn,
  modeloComposicao,
  modeloEntrega,
  modeloFontes,
  modeloFranqueadora,
  modeloPonte,
  modeloRedeMrr,
  modeloTrajetoria,
} from "@/lib/cockpit-ceo/visual";
import { pctTexto, reaisCurto } from "@/lib/cockpit-ceo/explicacoes";
import { Bloco, SemDadoGrafico, ehSemDado } from "./graficos";
import {
  GraficoChurn,
  GraficoComposicao,
  GraficoEntrega,
  GraficoFontes,
  GraficoFranqueadora,
  GraficoPonte,
  GraficoRedeMrr,
  GraficoTrajetoria,
  NumerosTrajetoria,
} from "./visao-graficos";

// Visão executiva, revisão visual de 28/09/2026 (contrato docs/design/contratos/cockpit-ceo.md,
// revisão "número vira gráfico"). Cada bloco é um gráfico com o número principal em destaque e um
// título de uma linha; parágrafo, descrição e nota foram para a gaveta, que abre no clique em
// qualquer bloco (N2). Ordem: trajetória rumo ao bilhão; ponte e composição; churn e entrega; rede
// e franqueadora; fontes, decisões e ameaças.

/** Selo compacto de saúde das fontes; o detalhe abre num popover (N3 sem poluir a leitura). */
export function SaudeDasFontes({ saude }: { saude: SaudeDados }) {
  if (!saude.total) return null;
  const ok = saude.paradas.length === 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Saúde das fontes de dados">
          {ok ? (
            <CircleCheck className="size-4 text-success" aria-hidden />
          ) : (
            <TriangleAlert className="size-4 text-warning" aria-hidden />
          )}
          {ok
            ? "Fontes em dia"
            : `${saude.paradas.length} de ${saude.total} fonte${saude.total > 1 ? "s" : ""} atrasada${saude.paradas.length > 1 ? "s" : ""}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-3">
        <p className="text-sm font-semibold">Última atualização de cada fonte</p>
        <ul className="space-y-2">
          {saude.linhas.map((l) => (
            <li key={l.fonte} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block">{l.fonte}</span>
                {l.estado !== "em_dia" && (
                  <span className="block text-[13px] text-muted-foreground">{l.nota}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                <Clock className="size-4" aria-hidden />
                {formatarQuando(l.atualizadoEm) || "sem data"}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/cockpit-ceo"
          search={{ frente: "capital" } as never}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-text hover:underline"
        >
          Método, réguas e cobertura <ArrowRight className="size-4" aria-hidden />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Perguntar ao Brain". No cabeçalho abre a conversa vazia; na gaveta, com `grafico`, abre a
 * conversa já com o gráfico e os dados dele como contexto.
 */
export function BotaoPerguntar({
  grafico,
  rotulo = "Perguntar ao Brain",
  variante = "default",
}: {
  grafico?: string;
  rotulo?: string;
  variante?: "default" | "outline";
}) {
  return (
    <Button asChild size="sm" variant={variante}>
      <Link to="/cockpit-ceo/perguntar" search={(grafico ? { grafico } : {}) as never}>
        <MessagesSquare className="size-4" aria-hidden /> {rotulo}
      </Link>
    </Button>
  );
}

const UmaLinha = ({ children }: { children: ReactNode }) => (
  <span className="block min-w-0 truncate">{children}</span>
);

export function VisaoExecutivaLeitura({
  cockpit: c,
  abrirGrafico,
  irParaFrente,
}: {
  cockpit: Cockpit;
  abrirGrafico: (id: string) => void;
  irParaFrente: (f: Frente) => void;
}) {
  const m = useMemo(() => {
    const saude = montarLeituraExecutiva(c).saude;
    return {
      trajetoria: modeloTrajetoria(c),
      ponte: modeloPonte(c),
      composicao: modeloComposicao(c.visual),
      churn: modeloChurn(c, c.visual),
      rede: modeloRedeMrr(c.visual),
      franqueadora: modeloFranqueadora(c.visual, c.hoje),
      entrega: modeloEntrega(c),
      fontes: modeloFontes(saude.linhas, new Date().toISOString()),
    };
  }, [c]);
  // As leituras novas chegam depois das demais: enquanto isso, esqueleto (não "fonte indisponível").
  const emCarga = c.visualEstado === "carregando";
  const esqueleto = <Carregando variante="grafico" />;
  const visualSemDado = (s: { estado: Estado; motivo: string }) =>
    emCarga ? esqueleto : <SemDadoGrafico estado={s.estado} motivo={s.motivo} />;

  const t = m.trajetoria;
  const ponte = m.ponte;
  const comp = m.composicao;
  const comChurn = m.churn.filter((f) => f.media !== null);
  const franq = m.franqueadora;
  const abertoFranq = ehSemDado(franq)
    ? null
    : franq.meses.reduce((s, x) => s + (x.semTitulo ? 0 : x.emAberto), 0);
  const semNumero = emCarga ? undefined : "—";

  return (
    <div className="space-y-4">
      <Bloco titulo="Trajetória rumo ao bilhão" abrir={() => abrirGrafico("trajetoria")}>
        {ehSemDado(t) ? (
          <SemDadoGrafico estado={t.estado} motivo={t.motivo} altura="h-72" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
            <GraficoTrajetoria m={t} />
            <NumerosTrajetoria
              m={t}
              seloD0={
                <StatusBadge tom="atencao">D0 pendente: faturamento ou valuation</StatusBadge>
              }
            />
          </div>
        )}
      </Bloco>

      <div className="grid gap-4 md:grid-cols-2">
        <Bloco
          titulo="Ponte do último mês fechado"
          numero={
            ehSemDado(ponte)
              ? "—"
              : `${ponte.atual >= ponte.anterior ? "+" : "−"}${reaisCurto(Math.abs(ponte.atual - ponte.anterior))}`
          }
          complemento={
            ehSemDado(ponte) ? undefined : `${mesBr(mesAnterior(ponte.mes))} → ${mesBr(ponte.mes)}`
          }
          abrir={() => abrirGrafico("ponte")}
        >
          {ehSemDado(ponte) ? (
            <SemDadoGrafico estado={ponte.estado} motivo={ponte.motivo} altura="h-56" />
          ) : (
            <GraficoPonte m={ponte} />
          )}
        </Bloco>
        <Bloco
          titulo="Composição da receita"
          numero={ehSemDado(comp) ? semNumero : pctTexto(comp.recorrente / comp.total, 0)}
          complemento={
            ehSemDado(comp) ? undefined : `recorrente · ${mesBr(comp.de)} a ${mesBr(comp.ate)}`
          }
          abrir={() => abrirGrafico("composicao")}
        >
          {ehSemDado(comp) ? visualSemDado(comp) : <GraficoComposicao m={comp} />}
        </Bloco>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Bloco
          titulo="Churn mensal por fórmula"
          numero={
            comChurn.length
              ? `${pctTexto(Math.min(...comChurn.map((f) => f.media!)))} a ${pctTexto(Math.max(...comChurn.map((f) => f.media!)))}`
              : semNumero
          }
          complemento={comChurn.length ? "nenhuma fórmula é a oficial" : undefined}
          abrir={() => abrirGrafico("churn")}
        >
          {emCarga && comChurn.length < 2 ? esqueleto : <GraficoChurn fs={m.churn} />}
        </Bloco>
        <Bloco
          titulo="Entrega: onboarding por fase"
          numero={ehSemDado(m.entrega) ? "—" : m.entrega.emCurso}
          complemento={
            ehSemDado(m.entrega)
              ? undefined
              : m.entrega.gargalo
                ? `em curso · gargalo em ${m.entrega.gargalo}`
                : "em curso"
          }
          abrir={() => abrirGrafico("entrega")}
        >
          {ehSemDado(m.entrega) ? (
            <SemDadoGrafico estado={m.entrega.estado} motivo={m.entrega.motivo} />
          ) : (
            <GraficoEntrega m={m.entrega} />
          )}
        </Bloco>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Bloco
          titulo="Rede: MRR ativo por unidade"
          numero={ehSemDado(m.rede) ? semNumero : reaisCurto(m.rede.total)}
          complemento={
            ehSemDado(m.rede) || !m.rede.maior
              ? undefined
              : `${m.rede.maior.unidade} concentra ${pctTexto(m.rede.maior.participacao, 0)}`
          }
          abrir={() => abrirGrafico("rede-mrr")}
        >
          {ehSemDado(m.rede) ? visualSemDado(m.rede) : <GraficoRedeMrr m={m.rede} />}
        </Bloco>
        <Bloco
          titulo="Franqueadora: faturado × recebido"
          numero={abertoFranq === null ? semNumero : reaisCurto(abertoFranq)}
          complemento={abertoFranq === null ? undefined : "em aberto nos 12 meses"}
          abrir={() => abrirGrafico("franqueadora")}
        >
          {ehSemDado(franq) ? visualSemDado(franq) : <GraficoFranqueadora meses={franq.meses} />}
        </Bloco>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Bloco
          titulo="Saúde das fontes"
          numero={`${m.fontes.paradas.length} de ${m.fontes.total}`}
          complemento="paradas"
          abrir={() => abrirGrafico("fontes")}
        >
          {m.fontes.paradas.length ? (
            <GraficoFontes paradas={m.fontes.paradas} />
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <CircleCheck className="size-4 text-success" aria-hidden /> Todas em dia
            </p>
          )}
        </Bloco>
        <Bloco
          titulo="Decisões suas"
          numero={c.decisoes.length}
          complemento="esperando o CEO"
          abrir={() => abrirGrafico("decisoes")}
        >
          <ol className="space-y-2 text-sm" aria-label="Decisões">
            {c.decisoes.slice(0, 3).map((d, i) => (
              <li key={d.id} className="flex min-w-0 items-baseline gap-2">
                <span className="num shrink-0 text-xs font-semibold text-muted-foreground">
                  D{i}
                </span>
                <UmaLinha>{d.titulo}</UmaLinha>
              </li>
            ))}
            {c.decisoes.length > 3 && (
              <li className="text-xs text-muted-foreground">
                mais {c.decisoes.length - 3} na explicação
              </li>
            )}
          </ol>
        </Bloco>
        <Bloco
          titulo="Ameaças"
          numero={c.ameacas.length}
          complemento="por regra fixa"
          abrir={() => abrirGrafico("ameacas")}
        >
          <ul className="space-y-2 text-sm" aria-label="Ameaças">
            {[...c.ameacas]
              .sort((a, b) => Number(a.gravidade !== "alta") - Number(b.gravidade !== "alta"))
              .slice(0, 4)
              .map((a) => (
                <li key={a.id} className="flex min-w-0 items-center gap-2">
                  <StatusBadge tom={a.gravidade === "alta" ? "perigo" : "atencao"}>
                    {a.gravidade === "alta" ? "Alta" : "Média"}
                  </StatusBadge>
                  <UmaLinha>{a.titulo}</UmaLinha>
                </li>
              ))}
          </ul>
        </Bloco>
      </div>

      <nav
        aria-label="Frentes do cockpit"
        className="flex flex-wrap items-center gap-2 border-t pt-4"
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aprofundar
        </span>
        {ORDEM_FRENTES.map((f) => (
          <Button key={f} variant="outline" size="sm" onClick={() => irParaFrente(f)}>
            {FRENTES[f].titulo}
          </Button>
        ))}
      </nav>
    </div>
  );
}
