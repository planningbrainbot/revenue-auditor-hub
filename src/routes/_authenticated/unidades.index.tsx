import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { GuardaUnidades } from "@/components/unidades/guarda-unidades";
import { RedeContent } from "@/components/page-content/rede-content";
import { MolduraReceita } from "@/components/receita/moldura";

// Enquanto foram abas, as outras quatro telas viviam em /unidades?tab=X. Esses
// links já circularam em e-mail, favorito e notificação, então a URL antiga
// segue de pé e cai na página nova — mesmo tratamento que rede.tsx e
// royalties.index.tsx deram às páginas absorvidas na fusão anterior.
// `historico` caiu em 22/09/2026 junto com a página: manda pra Apuração de
// Royalties, mesmo destino de /royalties.
const DESTINO_DA_ABA = {
  royalties: "/unidades/royalties",
  historico: "/unidades/royalties",
  split: "/unidades/split",
} as const;

type BuscaRegras = { tab?: string; q?: string; status?: string };

export const Route = createFileRoute("/_authenticated/unidades/")({
  // Busca e status moram na URL (N7); `tab` só existe para o redirecionamento
  // dos links antigos.
  validateSearch: (search: Record<string, unknown>): BuscaRegras => {
    const out: BuscaRegras = {};
    if (typeof search.tab === "string") out.tab = search.tab;
    if (typeof search.q === "string" && search.q) out.q = search.q;
    if (typeof search.status === "string" && search.status) out.status = search.status;
    return out;
  },
  beforeLoad: ({ search }) => {
    const destino = DESTINO_DA_ABA[search.tab as keyof typeof DESTINO_DA_ABA];
    if (destino) throw redirect({ to: destino, replace: true });
    // ?tab=regras é esta mesma página: some com o parâmetro para não deixar
    // duas URLs equivalentes circulando.
    if (search.tab) throw redirect({ to: "/unidades", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Regras da Rede – Planning" },
      {
        name: "description",
        content: "Cadastro das unidades e as regras de royalties que valem para cada uma.",
      },
    ],
  }),
  component: RegrasDaRedePage,
});

function RegrasDaRedePage() {
  useAuth();
  return (
    <MolduraReceita
      titulo="Regras da Rede"
      pergunta="Qual é a regra de repasse de cada unidade?"
      descricao="Unidades da rede e a regra vigente hoje: percentual de royalties, CSC (fixo ou % da base antiga), mídia e CAC. Só leitura."
      procedencia={{ fonte: "Cadastro de unidades e sócios (Supabase)", regua: "regra vigente hoje" }}
    >
      <GuardaUnidades permissao="view.unidades_rede" nome="as Regras da Rede">
        <RedeContent />
      </GuardaUnidades>
    </MolduraReceita>
  );
}
