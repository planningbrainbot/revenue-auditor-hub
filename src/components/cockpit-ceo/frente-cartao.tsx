import { useMemo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { explicar, reaisCurto } from "@/lib/cockpit-ceo/explicacoes";
import {
  modeloChurn,
  modeloEntrega,
  modeloFontes,
  modeloRedeMrr,
  modeloTrajetoria,
} from "@/lib/cockpit-ceo/visual";
import { montarLeituraExecutiva } from "@/lib/cockpit-ceo/visao-executiva";
import { CORES_COCKPIT, HACHURA_ID, RAIO_BARRA } from "@/lib/planning/grafico";
import { Bloco, Dica, SemDadoGrafico, ehSemDado } from "./graficos";
import type { DicaDado } from "./graficos";
import {
  GraficoChurn,
  GraficoEntrega,
  GraficoFontes,
  GraficoRedeMrr,
  GraficoTrajetoria,
} from "./visao-graficos";

// O cartão principal de cada frente (revisão visual de 28/09/2026): o número grande e um mini
// gráfico, no mesmo padrão da Visão executiva. O clique abre a gaveta `frente-<chave>`; o número e o
// título saem da mesma explicação que a gaveta mostra, então os dois não divergem.

interface Coluna {
  rotulo: string;
  valor: number | null;
  destaque?: boolean;
  dica: DicaDado;
}

/** Colunas pequenas de uma série só; valor ausente é coluna hachurada, não zero. */
function MiniColunas({ colunas, rotulo }: { colunas: Coluna[]; rotulo: string }) {
  const topo = Math.max(1, ...colunas.map((c) => c.valor ?? 0));
  const dados = colunas.map((c) => ({
    ...c,
    barra: c.valor ?? topo * 0.15,
    ausente: c.valor === null,
  }));
  return (
    <div className="h-20" role="img" aria-label={rotulo}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={3}>
          <XAxis dataKey="rotulo" hide />
          <YAxis hide domain={[0, topo]} />
          <Tooltip content={<Dica />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
          <Bar dataKey="barra" radius={RAIO_BARRA} isAnimationActive={false}>
            {dados.map((d) => (
              <Cell
                key={d.rotulo}
                fill={
                  d.ausente
                    ? `url(#${HACHURA_ID})`
                    : d.destaque
                      ? CORES_COCKPIT.realizado
                      : `color-mix(in oklab, ${CORES_COCKPIT.realizado} 45%, var(--card))`
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniGrafico({ cockpit: c, frente }: { cockpit: Cockpit; frente: Frente }) {
  switch (frente) {
    case "receita": {
      const t = modeloTrajetoria(c);
      return ehSemDado(t) ? (
        <SemDadoGrafico {...t} altura="h-20" />
      ) : (
        <GraficoTrajetoria m={t} compacto />
      );
    }
    case "retencao":
      return <GraficoChurn fs={modeloChurn(c, c.visual)} compacto />;
    case "operacao": {
      const e = modeloEntrega(c);
      return ehSemDado(e) ? (
        <SemDadoGrafico {...e} altura="h-20" />
      ) : (
        <GraficoEntrega m={e} compacto />
      );
    }
    case "rede": {
      const r = modeloRedeMrr(c.visual);
      return ehSemDado(r) ? (
        <SemDadoGrafico {...r} altura="h-20" />
      ) : (
        <GraficoRedeMrr m={r} compacto />
      );
    }
    case "capital": {
      const f = modeloFontes(montarLeituraExecutiva(c).saude.linhas, new Date().toISOString());
      return f.paradas.length ? (
        <GraficoFontes paradas={f.paradas} compacto />
      ) : (
        <p className="text-sm text-muted-foreground">Todas em dia</p>
      );
    }
    case "comercial": {
      const meses = (c.empresa.aquisicao?.meses ?? []).slice(-8);
      if (!meses.length)
        return (
          <SemDadoGrafico
            estado="fonte_indisponivel"
            motivo={c.empresa.aquisicaoAviso ?? "Growth não lido."}
            altura="h-20"
          />
        );
      return (
        <MiniColunas
          rotulo="MRR novo vendido por mês"
          colunas={meses.map((m, i) => ({
            rotulo: mesBr(m.mes),
            valor: m.mrrNovo,
            destaque: i === meses.length - 1,
            dica: {
              titulo: `${mesBr(m.mes)}${m.emAndamento ? " (parcial)" : ""}`,
              linhas: [
                ["MRR novo", m.mrrNovo === null ? "sem dado" : reaisCurto(m.mrrNovo)],
                ["Plano", m.plano?.mrrNovo != null ? reaisCurto(m.plano.mrrNovo) : "sem plano"],
              ],
              periodo: m.emAndamento ? "mês em curso" : "mês fechado",
              universo: "Inside Sales (Growth)",
            },
          }))}
        />
      );
    }
    case "clientes": {
      const defs = c.clientes?.definicoes ?? [];
      if (!defs.length)
        return (
          <SemDadoGrafico
            estado="fonte_indisponivel"
            motivo={c.clientesAviso ?? "Definições não lidas."}
            altura="h-20"
          />
        );
      return (
        <MiniColunas
          rotulo="CNPJs por régua de cliente ativo"
          colunas={defs.map((d) => ({
            rotulo: d.titulo,
            valor: d.cnpjs,
            dica: {
              titulo: d.titulo,
              linhas: [
                ["CNPJs", d.cnpjs === null ? "sem número" : d.cnpjs.toLocaleString("pt-BR")],
              ],
              periodo: "fotografia de agora",
              universo: "rede inteira",
            },
          }))}
        />
      );
    }
    case "portfolio": {
      const ps = c.porProduto.filter((p) => p.produto !== "sem_produto");
      return (
        <MiniColunas
          rotulo="Contratos ganhos por produto"
          colunas={ps.map((p) => ({
            rotulo: p.rotulo,
            valor: p.ganhos,
            dica: {
              titulo: p.rotulo,
              linhas: [
                ["Ganhos", p.ganhos === null ? "sem dado" : String(p.ganhos)],
                ["Validadas", p.validadas === null ? "sem dado" : String(p.validadas)],
              ],
              periodo: "período filtrado",
              universo: "pipe de Monetização",
            },
          }))}
        />
      );
    }
    case "caixa": {
      const meses = (c.empresa.caixa?.emitidoRecebido?.meses ?? []).slice(-8);
      if (!meses.length)
        return (
          <SemDadoGrafico
            estado="fonte_indisponivel"
            motivo={c.empresa.caixaAviso ?? "Caixa não lido."}
            altura="h-20"
          />
        );
      return (
        <MiniColunas
          rotulo="Recebido por mês de emissão"
          colunas={meses.map((m, i) => ({
            rotulo: mesBr(m.mes),
            valor: m.leitura === "sem_foto" ? null : m.recebido,
            destaque: i === meses.length - 1,
            dica: {
              titulo: mesBr(m.mes),
              linhas: [
                ["Emitido", reaisCurto(m.emitido)],
                ["Recebido", m.leitura === "sem_foto" ? "não medido" : reaisCurto(m.recebido)],
              ],
              periodo: "mês de emissão",
              universo: "grupo (Financeiro)",
            },
          }))}
        />
      );
    }
  }
}

export function CartaoFrente({
  cockpit,
  frente,
  abrir,
}: {
  cockpit: Cockpit;
  frente: Frente;
  abrir: () => void;
}) {
  const e = useMemo(() => explicar(cockpit, `frente-${frente}`), [cockpit, frente]);
  if (!e) return null;
  return (
    <Bloco titulo={e.titulo} numero={e.valor ?? "—"} abrir={abrir}>
      <MiniGrafico cockpit={cockpit} frente={frente} />
    </Bloco>
  );
}
