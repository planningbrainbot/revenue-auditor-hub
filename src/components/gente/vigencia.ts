import type { TomStatus } from "@/components/planning";
import { diasDeCasa } from "./tempo-de-casa";

// Vigência do contrato de estágio (TCE) e de terceiro (pedido do RH de Maceió,
// 13/10/2026): o cadastro exige as datas e a plataforma avisa antes do fim. O
// e-mail diário ao RH sai da Edge Function `gente-vigencia-alertas` (30 e 15 dias
// antes e no dia); aqui ficam os campos e a leitura da situação na tela.

export const VINCULOS_COM_VIGENCIA = ["estagio", "terceiro"];
export const exigeVigencia = (vinculo: string | null | undefined) =>
  !!vinculo && VINCULOS_COM_VIGENCIA.includes(vinculo);

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");

/** Dias até o fim (negativo: venceu). */
export const diasAteFim = (fim: string) => -(diasDeCasa(fim) ?? 0);

/**
 * Estágio passa de 2 anos na mesma empresa (Lei 11.788/2008, art. 11), contados
 * da admissão ou, sem ela, do início da vigência.
 */
export function passaDoisAnos(p: {
  tipoVinculo: string | null;
  dataAdmissao: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
}): boolean {
  const desde = p.dataAdmissao ?? p.vigenciaInicio;
  if (p.tipoVinculo !== "estagio" || !desde || !p.vigenciaFim) return false;
  const limite = new Date(`${desde.slice(0, 10)}T12:00:00`);
  limite.setFullYear(limite.getFullYear() + 2);
  return new Date(`${p.vigenciaFim.slice(0, 10)}T12:00:00`) > limite;
}

export type FaixaVigencia = "vencido" | "vence30" | "em_dia" | "sem";

/** Em que faixa a pessoa está. Só vale para estágio e terceiro ativos ou afastados. */
export function faixaVigencia(p: {
  tipoVinculo: string | null;
  status: string;
  vigenciaFim: string | null;
}): FaixaVigencia | null {
  if (!exigeVigencia(p.tipoVinculo) || p.status === "desligado") return null;
  if (!p.vigenciaFim) return "sem";
  const d = diasAteFim(p.vigenciaFim);
  if (d < 0) return "vencido";
  if (d <= 30) return "vence30";
  return "em_dia";
}

export function situacaoVigencia(fim: string | null): {
  tom: TomStatus;
  texto: string;
  ordem: number;
} {
  if (!fim) return { tom: "neutro", texto: "sem vigência informada", ordem: 100_000 };
  const d = diasAteFim(fim);
  if (d < 0) return { tom: "perigo", texto: `venceu em ${fmt(fim)}`, ordem: d };
  if (d === 0) return { tom: "perigo", texto: "vence hoje", ordem: 0 };
  if (d <= 15) return { tom: "atencao", texto: `vence em ${d} dia${d === 1 ? "" : "s"}`, ordem: d };
  if (d <= 30) return { tom: "info", texto: `vence em ${d} dias`, ordem: d };
  return { tom: "sucesso", texto: `até ${fmt(fim)}`, ordem: d };
}

/**
 * Nome da data de início conforme o vínculo (ajuste do RH de Maceió, 19/10/2026):
 * uma data só, a admissão, chamada pelo que ela é em cada contrato.
 */
export function rotuloInicio(vinculo: string | null | undefined): string {
  if (vinculo === "estagio") return "Início do estágio";
  if (vinculo === "terceiro" || vinculo === "pj") return "Início do contrato";
  if (vinculo === "socio") return "Início na sociedade";
  return "Admissão";
}

/** Nome do valor conforme o vínculo: o dado é o mesmo (remuneração), muda o rótulo. */
export function rotuloValor(vinculo: string | null | undefined): string {
  if (vinculo === "estagio") return "Valor da bolsa";
  if (vinculo === "terceiro" || vinculo === "pj") return "Valor do contrato";
  if (vinculo === "socio" || vinculo === "prolabore") return "Pró-labore";
  return "Salário";
}
