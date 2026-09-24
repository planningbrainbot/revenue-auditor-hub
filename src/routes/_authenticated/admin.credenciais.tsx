import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SegredosView } from "@/components/integracoes/segredos-view";
import { PageHeader } from "@/components/planning";
import { CHAVES_CONHECIDAS, listarSegredos } from "@/lib/integracoes-segredos.functions";

export const Route = createFileRoute("/_authenticated/admin/credenciais")({
  component: CredenciaisPage,
});

function CredenciaisPage() {
  // Mesma chave de cache da SegredosView: a contagem do cabeçalho não faz outra chamada.
  const carregar = useServerFn(listarSegredos);
  const { data } = useQuery({ queryKey: ["integracoes-segredos"], queryFn: () => carregar() });
  const configuradas = (data?.status ?? []).filter((s) => s.configurado).length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Chaves de Integração"
        pergunta="Quais chaves de integração estão cadastradas?"
        descricao={
          <>
            {data ? `${configuradas} de ${CHAVES_CONHECIDAS.length} configuradas · ` : ""}
            O valor entra por aqui e não volta para a tela. Remover ou escrever por cima tira do ar
            a chave que a integração usa hoje: ela para até uma chave nova ser salva.
          </>
        }
      />
      <SegredosView />
    </div>
  );
}
