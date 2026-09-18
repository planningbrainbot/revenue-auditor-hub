import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { iniciarVerComo, listarUnidadesVerComo } from "@/lib/ver-como.functions";

/**
 * "Qual unidade você quer ver?" — a porta da simulação.
 *
 * Abre pelo seletor de frentes da lateral, no lugar em que o super admin já
 * troca de contexto. Não virou página própria de propósito: uma tela em
 * /admin/ver-como seria mais um endereço para decorar, e a pergunta aqui tem
 * uma resposta só.
 */
export function VerComoDialog({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");

  const listarFn = useServerFn(listarUnidadesVerComo);
  const unidades = useQuery({
    queryKey: ["ver-como-unidades"],
    queryFn: () => listarFn(),
    // Só busca quando a pessoa abre: é uma lista de 14 linhas que muda uma vez
    // por trimestre, e carregá-la no boot custaria uma consulta em toda sessão.
    enabled: aberto,
    staleTime: 5 * 60 * 1000,
  });

  const iniciarFn = useServerFn(iniciarVerComo);
  const iniciar = useMutation({
    mutationFn: (unidadeId: number) => iniciarFn({ data: { unidadeId } }),
    onSuccess: async (r) => {
      // Invalida ANTES de navegar: a tela de destino é recortada por unidade, e
      // entrar nela com a permissão antiga em cache mostraria a rede inteira
      // por um instante — exatamente o que a simulação existe para não fazer.
      await qc.invalidateQueries({ queryKey: ["my-perms"] });
      aoFechar();
      toast.success(`Vendo como o sócio de ${r.unidade ?? "a unidade"}.`);
      navigate({ to: "/painel-unidade" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const termo = busca.trim().toLowerCase();
  const lista = (unidades.data ?? []).filter((u) => u.nome.toLowerCase().includes(termo));

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4" />
            Ver como uma unidade
          </DialogTitle>
          <DialogDescription>
            Você passa a enxergar o menu, as páginas e os dados recortados como o sócio regional
            dessa unidade. Dá para sair a qualquer momento pela tarja do topo.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar unidade"
            className="h-9 pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {unidades.isLoading &&
            [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          {!unidades.isLoading && lista.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma unidade com esse nome.
            </p>
          )}
          {lista.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={iniciar.isPending}
              onClick={() => iniciar.mutate(u.id)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent disabled:opacity-50"
            >
              <span className="text-sm font-medium">{u.nome}</span>
              {/* Sem sócio com login, a simulação mostra o que o PERFIL de sócio
                  regional alcança — e quem lê a lista precisa saber disso antes
                  de clicar, não depois. */}
              <span className="text-[11px] text-muted-foreground">
                {u.socio ?? "sem sócio cadastrado"}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
