// Pré-venda › Hoje: "O que cada pré-vendedor faz hoje?" Visão padrão da aba desde 14/10/2026, para a daily (PRD da call
// com o Paulo, https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 3). Arquétipo Fila de trabalho: uma coluna por
// pré-vendedor, cartões que abrem a lista dos cards com o link do Pipedrive. Nada é calculado aqui: a régua mora em
// src/lib/monetizacao/hoje-pre-venda.ts.
import { ExternalLink } from "lucide-react";
import { KpiCard, KpiGrade, Secao, StatusBadge } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  hojeDaPreVenda,
  rotuloDaUrgencia,
  rotuloDoPasso,
  type AtividadeCadencia,
  type ParadoComSugestao,
  type SugestaoJev,
} from "@/lib/monetizacao/hoje-pre-venda";
import { ddmm, primeiroNome } from "@/lib/monetizacao/pre-venda";
import type { BaseMonetizacao, Negocio } from "@/lib/monetizacao/types";
import { cn } from "@/lib/utils";
import { estadoDaLeitura, INT, type Consulta } from "./pre-venda-comum";

export type AbrirCards = (
  titulo: string,
  cards: Negocio[],
  opcoes?: { estoque?: boolean; recorte?: string },
) => void;

export function HojePreVenda({
  data,
  cadencias,
  sugestoes,
  hoje,
  pessoa,
  abrir,
}: {
  data: Pick<BaseMonetizacao, "cards" | "stages" | "units">;
  cadencias: Consulta<AtividadeCadencia[]>;
  /** Sugestões do Jev; se a leitura falhar, a visão segue sem elas. */
  sugestoes?: Consulta<SugestaoJev[]>;
  hoje: string;
  pessoa?: number;
  abrir: AbrirCards;
}) {
  const estado = estadoDaLeitura({
    consultas: [cadencias],
    fonte: "atividades da cadência",
    variante: "kpis",
  });
  if (estado) return estado;
  const pessoas = hojeDaPreVenda({
    cards: data.cards,
    stages: data.stages,
    units: data.units,
    atividades: cadencias.data!,
    hoje,
    pessoa,
    sugestoes: sugestoes?.data ?? [],
  });
  return (
    <div className={cn("grid gap-6", pessoas.length > 1 && "xl:grid-cols-2")}>
      {pessoas.map((p) => (
        <Secao
          key={p.id}
          titulo={p.nome}
          descricao={`Hoje, ${ddmm(hoje)} · cards sob a responsabilidade de ${primeiroNome(p.nome)} agora e as cadências ativas`}
        >
          <KpiGrade colunas={2}>
            {p.blocos.map((b) => (
              <KpiCard
                key={b.chave}
                rotulo={b.rotulo}
                valor={INT.format(b.valor)}
                nota={b.nota}
                tom={b.tom}
                abrir={
                  b.cards.length
                    ? {
                        onClick: () =>
                          abrir(`${primeiroNome(p.nome)} · ${b.rotulo}`, b.cards, {
                            estoque: true,
                            recorte: `hoje, ${ddmm(hoje)}`,
                          }),
                        rotulo: "Ver os cards",
                      }
                    : undefined
                }
              />
            ))}
          </KpiGrade>
          {p.parados.length > 0 && (
            <ProximoPasso parados={p.parados} carregando={!!sugestoes?.carregando} />
          )}
        </Secao>
      ))}
    </div>
  );
}

const TOM_URGENCIA = ["neutro", "atencao", "perigo"] as const;

/** A reta final sem próximo passo, com a sugestão do Jev ao lado de cada card (14/10/2026). Só sugere: nada vai ao CRM. */
function ProximoPasso({
  parados,
  carregando,
}: {
  parados: ParadoComSugestao[];
  carregando: boolean;
}) {
  const avaliados = parados.filter((p) => p.sugestao).length;
  return (
    <div className="mt-3 overflow-hidden rounded-xl border bg-card">
      <div className="space-y-0.5 px-4 pt-3">
        <h3 className="text-sm font-semibold text-foreground">Próximo passo sugerido pelo Jev</h3>
        <p className="text-[13px] text-muted-foreground">
          {carregando
            ? "Carregando as sugestões."
            : `${INT.format(avaliados)} de ${INT.format(parados.length)} cards avaliados pelas notas do responsável, pela etapa e pelos dias parado. É sugestão: o passo é decidido na daily.`}
        </p>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Card</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right">Dias parado</TableHead>
              <TableHead>Sugestão</TableHead>
              <TableHead>Urgência</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parados.map(({ card, dias, sugestao }) => (
              <TableRow key={card.id}>
                <TableCell className="max-w-[240px] overflow-hidden">
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex max-w-full items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    <span className="min-w-0 truncate">{card.org ?? card.title}</span>
                    <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  </a>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {card.stage.replace(/^\d+\s*·\s*/, "")}
                </TableCell>
                <TableCell className="num text-right">
                  {dias === null ? "—" : INT.format(dias)}
                </TableCell>
                <TableCell className="text-sm">
                  {sugestao ? rotuloDoPasso(sugestao.passo) : "ainda não avaliado"}
                  {sugestao && sugestao.confianca !== null && sugestao.confianca < 0.4 && (
                    <span className="block text-xs text-muted-foreground">confiança baixa</span>
                  )}
                </TableCell>
                <TableCell>
                  {sugestao ? (
                    <StatusBadge tom={TOM_URGENCIA[sugestao.urgencia] ?? "neutro"}>
                      {rotuloDaUrgencia(sugestao.urgencia)}
                    </StatusBadge>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
