import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { desembrulhar, valeTentarDeNovo } from "@/lib/faturamento/erros";
import {
  buscarClientesFaturamento,
  carregarContratoDetalhe,
  carregarContratosMes,
  carregarCorte,
  carregarPessoasContrato,
  carregarConfigFaturamento,
  carregarContextoFaturamento,
  carregarFilaTesouraria,
  carregarPedidoFaturamento,
  carregarPedidosFaturamento,
  carregarProjetosFaturamento,
  carregarResumoFaturamento,
  carregarServicosFaturamento,
  previaParcelasFaturamento,
} from "@/lib/faturamento/faturamento.functions";
import { previaPronta } from "@/lib/faturamento/formulario";
import { filaEmCurso, fichaEmCurso } from "@/lib/faturamento/fila";
import type { FiltroFila, FiltroPedidos } from "@/lib/faturamento/tipos";

// Consultas das telas do Portal de Faturamento. Todas começam por ["faturamento", …], para uma ação
// (OK, devolver, faturar) invalidar a área inteira com uma chave só.
//
// `retry` só em falha passageira: acesso negado, validação e "a função ainda não existe" não mudam numa
// segunda tentativa, e o retry pausado em aba oculta deixaria a tela em "Carregando" para sempre.

export const CHAVE_FATURAMENTO = ["faturamento"] as const;

const RELEITURA_MS = 15_000;

/** `ops.fat_contexto`: papéis, empresas do recorte e pendências. Abre toda tela da área. */
export function useContextoFaturamento(habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarContextoFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "contexto", user?.id],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn()),
    staleTime: 60_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_resumo`: os quatro números e as etapas de Meu faturamento. */
export function useResumoFaturamento(
  periodo: string | null,
  emissoras: string[] | null,
  habilitado = true,
) {
  const { user } = useAuth();
  const fn = useServerFn(carregarResumoFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "resumo", user?.id, periodo, emissoras],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { periodo, emissoras } })),
    staleTime: 60_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_pedidos`: a página pedida e os totais do recorte (servidor). Mantém a página anterior na troca. */
export function usePedidosFaturamento(filtro: FiltroPedidos, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarPedidosFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "pedidos", user?.id, filtro],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { filtro } })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_pedido`: a ficha. Fora do escopo vem `sem_acesso`, sem nenhum dado. */
export function useFichaPedido(id: string | null | undefined, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarPedidoFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "pedido", user?.id, id],
    enabled: habilitado && !!user?.id && !!id,
    queryFn: async () => desembrulhar(await fn({ data: { id: id as string } })),
    staleTime: 15_000,
    // "Faturando…", "Na fila do Omie" e a leitura pedida mudam sem ninguém agir: relê a cada 15 s enquanto
    // houver algo em curso no Omie (revisão de 20/10/2026).
    refetchInterval: (q) => (fichaEmCurso(q.state.data) ? RELEITURA_MS : false),
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_fila_tesouraria`. `emissora` nula = todas do recorte. */
export function useFilaTesouraria(emissora: string | null, filtro: FiltroFila, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarFilaTesouraria);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "fila", user?.id, emissora, filtro],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { emissora, filtro } })),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (filaEmCurso(q.state.data) ? RELEITURA_MS : false),
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_config`: só a controladoria. */
export function useConfigFaturamento(habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarConfigFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "config", user?.id],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn()),
    staleTime: 30_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_servicos`: o catálogo liberado da emissora (o campo Serviço do pedido). */
export function useServicosFaturamento(emissora: string | null) {
  const { user } = useAuth();
  const fn = useServerFn(carregarServicosFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "servicos", user?.id, emissora],
    enabled: !!user?.id && !!emissora,
    queryFn: async () => desembrulhar(await fn({ data: { emissora: emissora as string } })),
    staleTime: 5 * 60_000,
    retry: valeTentarDeNovo,
  });
}

/**
 * `ops.fat_clientes_busca`: os clientes da empresa para a lista do campo Cliente (call de 27/10/2026). Só consulta com
 * 3 caracteres ou mais; enquanto o texto novo responde, a lista anterior fica na tela.
 */
export function useClientesFaturamento(emissora: string | null, texto: string) {
  const { user } = useAuth();
  const fn = useServerFn(buscarClientesFaturamento);
  const t = texto.trim();
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "clientes", user?.id, emissora, t],
    enabled: !!user?.id && !!emissora && t.length >= 3,
    queryFn: async () =>
      desembrulhar(await fn({ data: { emissora: emissora as string, texto: t } })),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_projetos`: os projetos já usados pela empresa (o campo Projeto do pedido, call de 27/10/2026). */
export function useProjetosFaturamento(emissora: string | null) {
  const { user } = useAuth();
  const fn = useServerFn(carregarProjetosFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "projetos", user?.id, emissora],
    enabled: !!user?.id && !!emissora,
    queryFn: async () => desembrulhar(await fn({ data: { emissora: emissora as string } })),
    staleTime: 5 * 60_000,
    retry: valeTentarDeNovo,
  });
}

/**
 * `ops.fat_parcelas_previa`: a mesma função que grava as parcelas no envio (a tela não inventa uma terceira
 * regra). Só consulta com valor, parcelas e 1º vencimento válidos.
 */
export function usePreviaParcelas(
  valor: number | null,
  parcelas: number | null,
  primeiroVencimento: string | null,
) {
  const { user } = useAuth();
  const fn = useServerFn(previaParcelasFaturamento);
  // A mesma regra de "pronta" da tela (`previaPronta`). Sem prévia anterior guardada: uma divisão velha na
  // tela, com o valor já mudado, engana (revisão de 20/10/2026).
  const pronta = previaPronta(valor, parcelas, primeiroVencimento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "previa", valor, parcelas, primeiroVencimento],
    enabled: !!user?.id && pronta,
    queryFn: async () =>
      desembrulhar(
        await fn({
          data: {
            valor: valor as number,
            parcelas: parcelas as number,
            primeiroVencimento: primeiroVencimento as string,
          },
        }),
      ),
    staleTime: 10 * 60_000,
    retry: valeTentarDeNovo,
  });
}

/** Depois de uma ação, relê a área inteira (contexto, números, lista, ficha, fila). */
export function useReler() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: CHAVE_FATURAMENTO }), [qc]);
}

// ------------------------------------------------------------------ recorrente (E2, 29/10/2026)

/** `ops.fat_contratos_mes`. `competencia` nula = o mês aberto mais próximo. */
export function useContratosMes(competencia: string | null, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarContratosMes);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "contratos-mes", user?.id, competencia],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { competencia } })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_contrato_detalhe`: o `Sheet` do contrato. */
export function useContratoDetalhe(id: string | null | undefined, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarContratoDetalhe);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "contrato", user?.id, id],
    enabled: habilitado && !!user?.id && !!id,
    queryFn: async () => desembrulhar(await fn({ data: { id: id as string } })),
    staleTime: 15_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_contrato_pessoas`: quem pode receber o repasse. */
export function usePessoasContrato(emissora: string | null | undefined, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarPessoasContrato);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "pessoas-contrato", user?.id, emissora],
    enabled: habilitado && !!user?.id && !!emissora,
    queryFn: async () => desembrulhar(await fn({ data: { emissora: emissora as string } })),
    staleTime: 5 * 60_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_corte`. `dia` nulo = o próximo corte. */
export function useCorte(dia: string | null, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarCorte);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "corte", user?.id, dia],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { dia } })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: valeTentarDeNovo,
  });
}
