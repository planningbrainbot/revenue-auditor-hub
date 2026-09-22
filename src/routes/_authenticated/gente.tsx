import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  VisaoMinhaVez,
  VisaoMeuTime,
  VisaoMinhaUnidade,
  VisaoRede,
  VisaoAdmin,
} from "@/components/gente/gente-visoes";

// A visão vem da URL para o menu apontar direto, e para dar link no WhatsApp
// ("abre /gente?visao=meu-time").
//
// Organização por QUEM USA, não por módulo. O desenho anterior tinha oito abas,
// uma por produto (Cadastro, 1:1, Liderança, Feedback, Elogios, Avaliação, PDI,
// Clima), copiado do Qulture: o colaborador abria oito e seis não eram dele.
// Aqui são cinco, e cada uma só aparece para quem ela serve.
type Visao = "minha-vez" | "meu-time" | "minha-unidade" | "rede" | "admin";
const VISOES: Visao[] = ["minha-vez", "meu-time", "minha-unidade", "rede", "admin"];

// As abas antigas continuam funcionando como link: quem tiver `?aba=clima`
// salvo cai na visão que hoje mostra clima, em vez de numa página em branco.
const ABA_ANTIGA: Record<string, Visao> = {
  cadastro: "minha-unidade",
  "um-a-um": "meu-time",
  lideranca: "minha-vez",
  feedback: "minha-vez",
  elogios: "minha-vez",
  avaliacao: "minha-vez",
  pdi: "minha-vez",
  clima: "minha-unidade",
};

export const Route = createFileRoute("/_authenticated/gente")({
  validateSearch: (busca: Record<string, unknown>): { visao: Visao } => {
    const bruta = String(busca?.visao ?? "");
    if ((VISOES as string[]).includes(bruta)) return { visao: bruta as Visao };
    const antiga = ABA_ANTIGA[String(busca?.aba ?? "")];
    return { visao: antiga ?? "minha-vez" };
  },
  component: GentePage,
});

function GentePage() {
  const { visao } = useSearch({ from: "/_authenticated/gente" });
  const navegar = Route.useNavigate();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Planning People</h1>
          <p className="text-sm text-muted-foreground">
            As pessoas das unidades, vistas de onde você está. Cada unidade enxerga só a sua, e
            dentro dela vale a hierarquia.
          </p>
        </div>
      </div>

      <Tabs
        value={visao}
        onValueChange={(v) => navegar({ search: { visao: v as Visao }, replace: true })}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="minha-vez">Minha vez</TabsTrigger>
          <TabsTrigger value="meu-time">Meu time</TabsTrigger>
          <TabsTrigger value="minha-unidade">Minha unidade</TabsTrigger>
          <TabsTrigger value="rede">Rede</TabsTrigger>
          <TabsTrigger value="admin">Administração</TabsTrigger>
        </TabsList>
        <TabsContent value="minha-vez" className="mt-4">
          <VisaoMinhaVez />
        </TabsContent>
        <TabsContent value="meu-time" className="mt-4">
          <VisaoMeuTime />
        </TabsContent>
        <TabsContent value="minha-unidade" className="mt-4">
          <VisaoMinhaUnidade />
        </TabsContent>
        <TabsContent value="rede" className="mt-4">
          <VisaoRede />
        </TabsContent>
        <TabsContent value="admin" className="mt-4">
          <VisaoAdmin />
        </TabsContent>
      </Tabs>
    </div>
  );
}
