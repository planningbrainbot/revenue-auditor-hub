// Construtores dos blocos de um tema (puros). Cada tema monta seus números, alertas e gráficos com
// estas funções, e a regra de estado fica num lugar só: ausência não é zero (N4), e fora de
// "disponivel"/"parcial" o valor é sempre null.
import type {
  AlertaCoo,
  Cobertura,
  Destino,
  Estado,
  Explicacao,
  GraficoCoo,
  Gravidade,
  NumeroCoo,
  SerieGrafico,
  TabelaDados,
  Tema,
  UnidadeContagem,
} from "./contrato.ts";

export interface BaseNumero {
  id: string;
  rotulo: string;
  unidade: UnidadeContagem;
  cobertura: Cobertura;
  fonte: string;
  explicacao: Explicacao;
  destino?: Destino | null;
}

export function numeroOk(
  base: BaseNumero,
  valor: number,
  extra: Partial<
    Pick<NumeroCoo, "nota" | "meta" | "delta" | "tendencia" | "tom" | "dados" | "dataDado" | "estado" | "motivo">
  > = {},
): NumeroCoo {
  return {
    ...base,
    destino: base.destino ?? null,
    valor,
    estado: extra.estado ?? "disponivel",
    dataDado: extra.dataDado ?? null,
    ...extra,
  };
}

export function numeroSem(
  base: BaseNumero,
  estado: Exclude<Estado, "disponivel">,
  motivo: string,
  extra: Partial<Pick<NumeroCoo, "nota" | "dataDado">> = {},
): NumeroCoo {
  return {
    ...base,
    destino: base.destino ?? null,
    valor: null,
    estado,
    motivo,
    dataDado: extra.dataDado ?? null,
    nota: extra.nota,
  };
}

export function alerta(
  tema: Tema,
  regra: string,
  gravidade: Gravidade,
  titulo: string,
  opcoes: { unidade?: string | null; peso?: number; destino?: Destino | null; limiar: string; periodo?: string },
): AlertaCoo {
  const unidade = opcoes.unidade ?? null;
  const partes = [tema, regra, unidade ?? "rede", opcoes.periodo ?? ""].map((p) =>
    p
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, ""),
  );
  return {
    chave: `coo:${partes.filter(Boolean).join(":")}`,
    regra,
    gravidade,
    titulo,
    unidade,
    peso: opcoes.peso ?? 0,
    destino: opcoes.destino ?? null,
    limiar: opcoes.limiar,
  };
}

export function grafico(
  base: {
    id: string;
    titulo: string;
    tipo: GraficoCoo["tipo"];
    series: SerieGrafico[];
    unidade: UnidadeContagem;
    fonte: string;
    explicacao: Explicacao;
    destino?: Destino | null;
  },
  pontos: GraficoCoo["pontos"],
  extra: { estado?: Estado; motivo?: string; dataDado?: string | null } = {},
): GraficoCoo {
  return {
    ...base,
    destino: base.destino ?? null,
    pontos,
    estado: extra.estado ?? (pontos.length ? "disponivel" : "nao_apurado"),
    motivo: extra.motivo ?? (pontos.length ? undefined : "a fonte não trouxe nenhum ponto no recorte"),
    dataDado: extra.dataDado ?? null,
  };
}

export function tabela(colunas: string[], linhas: TabelaDados["linhas"]): TabelaDados {
  return { colunas, linhas };
}

/** Destino interno com o mesmo recorte ou não (N2: a tela avisa quando o total pode diferir). */
export function destino(
  rota: string,
  rotulo: string,
  mesmoRecorte: boolean,
  observacao: string,
  search: Record<string, string> = {},
): Destino {
  return { rota, rotulo, mesmoRecorte, observacao, search };
}

/** Soma em centavos inteiros (somar reais em ponto flutuante dava 600,5999…). */
export function somaReais(valores: (number | null | undefined)[]): number {
  return valores.reduce<number>((s, v) => s + Math.round(Number(v ?? 0) * 100), 0) / 100;
}

/** Primeiro dia do mês de uma data ISO. */
export const inicioDoMes = (iso: string) => `${iso.slice(0, 7)}-01`;

/** Mês anterior (YYYY-MM) de um mês (YYYY-MM). */
export function mesAnterior(mes: string): string {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** Trimestre (1–4) e rótulo "T3/2026" de uma data ISO. */
export function trimestre(iso: string): { ano: number; t: number; rotulo: string } {
  const ano = Number(iso.slice(0, 4));
  const t = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
  return { ano, t, rotulo: `T${t}/${ano}` };
}

/** Janela [de, ate] (datas ISO, início e fim de mês) em blocos de até `tamanho` meses. */
export function blocosDeMeses(de: string, ate: string, tamanho: number): [string, string][] {
  const out: [string, string][] = [];
  let a = Number(de.slice(0, 4)) * 12 + Number(de.slice(5, 7)) - 1;
  const fim = Number(ate.slice(0, 4)) * 12 + Number(ate.slice(5, 7)) - 1;
  const iso = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  const ultimoDia = (m: number) => new Date(Date.UTC(Math.floor(m / 12), (m % 12) + 1, 0)).toISOString().slice(0, 10);
  while (a <= fim) {
    const b = Math.min(a + tamanho - 1, fim);
    out.push([`${iso(a)}-01`, b === fim ? ate : ultimoDia(b)]);
    a = b + 1;
  }
  return out;
}
