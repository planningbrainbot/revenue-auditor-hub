import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  buscarCandidatosCnpj,
  detalheDaConta,
  kpisDaily,
  listarFilaCella,
  listarNovosDoMes,
  resolverCnpjConta,
  salvarCampoOperado,
} from "@/lib/fila-cella.functions";
import {
  abrirCiclo,
  encerrarCiclo,
  listarToques,
  registrarToque,
} from "@/lib/fila-cella-toques.functions";
import type {
  AbrirCicloInput,
  CampoOperadoInput,
  EncerrarCicloInput,
  RegistrarToqueInput,
  ResolverCnpjInput,
} from "@/lib/fila-cella.types";

/**
 * `staleTime` curto de propósito: a daily das 13h30 acontece com a tela aberta, e
 * o contador de toques precisa mexer na linha assim que alguém grava.
 */
export function useFilaCella() {
  const fn = useServerFn(listarFilaCella);
  return useQuery({
    queryKey: ["fila-cella"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

export function useNovosDoMes() {
  const fn = useServerFn(listarNovosDoMes);
  return useQuery({
    queryKey: ["fila-cella", "novos"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useKpisDaily() {
  const fn = useServerFn(kpisDaily);
  return useQuery({
    queryKey: ["fila-cella", "kpis"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

export function useDetalheDaConta(cnpj: string | null, habilitado: boolean) {
  const fn = useServerFn(detalheDaConta);
  return useQuery({
    queryKey: ["fila-cella", "detalhe", cnpj],
    queryFn: () => fn({ data: { cnpj } }),
    enabled: habilitado && !!cnpj,
    staleTime: 5 * 60_000,
  });
}

export function useToquesDaConta(contaId: number | null) {
  const fn = useServerFn(listarToques);
  return useQuery({
    queryKey: ["fila-cella-toques", contaId],
    queryFn: () => fn({ data: { conta_id: contaId! } }),
    enabled: !!contaId,
    staleTime: 15_000,
  });
}

export function useCandidatosCnpj() {
  const fn = useServerFn(buscarCandidatosCnpj);
  return useMutation({
    mutationFn: (termo: string) => fn({ data: { termo } }),
  });
}

/**
 * Toda mutação invalida `["fila-cella"]` — a linha da tabela carrega contador de
 * toques, próximo passo e bloqueios, e os três mudam com a escrita.
 */
function useInvalidarFila() {
  const qc = useQueryClient();
  return (contaId?: number | null) => {
    qc.invalidateQueries({ queryKey: ["fila-cella"] });
    if (contaId) qc.invalidateQueries({ queryKey: ["fila-cella-toques", contaId] });
  };
}

export function useSalvarCampoOperado() {
  const fnSalvar = useServerFn(salvarCampoOperado);
  const invalidar = useInvalidarFila();
  return useMutation({
    mutationFn: (input: CampoOperadoInput) => fnSalvar({ data: input }),
    onSuccess: (_r, input) => invalidar(input.conta_id),
  });
}

export function useResolverCnpj() {
  const fn = useServerFn(resolverCnpjConta);
  const invalidar = useInvalidarFila();
  return useMutation({
    mutationFn: (input: ResolverCnpjInput) => fn({ data: input }),
    onSuccess: () => invalidar(),
  });
}

export function useAbrirCiclo() {
  const fn = useServerFn(abrirCiclo);
  const invalidar = useInvalidarFila();
  return useMutation({
    mutationFn: (input: AbrirCicloInput) => fn({ data: input }),
    onSuccess: (_r, input) => invalidar(input.conta_id),
  });
}

export function useRegistrarToque(contaId: number | null) {
  const fn = useServerFn(registrarToque);
  const invalidar = useInvalidarFila();
  return useMutation({
    mutationFn: (input: RegistrarToqueInput) => fn({ data: input }),
    onSuccess: () => invalidar(contaId),
  });
}

export function useEncerrarCiclo(contaId: number | null) {
  const fn = useServerFn(encerrarCiclo);
  const invalidar = useInvalidarFila();
  return useMutation({
    mutationFn: (input: EncerrarCicloInput) => fn({ data: input }),
    onSuccess: () => invalidar(contaId),
  });
}
