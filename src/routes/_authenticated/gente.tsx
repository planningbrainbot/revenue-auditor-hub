import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resumoMenuGente, type ResumoMenuGente } from "@/lib/gente-menu.functions";
import { GenteView } from "@/components/gente/gente-view";
import { GenteUmAUmTab, GenteFeedbackTab } from "@/components/gente/gente-conversas-tab";
import { GenteClimaTab } from "@/components/gente/gente-clima-tab";
import { GenteLiderancaTab, GenteElogiosTab } from "@/components/gente/gente-lideranca-tab";
import { GenteAvaliacaoTab } from "@/components/gente/gente-avaliacao-tab";
import { GentePdiTab } from "@/components/gente/gente-pdi-tab";
import { Adocao, VisaoMinhaVez, VisaoMeuTime } from "@/components/gente/gente-visoes";
import { PageHeader } from "@/components/planning";

// Uma tela por MÓDULO, mais duas de rotina ("Minha vez" e "Meu time").
//
// História curta deste arquivo, porque ele mudou duas vezes em um dia:
//
// 1. Nasceu com oito abas, uma por produto, copiadas do Qulture. O colaborador
//    abria oito e seis não eram dele.
// 2. Virou quatro visões por papel, o que resolveu isso e criou outro problema:
//    para chegar num módulo específico era preciso entrar na visão e rolar.
// 3. Agora é módulo de novo, **filtrado por pessoa**. Quem implanta vê os onze
//    itens; quem só responde vê meia dúzia. O filtro é por fato, não por
//    permissão, porque a área concede todas as chaves (ver `resumoMenuGente`).
//
// O que sobrou do passo 2 e vale: "Minha vez" e "Meu time" continuam existindo,
// como atalho de quem quer a fila do dia e não um módulo.
type Tela =
  | "minha-vez"
  | "meu-time"
  | "um-a-um"
  | "lideranca"
  | "feedback"
  | "elogios"
  | "avaliacao"
  | "pdi"
  | "cadastro"
  | "clima"
  | "adocao";

const TELAS: { id: Tela; rotulo: string; flag?: keyof ResumoMenuGente }[] = [
  { id: "minha-vez", rotulo: "Minha vez" },
  { id: "meu-time", rotulo: "Meu time", flag: "lideraAlguem" },
  { id: "um-a-um", rotulo: "1:1" },
  { id: "lideranca", rotulo: "Sentimento e prioridades", flag: "noCadastro" },
  { id: "feedback", rotulo: "Feedback" },
  { id: "elogios", rotulo: "Elogios" },
  { id: "avaliacao", rotulo: "Avaliação", flag: "verAvaliacao" },
  { id: "pdi", rotulo: "PDI", flag: "temPdi" },
  { id: "cadastro", rotulo: "Cadastro" },
  { id: "clima", rotulo: "Clima", flag: "administra" },
  { id: "adocao", rotulo: "Adoção", flag: "redeInteira" },
];

// Os dois formatos anteriores continuam funcionando como link, para favorito e
// mensagem antiga não caírem numa tela em branco.
const DE_VISAO: Record<string, Tela> = {
  "minha-vez": "minha-vez",
  "meu-time": "meu-time",
  "minha-unidade": "cadastro",
  rede: "adocao",
  admin: "avaliacao",
};
const DE_ABA: Record<string, Tela> = {
  cadastro: "cadastro",
  "um-a-um": "um-a-um",
  lideranca: "lideranca",
  feedback: "feedback",
  elogios: "elogios",
  avaliacao: "avaliacao",
  pdi: "pdi",
  clima: "clima",
};

export const Route = createFileRoute("/_authenticated/gente")({
  validateSearch: (busca: Record<string, unknown>): { tela: Tela } => {
    const bruta = String(busca?.tela ?? "");
    if (TELAS.some((t) => t.id === bruta)) return { tela: bruta as Tela };
    const deVisao = DE_VISAO[String(busca?.visao ?? "")];
    const deAba = DE_ABA[String(busca?.aba ?? "")];
    return { tela: deVisao ?? deAba ?? "minha-vez" };
  },
  component: GentePage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function GentePage() {
  const { tela } = useSearch({ from: "/_authenticated/gente" });
  const navegar = Route.useNavigate();

  const fn = useServerFn(resumoMenuGente);
  // Mesma `queryKey` da lateral: as abas e o menu concordam sem pedir duas
  // vezes a mesma resposta.
  const { data: resumo } = useQuery<ResumoMenuGente>({
    queryKey: ["gente-menu"],
    queryFn: () => fn({}),
    staleTime: 5 * 60 * 1000,
  });

  // A tela aberta sempre aparece na barra, mesmo que a condição dela não passe:
  // quem chegou por link direto precisa entender onde está.
  const visiveis = TELAS.filter((t) => t.id === tela || !t.flag || Boolean(resumo?.[t.flag]));

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* A área (Planning People) já sobe no eyebrow; o título é o item do menu
          que abriu a tela, que aqui é a visão escolhida em `?tela=`. */}
      <PageHeader
        titulo={TELAS.find((t) => t.id === tela)?.rotulo ?? "Planning People"}
        descricao="As pessoas das unidades. Cada unidade enxerga só a sua, e dentro dela vale a hierarquia."
      />

      <Tabs
        value={tela}
        onValueChange={(v) => navegar({ search: { tela: v as Tela }, replace: true })}
      >
        <TabsList className="flex-wrap">
          {visiveis.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="minha-vez" className="mt-4">
          <VisaoMinhaVez />
        </TabsContent>
        <TabsContent value="meu-time" className="mt-4">
          <VisaoMeuTime />
        </TabsContent>
        <TabsContent value="um-a-um" className="mt-4">
          <GenteUmAUmTab />
        </TabsContent>
        <TabsContent value="lideranca" className="mt-4">
          <GenteLiderancaTab />
        </TabsContent>
        <TabsContent value="feedback" className="mt-4">
          <GenteFeedbackTab />
        </TabsContent>
        <TabsContent value="elogios" className="mt-4">
          <GenteElogiosTab />
        </TabsContent>
        <TabsContent value="avaliacao" className="mt-4">
          <GenteAvaliacaoTab />
        </TabsContent>
        <TabsContent value="pdi" className="mt-4">
          <GentePdiTab />
        </TabsContent>
        <TabsContent value="cadastro" className="mt-4">
          <GenteView />
        </TabsContent>
        <TabsContent value="clima" className="mt-4">
          <GenteClimaTab />
        </TabsContent>
        <TabsContent value="adocao" className="mt-4">
          <Adocao />
        </TabsContent>
      </Tabs>
    </div>
  );
}
