import type { KpiCardProps } from "@/components/planning";
import type { Comparacao, Estado, Indicador } from "@/lib/cockpit-ceo/contrato";
import { valorCurto } from "./estado";

// Um indicador do cockpit no KpiCard do Design System v2.
//
// O cálculo continua em lib/cockpit-ceo; aqui só a leitura: o estado do dado vira `estado` (nunca
// 0 no lugar de ausência, N4/V10), o ritmo da meta vira `meta` ao lado do valor (N13), o período
// anterior vira `delta` quando existe base, e o clique abre a composição (N2).

const ESTADO_KPI: Record<Estado, NonNullable<KpiCardProps["estado"]>> = {
  disponivel: "ok",
  parcial: "parcial",
  nao_apurado: "nao-apurado",
  fonte_indisponivel: "indisponivel",
  acesso_insuficiente: "sem-acesso",
};

const ehAnterior = (c: Comparacao) => c.rotulo.startsWith("Período anterior");
const ehMeta = (c: Comparacao) => c.rotulo.startsWith("Ritmo esperado da meta");

const curto = (c: Comparacao, i: Indicador) =>
  `${c.rotulo.replace("Ritmo esperado da", "Ritmo da")} ${valorCurto(c.referencia, i.unidade)}`;

export function cartaoDoIndicador(i: Indicador, onAbrir: () => void): KpiCardProps {
  const estado =
    i.valor === null && i.estado === "disponivel" ? "nao-apurado" : ESTADO_KPI[i.estado];
  const utilizaveis = i.comparacoes.filter(
    (c) => c.referencia !== null && c.estado !== "nao_apurado",
  );
  const anterior = utilizaveis.find(ehAnterior);
  const meta = utilizaveis.find(ehMeta);

  // Variação só com base diferente de zero (de 0 para 3 não é "+∞%", é nota) e com o período
  // anterior inteiro: janela que começa antes do primeiro evento do CRM não serve de base.
  const anteriorInteiro = anterior?.estado === "disponivel";
  const delta =
    anterior && anteriorInteiro && i.valor !== null && anterior.referencia
      ? {
          valor: ((i.valor - anterior.referencia) / anterior.referencia) * 100,
          rotulo: "vs período anterior",
        }
      : undefined;

  // A meta de R$ 1 bi não tem valor apurado: a meta e a média necessária vão na nota, junto de
  // quem destrava o número (N13: meta à vista mesmo sem realizado).
  const metaAnual =
    i.id === "meta-bilhao"
      ? i.comparacoes.find((c) => c.rotulo.startsWith("Meta anual"))
      : undefined;
  // Nota curta: uma informação, não um parágrafo. O resto (capacidade, meta anual, média
  // necessária) está na composição, a um clique.
  const notas: string[] = [];
  if (i.valor === null && i.lacuna) notas.push(`Depende de: ${i.lacuna.responsavel}`);
  // A base da variação fica escrita: "+1.100%" sem "anterior 1" engana.
  if (anterior)
    notas.push(
      `Anterior ${valorCurto(anterior.referencia, i.unidade)}${anteriorInteiro ? "" : " (parcial)"}`,
    );
  // Sem valor à vista o KpiCard esconde `meta`: o ritmo da meta passa para a nota.
  const mostraValor = estado === "ok" || estado === "parcial";
  if (meta && !mostraValor) notas.push(curto(meta, i));
  if (!notas.length && !i.periodo) notas.push("Fotografia de agora");

  return {
    rotulo: i.titulo,
    valor: i.valor === null ? "—" : valorCurto(i.valor, i.unidade),
    unidade: i.unidade !== "reais" && i.valor !== null ? i.unidade : undefined,
    estado,
    delta,
    meta: meta
      ? {
          valor: valorCurto(meta.referencia, i.unidade),
          rotulo: "ritmo da meta",
          progresso: i.valor !== null && meta.referencia ? i.valor / meta.referencia : undefined,
        }
      : metaAnual && i.valor !== null
        ? {
            valor: valorCurto(metaAnual.referencia, "reais"),
            rotulo: metaAnual.rotulo.toLowerCase(),
          }
        : undefined,
    nota: notas.join(" · ") || undefined,
    procedencia: { fonte: i.fonte, atualizadoEm: i.dataDado },
    abrir: { onClick: onAbrir, rotulo: "Ver composição" },
  };
}
