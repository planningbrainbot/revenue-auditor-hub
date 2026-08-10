import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  addItemManual,
  addOutraReceitaItem,
  atualizarCnpjContrato,
  deleteItem,
  deleteOutraReceitaItem,
  excluirItemMes,
  fecharApuracao,
  garantirApuracoesAno,
  gerarItensApuracao,
  getApuracao,
  getOrCreateApuracao,
  listRoyaltiesUnidades,
  marcarChurn,
  reabrirApuracao,
  reincluirItemMes,
  updateApuracao,
  updateItem,
  updateOutraReceitaItem,
} from "@/lib/royalties.functions";
import { listRoyaltiesHistoricoRede } from "@/lib/royalties-historico.functions";
import { listRoyaltiesProjecaoRede } from "@/lib/royalties-projecao.functions";

// Default error handler — garante que falhas silenciosas sempre virem toast.
const defaultOnError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : "Erro inesperado";
  toast.error(msg);
};

export function useRoyaltiesUnidades(mes: string) {
  const fn = useServerFn(listRoyaltiesUnidades);
  return useQuery({
    queryKey: ["royalties", "unidades", mes],
    queryFn: () => fn({ data: { mes } }),
    staleTime: 30_000,
  });
}

// Histórico de royalties por cliente (cross-unidade, todos os meses já
// apurados) + evolução mensal — alimenta a página `/royalties`.
export function useRoyaltiesHistoricoRede() {
  const fn = useServerFn(listRoyaltiesHistoricoRede);
  return useQuery({
    queryKey: ["royalties", "historico-rede"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

export function useRoyaltiesProjecaoRede() {
  const fn = useServerFn(listRoyaltiesProjecaoRede);
  return useQuery({
    queryKey: ["royalties", "projecao-rede"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useApuracao(apuracaoId: number | null) {
  const fn = useServerFn(getApuracao);
  return useQuery({
    queryKey: ["royalties", "apuracao", apuracaoId],
    queryFn: () => fn({ data: { apuracao_id: apuracaoId! } }),
    enabled: !!apuracaoId,
    staleTime: 10_000,
  });
}

export function useGetOrCreate() {
  const fn = useServerFn(getOrCreateApuracao);
  return useMutation({
    mutationFn: (vars: { unidade_id: number; mes: string }) => fn({ data: vars }),
    onError: defaultOnError,
  });
}

export function useGerarItens() {
  const fn = useServerFn(gerarItensApuracao);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { apuracao_id: number; force?: boolean }) => fn({ data: vars }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["royalties", "apuracao", vars.apuracao_id] });
      qc.invalidateQueries({ queryKey: ["royalties", "unidades"] });
    },
    onError: defaultOnError,
  });
}

export function useUpdateItem(apuracaoId: number) {
  const fn = useServerFn(updateItem);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof updateItem>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useAtualizarCnpjContrato(apuracaoId: number) {
  const fn = useServerFn(atualizarCnpjContrato);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof atualizarCnpjContrato>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useMarcarChurn(apuracaoId: number) {
  const fn = useServerFn(marcarChurn);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof marcarChurn>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useAddItem(apuracaoId: number) {
  const fn = useServerFn(addItemManual);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof addItemManual>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useDeleteItem(apuracaoId: number) {
  const fn = useServerFn(deleteItem);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useExcluirItem(apuracaoId: number) {
  const fn = useServerFn(excluirItemMes);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item_id: number; motivo: string }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useReincluirItem(apuracaoId: number) {
  const fn = useServerFn(reincluirItemMes);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item_id: number }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useUpdateApuracao(apuracaoId: number) {
  const fn = useServerFn(updateApuracao);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof updateApuracao>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useFecharApuracao(apuracaoId: number) {
  const fn = useServerFn(fecharApuracao);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { id: apuracaoId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["royalties"] });
    },
    onError: defaultOnError,
  });
}

export function useReabrirApuracao(apuracaoId: number) {
  const fn = useServerFn(reabrirApuracao);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { id: apuracaoId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["royalties"] });
    },
    onError: defaultOnError,
  });
}

export function useAddOutraReceita(apuracaoId: number) {
  const fn = useServerFn(addOutraReceitaItem);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof addOutraReceitaItem>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useUpdateOutraReceita(apuracaoId: number) {
  const fn = useServerFn(updateOutraReceitaItem);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof updateOutraReceitaItem>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

export function useDeleteOutraReceita(apuracaoId: number) {
  const fn = useServerFn(deleteOutraReceitaItem);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["royalties", "apuracao", apuracaoId] }),
    onError: defaultOnError,
  });
}

