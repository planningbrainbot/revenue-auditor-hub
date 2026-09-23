// Retenção de logo por coorte de mês de ganho.
//
// Denominador: contratos ganhos no pipeline de vendas em cada mês (ops.contratos, que o sync grava
// para todo negócio ganho e não apaga quando o cliente sai — "Ativo" ali é rótulo fixo, não estado).
// Saída: churn registrado na Central de Tratativas (status perdido), pela data do churn, pelo mesmo
// vínculo de negócio do Pipedrive que a tela de Clientes usa.
//
// Regras de honestidade:
//   · o denominador não muda com o tempo; só churn datado reduz os meses seguintes;
//   · mês corrente e meses futuros ficam vazios, nunca 100%;
//   · mês anterior ao início do registro de churn fica vazio — ausência de registro não é retenção;
//   · churn sem data não entra em mês nenhum e deixa a coorte parcial (a retenção real é menor);
//   · coorte com menos de 90 dias ainda pode mudar: o sync remove negócio que deixa de ser ganho.
import type { Estado } from "./contrato.ts";
import { mesBr } from "./receita.ts";

export interface ContratoCoorte {
  /** Negócio do Pipedrive: o vínculo com a Central de Tratativas. */
  deal: string;
  ganho_em: string;
  unidade: string | null;
  origem: string | null;
}

export interface ChurnCoorte {
  deal: string;
  data_churn: string | null;
}

export interface LinhaCoorte {
  mes: string;
  denominador: number;
  /** Retidos no fim de cada mês a partir do mês do ganho (k = 0…horizonte); null = sem medida. */
  retidos: (number | null)[];
  churnsSemData: number;
  recente: boolean;
}

export interface Coortes {
  estado: Estado;
  inicioRegistroChurn: string | null;
  horizonte: number;
  linhas: LinhaCoorte[];
  foraDaOrigem: { origem: string; contratos: number }[];
  foraDeRegional: number;
  churnsSemContrato: number;
  churnsAntesDoGanho: number;
  avisos: string[];
}

/** Resposta de carregarRetencaoCockpit: a matriz agregada, ou por que não há número. */
export type RespostaRetencao =
  | { estado: "ok"; coortes: Coortes; lidoEm: string }
  | { estado: "acesso_insuficiente" | "fonte_indisponivel"; motivo: string; lidoEm: string };

/** Origem que entra na coorte: negócio ganho pelo pipeline de vendas no mês. */
export const ORIGEM_VENDAS = "inside_sales";

const somaMeses = (m: string, n: number) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 7);

