// Visão geral dos OKRs: agregação pura sobre DepartamentoOkr. Portado do Growth
// (`brain-web/src/lib/okrs/dashboard.ts`) sem mudança de régua: ciclo fixo de 01/08 a 31/12/2026,
// esperado linear, média simples das KRs medidas, faixas de cor iguais às da tela de OKRs.
import { medicaoKr } from "./tipos.ts";
import type { DepartamentoOkr, Kr, OrigemMedicao } from "./tipos.ts";

export const CICLO = { inicio: "2026-08-01", fim: "2026-12-31" };

export type FaixaCor = "green" | "cyan" | "yellow" | "red";

export const corProgresso = (p: number): FaixaCor =>
  p >= 0.995 ? "green" : p >= 0.6 ? "cyan" : p >= 0.3 ? "yellow" : "red";

/** Fração do ciclo decorrida no dia (YYYY-MM-DD), contando o dia corrente, em [0, 1]. */
export function fracaoEsperada(hojeIso: string, ciclo = CICLO): number {
  const dia = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
  const total = dia(ciclo.fim) - dia(ciclo.inicio) + 1;
  const passados = dia(hojeIso) - dia(ciclo.inicio) + 1;
  return Math.min(Math.max(passados / total, 0), 1);
}

/** Listas que vivem nas pastas mas não são objetivos (por id: renomear não muda a conta). */
export const LISTAS_FORA_DO_AGREGADO = new Set([
  "901715565560", // Auditoria & Qualidade · "Solicitações Comercial"
]);

export interface KrClassificada {
  kr: Kr;
  departamento: string;
  pastaId: string;
  objetivo: string;
  medicao: { progresso: number; origem: OrigemMedicao } | null;
}

export function listarKrs(departamentos: DepartamentoOkr[]): KrClassificada[] {
  return departamentos.flatMap((d) =>
    d.objetivos
      .filter((o) => !LISTAS_FORA_DO_AGREGADO.has(o.listaId))
      .flatMap((o) =>
        o.krs.map((kr) => ({
          kr,
          departamento: d.nome,
          pastaId: d.pastaId,
          objetivo: o.nome,
          medicao: medicaoKr(kr),
        })),
      ),
  );
}
