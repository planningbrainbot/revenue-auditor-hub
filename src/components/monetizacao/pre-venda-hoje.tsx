// Pré-venda › Hoje: "O que cada pré-vendedor faz hoje?" Visão padrão da aba desde 14/10/2026, para a daily (PRD da call
// com o Paulo, https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 3). Arquétipo Fila de trabalho: uma coluna por
// pré-vendedor, cartões que abrem a lista dos cards com o link do Pipedrive. Nada é calculado aqui: a régua mora em
// src/lib/monetizacao/hoje-pre-venda.ts.
import { KpiCard, KpiGrade, Secao } from "@/components/planning";
import { hojeDaPreVenda, type AtividadeCadencia } from "@/lib/monetizacao/hoje-pre-venda";
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
  hoje,
  pessoa,
  abrir,
}: {
  data: Pick<BaseMonetizacao, "cards" | "stages" | "units">;
  cadencias: Consulta<AtividadeCadencia[]>;
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
        </Secao>
      ))}
    </div>
  );
}