// ============ useRoyaltiesPorUnidade ============
// Componentes de receita por unidade/mês vindos direto da apuração — fonte
// única pra Royalties/CSC/CAC/Mídia/Outras na aba Receitas/DRE Partners
// (substitui entrada manual). Chave do Map: "NomeUnidade|MM" (mês com 2
// dígitos), mas o MM usado é o mês de reconhecimento no caixa — a apuração
// de um mês M só vira receita em M+1 (fatura fechada num mês, recebida no
// seguinte), então o mês da apuração é deslocado +1 antes de virar chave.
export type ApuracaoValor = { valor: number; realizado: boolean };
export type RoyaltiesPorUnidadeInfo = {
  status: string;
  royalties: ApuracaoValor;
  csc: ApuracaoValor;
  cac: ApuracaoValor;
  midia: ApuracaoValor;
  outras: ApuracaoValor;
};

/** Mês de referência da apuração (YYYY-MM-01) → mês em que a receita é reconhecida (M+1), como "YYYY-MM". */
function mesReconhecimento(mesReferencia: string): { ano: number; mes: string } {
  const [y, m] = mesReferencia.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 1 + 1, 1); // +1 mês, com rollover de ano automático
  return { ano: d.getFullYear(), mes: String(d.getMonth() + 1).padStart(2, "0") };
}

export function useRoyaltiesPorUnidade(ano: number) {
  return useQuery({
    queryKey: ["royalties", "por-unidade", ano],
    queryFn: async () => {
      const [uRes, apRes] = await Promise.all([
        supabase.from("unidades").select("id,nome_da_praca").eq("tipo", "regional"),
        supabase
          .from("royalties_apuracao")
          .select(
            "unidade_id,mes_referencia,status,royalties_valor,cac_valor,csc_valor_fixo,csc_percentual_base_antiga,csc_base_antiga_valor,csc_trafego_pago,outras_receitas",
          )
          // Inclui dezembro do ano anterior — sua receita é reconhecida em
          // janeiro do ano corrente por causa do deslocamento de +1 mês.
          .gte("mes_referencia", `${ano - 1}-12-01`)
          .lte("mes_referencia", `${ano}-12-31`),
      ]);
      if (uRes.error) throw uRes.error;
      if (apRes.error) throw apRes.error;

      const nomePorUnidadeId = new Map<number, string>();
      (uRes.data ?? []).forEach((u: any) => nomePorUnidadeId.set(u.id, u.nome_da_praca));

      const map = new Map<string, RoyaltiesPorUnidadeInfo>();
      for (const a of apRes.data ?? []) {
        const nome = nomePorUnidadeId.get(a.unidade_id);
        if (!nome) continue;
        const { ano: anoRec, mes } = mesReconhecimento(String(a.mes_referencia));
        if (anoRec !== ano) continue; // pertence à consulta de outro ano

        const fechada = a.status === "confirmado" || a.status === "faturado";
        // CSC fixo é conhecido desde a criação da apuração (copiado de
        // `unidades`), não depende de fechamento. CSC variável (% base
        // antiga) só é apurado no fechamento, como royalties/CAC.
        const cscFixo = a.csc_valor_fixo != null ? Number(a.csc_valor_fixo) : null;
        const cscValor = cscFixo ?? Number(a.csc_base_antiga_valor ?? 0);
        const cscRealizado = cscFixo != null ? true : fechada;

        map.set(`${nome}|${mes}`, {
          status: a.status,
          royalties: { valor: Number(a.royalties_valor ?? 0), realizado: fechada },
          csc: { valor: cscValor, realizado: cscRealizado },
          cac: { valor: Number(a.cac_valor ?? 0), realizado: fechada },
          // Tráfego pago e outras receitas são editados direto na apuração
          // a qualquer momento (não dependem de fechar o mês).
          midia: { valor: Number(a.csc_trafego_pago ?? 0), realizado: true },
          outras: { valor: Number(a.outras_receitas ?? 0), realizado: true },
        });
      }
      return map;
    },
    staleTime: 30_000,
  });
}

// Mapeia a categoria cadastrada em receitas_cm_fornecedores pro componente
// correspondente da apuração — usado por DRE Projetada e Receitas Partners
// pra decidir quais itens são "fonte única = apuração" (não editáveis aqui).
export const CATEGORIA_APURACAO_FIELD: Record<
  string,
  keyof Omit<RoyaltiesPorUnidadeInfo, "status">
> = {
  Royalties: "royalties",
  CSC: "csc",
  CAC: "cac",
  "Verba de mídia": "midia",
  Outras: "outras",
};

export function categoriaVemDaApuracao(categoria: string | null): boolean {
  return !!categoria && categoria in CATEGORIA_APURACAO_FIELD;
}

export function valorDaApuracao(
  info: RoyaltiesPorUnidadeInfo | undefined,
  categoria: string | null,
): ApuracaoValor | undefined {
  const campo = categoria ? CATEGORIA_APURACAO_FIELD[categoria] : undefined;
  return campo && info ? info[campo] : undefined;
}

export function useGarantirApuracoesAno() {
  const fn = useServerFn(garantirApuracoesAno);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ano: number }) => fn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["royalties", "por-unidade"] });
    },
    onError: defaultOnError,
  });
}
