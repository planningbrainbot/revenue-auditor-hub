import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
} from "@/lib/notificacoes.functions";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_SCHEMA } from "@/integrations/supabase/schema";
import { usePermissions } from "@/hooks/use-permissions";

const QUERY_KEY = ["notificacoes"];

/** O sino aparece para o admin (avisos coletivos) e para quem tem a área Tarefas (avisos pessoais). */
export function useVeSino() {
  const { isAdmin, temArea } = usePermissions();
  return isAdmin || temArea("tarefas");
}

export function useNotificacoes() {
  const veSino = useVeSino();
  const fn = useServerFn(listNotificacoes);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fn(),
    enabled: veSino,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!veSino) return;
    const channel = supabase
      .channel("notificacoes-bell")
      // Realtime não herda o `db.schema` do cliente: o schema vai no filtro do
      // canal. Deixar "public" cravado aqui faria o sino parar de tocar no banco
      // único, calado. Ver integrations/supabase/schema.ts. Sem filtro por destinatário:
      // o Realtime aplica a RLS de leitura, então cada um só recebe o que pode ler.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: SUPABASE_SCHEMA, table: "notificacoes" },
        () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [veSino, qc]);

  return query;
}

export function useMarcarNotificacaoLida() {
  const fn = useServerFn(marcarNotificacaoLida);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useMarcarTodasNotificacoesLidas() {
  const fn = useServerFn(marcarTodasNotificacoesLidas);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
