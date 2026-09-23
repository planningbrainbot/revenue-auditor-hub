// Período e perímetro do cockpit, lidos da URL.
//
// Nenhum preset fixa mês: tudo parte de "hoje" em São Paulo, que quem chama informa. O filtro
// mensal não vira meta anual, e período inválido na URL não derruba a página: volta ao mês
// corrente e diz por quê.
import { dias } from "../monetizacao/model.ts";
import { ORDEM_FRENTES } from "./contrato.ts";
import type { Frente } from "./contrato.ts";

export type PresetPeriodo = "mes" | "mes_anterior" | "trimestre" | "ano" | "personalizado";

export const PRESETS: Record<PresetPeriodo, string> = {
  mes: "Mês atual",
  mes_anterior: "Mês anterior",
  trimestre: "Trimestre atual",
  ano: "Ano atual",
  personalizado: "Personalizado",
};

export interface Periodo {
  preset: PresetPeriodo;
  de: string;
  ate: string;
  rotulo: string;
}

export interface BuscaCockpit {
  periodo: string;
  de: string;
  ate: string;
  /** "" = rede inteira no escopo da pessoa; senão, a chave da unidade. */
  perimetro: string;
  frente: Frente | "";
  indicador: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const somaDias = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const ultimoDia = (mes: string) =>
  new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
export const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function montar(preset: PresetPeriodo, de: string, ate: string): Periodo {
  return { preset, de, ate, rotulo: `${dataBr(de)} a ${dataBr(ate)}` };
}

export function resolverPeriodo(
  busca: { periodo?: string; de?: string; ate?: string },
  hoje: string,
): Periodo & { aviso: string | null } {
  const mes = hoje.slice(0, 7);
  const padrao = { ...montar("mes", mes + "-01", hoje), aviso: null as string | null };
  switch (busca.periodo) {
    case undefined:
    case "":
    case "mes":
      return padrao;
    case "mes_anterior": {
      const fimAnterior = somaDias(mes + "-01", -1);
      return {
        ...montar("mes_anterior", fimAnterior.slice(0, 7) + "-01", fimAnterior),
        aviso: null,
      };
    }
    case "trimestre": {
      const inicio = `${hoje.slice(0, 4)}-${String(Math.floor((Number(hoje.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
      return { ...montar("trimestre", inicio, hoje), aviso: null };
    }
    case "ano":
      return { ...montar("ano", hoje.slice(0, 4) + "-01-01", hoje), aviso: null };
    case "personalizado": {
      const de = busca.de ?? "";
      let ate = busca.ate ?? "";
      let aviso: string | null = null;
      if (ISO.test(ate) && ate > hoje) {
        ate = hoje;
        aviso =
          "O período terminava depois de hoje e foi encerrado hoje: não há realizado no futuro.";
      }
      try {
        if (!ISO.test(de) || de > hoje) throw new Error();
        dias(de, ate);
      } catch {
        return {
          ...padrao,
          aviso:
            "Período personalizado inválido (data inexistente, início depois do fim ou mais de três anos). Mostrando o mês atual.",
        };
      }
      return { ...montar("personalizado", de, ate), aviso };
    }
    default:
      return { ...padrao, aviso: "Período desconhecido na URL. Mostrando o mês atual." };
  }
}

/** O período comparável: mesma quantidade de dias, terminando na véspera do início. */
export function periodoAnterior(p: { de: string; ate: string }): { de: string; ate: string } {
  const n = dias(p.de, p.ate).length;
  const ate = somaDias(p.de, -1);
  return { de: somaDias(ate, -(n - 1)), ate };
}

/** O plano de Monetização é mensal: só se compara a um período que começa no dia 1 de um mês. */
export function mesDoPeriodo(p: {
  de: string;
  ate: string;
}): { mes: string; completo: boolean } | null {
  const mes = p.de.slice(0, 7);
  if (!p.de.endsWith("-01") || p.ate.slice(0, 7) !== mes) return null;
  return { mes, completo: p.ate === ultimoDia(mes) };
}

/** O que vai na URL: só os campos preenchidos, para o endereço compartilhado ficar legível. */
export type BuscaUrl = Partial<BuscaCockpit>;

/**
 * `validateSearch` das rotas do cockpit. Campo vazio não vai para a URL: se fosse, o router
 * redirecionaria toda visita para `?periodo=&de=&...`. A página normaliza com `validarBusca`.
 */
export function buscaDaUrl(s: Record<string, unknown>): BuscaUrl {
  return Object.fromEntries(Object.entries(validarBusca(s)).filter(([, v]) => v)) as BuscaUrl;
}

export function validarBusca(s: Record<string, unknown>): BuscaCockpit {
  const texto = (v: unknown, max = 80) => (typeof v === "string" && v.length <= max ? v : "");
  const periodo = texto(s.periodo);
  const perimetro = texto(s.perimetro);
  const frente = texto(s.frente);
  return {
    // Valor desconhecido passa adiante: `resolverPeriodo` volta ao mês atual e diz por quê.
    periodo,
    de: texto(s.de, 10),
    ate: texto(s.ate, 10),
    perimetro: perimetro === "rede" ? "" : perimetro,
    frente: (ORDEM_FRENTES as string[]).includes(frente) ? (frente as Frente) : "",
    indicador: texto(s.indicador, 60),
  };
}
