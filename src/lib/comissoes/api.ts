// Chamadas às funções ops.comissoes_* (migration 20261023120000_comissoes_base). Cada função tira o
// ator de auth.uid() e confere a chave por conta própria; aqui só se chama e se devolve o erro do banco.
import { supabase } from "@/integrations/supabase/client";
import type { Exportacao } from "./planilha";
import type { Minhas, Perfil, Revisao } from "./tipos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- funções fora dos tipos gerados
const rpc = (nome: string, args?: Record<string, unknown>) => (supabase as any).rpc(nome, args);

async function chamar<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** "2026-11" ou "2026-11-01" -> "2026-11-01" */
export const diaDoMes = (mes: string) => `${mes.slice(0, 7)}-01`;

export const comissoes = {
  perfil: () => chamar<Perfil>("comissoes_perfil"),
  minhas: () => chamar<Minhas>("comissoes_minhas"),
  revisao: (mes: string) => chamar<Revisao>("comissoes_revisao", { p_mes: diaDoMes(mes) }),
  candidatos: () =>
    chamar<{ id: string; email: string; pessoa: string | null }[]>("comissoes_candidatos"),
  ajustar: (linha: number, base: number, percentual: number, motivo: string) =>
    chamar("comissoes_ajustar_linha", {
      p_linha: linha,
      p_base: base,
      p_percentual: percentual,
      p_motivo: motivo,
    }),
  excluir: (linha: number, motivo: string) =>
    chamar("comissoes_excluir_linha", { p_linha: linha, p_motivo: motivo }),
  restaurar: (linha: number, motivo: string) =>
    chamar("comissoes_restaurar_linha", { p_linha: linha, p_motivo: motivo }),
  incluirMetade: (contrato: number, metade: 1 | 2, motivo: string) =>
    chamar("comissoes_incluir_metade", {
      p_contrato: contrato,
      p_metade: metade,
      p_motivo: motivo,
    }),
  escolherParcela: (item: number, parcela: 1 | 2 | 3) =>
    chamar("comissoes_escolher_parcela", { p_item: item, p_parcela: parcela }),
  registrarData: (contrato: number, tipo: "assinatura" | "pagamento_cliente", dia: string) =>
    chamar("comissoes_registrar_data", { p_contrato: contrato, p_tipo: tipo, p_dia: dia }),
  lancarBonus: (pessoa: number, mes: string, valor: number, motivo: string, chave: string) =>
    chamar("comissoes_lancar_bonus", {
      p_pessoa: pessoa,
      p_mes: diaDoMes(mes),
      p_valor: valor,
      p_motivo: motivo,
      p_chave: chave,
    }),
  vincular: (pessoa: number, usuario: string | null) =>
    chamar("comissoes_vincular_pessoa", { p_pessoa: pessoa, p_usuario: usuario }),
  liberar: (mes: string) => chamar("comissoes_liberar_mes", { p_mes: diaDoMes(mes) }),
  marcarPago: (mes: string) => chamar("comissoes_marcar_pago", { p_mes: diaDoMes(mes) }),
  reabrir: (mes: string, motivo: string) =>
    chamar("comissoes_reabrir_mes", { p_mes: diaDoMes(mes), p_motivo: motivo }),
  exportar: (mes: string) => chamar<Exportacao>("comissoes_exportar_mes", { p_mes: diaDoMes(mes) }),
};

export const CHAVE_COMISSOES = ["comissoes"] as const;