export function montarCoortes(e: {
  contratos: ContratoCoorte[];
  churns: ChurnCoorte[];
  regionais: string[];
  hoje: string;
  horizonte?: number;
  meses?: number;
}): Coortes {
  const horizonte = e.horizonte ?? 12;
  const regionais = new Set(e.regionais);
  const mesAtual = e.hoje.slice(0, 7);
  const ultimoFechado = somaMeses(mesAtual, -1);
  const d90 = new Date(`${e.hoje}T12:00:00Z`);
  d90.setUTCDate(d90.getUTCDate() - 90);
  const corteRecente = d90.toISOString().slice(0, 7);

  // Universo: vendas, unidade regional, primeiro ganho de cada negócio.
  const foraOrigem = new Map<string, number>();
  let foraDeRegional = 0;
  const ganho = new Map<string, string>();
  for (const c of e.contratos) {
    if (!c.deal || !/^\d{4}-\d{2}-\d{2}/.test(c.ganho_em)) continue;
    if (!regionais.has(c.unidade ?? "")) {
      foraDeRegional++;
      continue;
    }
    if (c.origem !== ORIGEM_VENDAS) {
      const o = c.origem ?? "(sem origem)";
      foraOrigem.set(o, (foraOrigem.get(o) ?? 0) + 1);
      continue;
    }
    const atual = ganho.get(c.deal);
    if (!atual || c.ganho_em < atual) ganho.set(c.deal, c.ganho_em);
  }

  const datas = e.churns.map((c) => c.data_churn).filter((d): d is string => !!d);
  const inicioRegistroChurn = datas.length ? datas.sort()[0].slice(0, 7) : null;
  const churnDoDeal = new Map<string, string | null>();
  let churnsSemContrato = 0;
  for (const c of e.churns) {
    if (!ganho.has(c.deal)) {
      churnsSemContrato++;
      continue;
    }
    const antes = churnDoDeal.get(c.deal);
    // Mais de um churn para o mesmo negócio: vale o primeiro datado.
    if (antes === undefined || (c.data_churn && (!antes || c.data_churn < antes)))
      churnDoDeal.set(c.deal, c.data_churn);
  }

  const porMes = new Map<string, string[]>();
  for (const [deal, data] of ganho) {
    const m = data.slice(0, 7);
    if (m > mesAtual) continue;
    porMes.set(m, [...(porMes.get(m) ?? []), deal]);
  }
  const meses = [...porMes.keys()].sort().slice(-(e.meses ?? 15));

  let churnsAntesDoGanho = 0;
  const linhas: LinhaCoorte[] = meses.map((mes) => {
    const deals = porMes.get(mes)!;
    let semData = 0;
    const saidas: string[] = [];
    for (const d of deals) {
      if (!churnDoDeal.has(d)) continue;
      const data = churnDoDeal.get(d);
      if (!data) {
        semData++;
        continue;
      }
      let m = data.slice(0, 7);
      if (m < mes) {
        churnsAntesDoGanho++;
        m = mes;
      }
      saidas.push(m);
    }
    const retidos = Array.from({ length: horizonte + 1 }, (_, k) => {
      const t = somaMeses(mes, k);
      if (t > ultimoFechado) return null;
      if (!inicioRegistroChurn || t < inicioRegistroChurn) return null;
      return deals.length - saidas.filter((s) => s <= t).length;
    });
    return {
      mes,
      denominador: deals.length,
      retidos,
      churnsSemData: semData,
      recente: mes >= corteRecente,
    };
  });

  const avisos: string[] = [
    "Coorte de contratos ganhos no pipeline de vendas, por mês do ganho, só unidades regionais. Retido = sem churn registrado na Central de Tratativas até o fim do mês.",
  ];
  if (inicioRegistroChurn)
    avisos.push(
      `O registro de churn com data começa em ${mesBr(inicioRegistroChurn)}: meses anteriores ficam vazios, não 100%.`,
    );
  else avisos.push("Nenhum churn com data registrado: nenhuma célula pode ser medida.");
  const semData = linhas.reduce((s, l) => s + l.churnsSemData, 0);
  if (semData)
    avisos.push(
      `${semData} ${semData === 1 ? "churn sem data não entra" : "churns sem data não entram"} em mês nenhum: nas coortes marcadas, a retenção real é menor que a mostrada.`,
    );
  if (foraOrigem.size)
    avisos.push(
      `Fora da coorte por origem: ${[...foraOrigem].map(([o, n]) => `${o} (${n})`).join(", ")} — lote de outro pipe, com data de ganho que não é a da venda.`,
    );
  if (churnsSemContrato)
    avisos.push(
      `${churnsSemContrato} ${churnsSemContrato === 1 ? "churn não casa" : "churns não casam"} com contrato ganho de venda regional e ficam fora.`,
    );
  if (churnsAntesDoGanho)
    avisos.push(
      `${churnsAntesDoGanho} ${churnsAntesDoGanho === 1 ? "churn tem" : "churns têm"} data anterior ao ganho e ${churnsAntesDoGanho === 1 ? "conta" : "contam"} no mês do ganho.`,
    );
  if (linhas.some((l) => l.recente))
    avisos.push(
      "Coortes com menos de 90 dias ainda podem mudar: o sync remove negócio que deixou de ser ganho.",
    );

  const temCelula = linhas.some((l) => l.retidos.some((r) => r !== null));
  const estado: Estado = !linhas.length
    ? "nao_apurado"
    : !temCelula
      ? "nao_apurado"
      : semData || linhas.some((l) => l.recente) || linhas.some((l) => l.retidos[0] === null)
        ? "parcial"
        : "disponivel";
  return {
    estado,
    inicioRegistroChurn,
    horizonte,
    linhas,
    foraDaOrigem: [...foraOrigem].map(([origem, contratos]) => ({ origem, contratos })),
    foraDeRegional,
    churnsSemContrato,
    churnsAntesDoGanho,
    avisos,
  };
}
