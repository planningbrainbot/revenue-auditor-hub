import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Adoção do Planning People por unidade (migration 77, no repo do wiki).
//
// É o instrumento de quem implanta o módulo na rede. Responde "onde pegou e
// onde não saiu do chão" sem abrir a linha de sentimento, prioridade, 1:1 ou
// feedback de ninguém: a view é agregada e não tem nome dentro.
//
// O gate está dentro da própria view (`view.gente.agregado` mais escopo de
// unidade), porque view no Ops roda com os direitos do dono.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface AdocaoRow {
  unidadeId: number;
  unidade: string;
  pessoas: number;
  comLogin: number;
  pulsoNaSemana: number;
  pulsoEm30Dias: number;
  prioridadesNaSemana: number;
  com1a1Em90Dias: number;
  comPdi: number;
  comPdiComMeta: number;
  avaliadosEmCiclo: number;
}

export const listAdocao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdocaoRow[]> => {
    const supabase = context.supabase as Cliente;
    const res = await supabase
      .from("v_gente_adocao_por_unidade")
      .select("*")
      .order("pessoas", { ascending: false });

    return (
      (res?.data ?? []) as {
        unidade_id: number;
        unidade: string;
        pessoas: number;
        com_login: number;
        pulso_na_semana: number;
        pulso_em_30_dias: number;
        prioridades_na_semana: number;
        com_1a1_em_90_dias: number;
        com_pdi: number;
        com_pdi_com_meta: number;
        avaliados_em_ciclo: number;
      }[]
    ).map((linha) => ({
      unidadeId: linha.unidade_id,
      unidade: linha.unidade,
      pessoas: linha.pessoas,
      comLogin: linha.com_login,
      pulsoNaSemana: linha.pulso_na_semana,
      pulsoEm30Dias: linha.pulso_em_30_dias,
      prioridadesNaSemana: linha.prioridades_na_semana,
      com1a1Em90Dias: linha.com_1a1_em_90_dias,
      comPdi: linha.com_pdi,
      comPdiComMeta: linha.com_pdi_com_meta,
      avaliadosEmCiclo: linha.avaliados_em_ciclo,
    }));
  });
