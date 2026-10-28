import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, FileText, Video } from "lucide-react";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  Secao,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/use-permissions";
import { db } from "@/lib/uso";
import { ordenarComites, TIPOS, type Comite } from "@/lib/comites";

// Comitês na Minha Unidade (contrato docs/design/contratos/comites.md; PRD
// 2026-10-ops-comites-da-rede, P-01 decidida em 28/10/2026). O sócio vê só o
// material de cada comitê: apresentação e gravação. As notas da pesquisa ficam
// em /comites, para o admin.

const BUCKET = "comites";

export const Route = createFileRoute("/_authenticated/meus-comites")({
  ssr: false,
  head: () => ({ meta: [{ title: "Comitês · Planning Brain" }] }),
  component: MeusComites,
});

function dataBR(iso: string | null) {
  if (!iso) return "data a definir";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

async function carregar(): Promise<Comite[]> {
  const { data, error } = await db
    .from("comites")
    .select(
      "id, codigo, tipo, titulo, data, apresentacao_url, apresentacao_arquivo, apresentacao_nome, gravacao_url, pesquisa_aberta",
    );
  if (error) throw new Error(`ops.comites: ${error.message}`);
  return ordenarComites(data as Comite[]);
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[1200px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="minha_unidade"
        titulo="Comitês"
        pergunta="O que foi apresentado em cada comitê da rede?"
        descricao="A apresentação e a gravação de cada comitê, do mais recente para o mais antigo."
        procedencia={{ fonte: "ops.comites" }}
      />
      {children}
    </main>
  );
}

function MeusComites() {
  const perms = usePermissions();
  const pode = !perms.loading && perms.can("view.meus_comites");
  const q = useQuery({
    queryKey: ["meus-comites"],
    queryFn: carregar,
    enabled: pode,
    retry: false,
  });

  if (perms.loading)
    return (
      <Moldura>
        <Carregando variante="pagina" />
      </Moldura>
    );
  if (!pode)
    return (
      <Moldura>
        <EstadoSemAcesso oQueFalta="view.meus_comites (área Minha Unidade)" />
      </Moldura>
    );
  if (q.isLoading)
    return (
      <Moldura>
        <Carregando variante="pagina" />
      </Moldura>
    );
  if (q.isError)
    return (
      <Moldura>
        <EstadoErro
          titulo="Os comitês não carregaram"
          detalhe={(q.error as Error).message}
          tentarNovamente={() => q.refetch()}
        />
      </Moldura>
    );

  const comites = q.data!;
  return (
    <Moldura>
      {comites.length === 0 ? (
        <EstadoVazio
          titulo="Ainda não há comitês"
          descricao="O material aparece aqui depois de cada comitê."
        />
      ) : (
        <div className="space-y-4">
          {comites.map((c) => (
            <CartaoComite key={c.id} comite={c} />
          ))}
        </div>
      )}
    </Moldura>
  );
}

function CartaoComite({ comite: c }: { comite: Comite }) {
  const arquivo = useQuery({
    queryKey: ["meus-comites-arquivo", c.apresentacao_arquivo],
    queryFn: async () => {
      const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrl(c.apresentacao_arquivo, 60 * 60, {
          download: c.apresentacao_nome ?? true,
        });
      if (error) throw new Error(error.message);
      return data.signedUrl as string;
    },
    enabled: !!c.apresentacao_arquivo,
    retry: false,
  });

  const semNada = !c.apresentacao_url && !c.apresentacao_arquivo && !c.gravacao_url;

  return (
    <Secao titulo={c.titulo} descricao={`${TIPOS[c.tipo]} · ${dataBR(c.data)}`}>
      <div className="flex flex-wrap gap-3">
        {c.apresentacao_url && (
          <Button asChild variant="outline">
            <a href={c.apresentacao_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Abrir a apresentação
            </a>
          </Button>
        )}
        {c.apresentacao_arquivo && (
          <Button asChild variant="outline" disabled={!arquivo.data}>
            <a href={arquivo.data ?? "#"} target="_blank" rel="noopener noreferrer">
              <FileText className="mr-2 h-4 w-4" aria-hidden />
              Baixar {c.apresentacao_nome ?? "o arquivo"}
            </a>
          </Button>
        )}
        {c.gravacao_url && (
          <Button asChild variant="outline">
            <a href={c.gravacao_url} target="_blank" rel="noopener noreferrer">
              <Video className="mr-2 h-4 w-4" aria-hidden /> Assistir à gravação
            </a>
          </Button>
        )}
        {semNada && (
          <span className="text-sm text-muted-foreground">
            O material deste comitê ainda não foi publicado.
          </span>
        )}
        {!semNada && !c.gravacao_url && (
          <span className="self-center text-sm text-muted-foreground">Gravação em breve.</span>
        )}
      </div>
    </Secao>
  );
}
