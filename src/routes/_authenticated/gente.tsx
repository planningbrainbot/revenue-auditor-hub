import { createFileRoute } from "@tanstack/react-router";
import { GenteView } from "@/components/gente/gente-view";
import { GenteUmAUmTab, GenteFeedbackTab } from "@/components/gente/gente-conversas-tab";
import { GenteClimaTab } from "@/components/gente/gente-clima-tab";
import { GenteLiderancaTab, GenteElogiosTab } from "@/components/gente/gente-lideranca-tab";
import { GenteAvaliacaoTab } from "@/components/gente/gente-avaliacao-tab";
import { GentePdiTab } from "@/components/gente/gente-pdi-tab";
import { Adocao, VisaoMinhaVez, VisaoMeuTime } from "@/components/gente/gente-visoes";
import { PageHeader } from "@/components/planning";
import { segundaDaSemana } from "@/lib/gente-lideranca.functions";

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
// 4. (24/09/2026, DS v2) A faixa de abas que repetia os onze itens da lateral
//    saiu (N6): a lateral é o menu, e `?tela=` continua sendo o endereço.
//
// O que sobrou do passo 2 e vale: "Minha vez" e "Meu time" continuam existindo,
// como atalho de quem quer a fila do dia e não um módulo.
export type Tela =
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

// `titulo` = item do menu (`areas.ts`); `pergunta` = N1, da tabela do contrato
// (`docs/design/contratos/gente.md`); `descricao` = o universo de cada tela.
const TELAS: Record<Tela, { titulo: string; pergunta: string; descricao: () => string }> = {
  "minha-vez": {
    titulo: "Minha vez",
    pergunta: "O que está pendente comigo esta semana?",
    descricao: () =>
      `Só o que é seu, na semana que começa em ${dataCurta(segundaDaSemana())}: pulso, prioridades, avaliações a responder e ações do seu PDI.`,
  },
  "meu-time": {
    titulo: "Meu time",
    pergunta: "Quem do meu time precisa de mim agora?",
    descricao: () =>
      "As pessoas que têm você como gestor no cadastro, em qualquer profundidade: 1:1, pulso da semana e PDI.",
  },
  "um-a-um": {
    titulo: "1:1",
    pergunta: "Com quem estou há mais tempo sem 1:1?",
    descricao: () =>
      "Os 1:1 em que você é gestor ou liderado. Na fila, quem nunca teve vem primeiro, depois quem está há mais dias sem.",
  },
  lideranca: {
    titulo: "Sentimento e prioridades",
    pergunta: "Como o time está, e quais são as prioridades da semana?",
    descricao: () =>
      "O pulso semanal e as prioridades da semana, seus e das pessoas que você lidera.",
  },
  feedback: {
    titulo: "Feedback",
    pergunta: "Que feedback eu recebi e enviei?",
    descricao: () =>
      "Feedback entre pessoas da sua unidade que tenha você como autor ou destinatário. Quem escreve escolhe quem mais enxerga.",
  },
  elogios: {
    titulo: "Elogios",
    pergunta: "Quem foi reconhecido, e por quê?",
    descricao: () => "O mural de elogios da sua unidade: quem recebeu, de quem e o motivo.",
  },
  avaliacao: {
    titulo: "Avaliação",
    pergunta: "Em que pé está o ciclo de avaliação, e o que falta concluir?",
    descricao: () =>
      "Os ciclos de avaliação que você enxerga: o que espera sua resposta e o andamento de cada avaliado.",
  },
  pdi: {
    titulo: "PDI",
    pergunta: "As metas de desenvolvimento estão andando?",
    descricao: () =>
      "Os planos de desenvolvimento seus e das pessoas que você lidera: metas, ações e prazos.",
  },
  cadastro: {
    titulo: "Cadastro",
    pergunta: "Quem são as pessoas da rede, e onde estão?",
    descricao: () =>
      "As pessoas das unidades que você enxerga. Cada unidade vê só a sua, e dentro dela vale a hierarquia.",
  },
  clima: {
    titulo: "Clima",
    pergunta: "Como está o eNPS da rede e de cada unidade?",
    descricao: () =>
      "As rodadas de eNPS, da rede e por unidade. Com menos de 5 respostas a nota não aparece.",
  },
  adocao: {
    titulo: "Adoção por unidade",
    pergunta: "Quais unidades já usam o People?",
    descricao: () =>
      "Todas as unidades da rede, em números agregados e sem nome: pessoas, login, pulso, 1:1, PDI e ciclo.",
  },
};

const dataCurta = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

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
  sentimento: "lideranca",
  feedback: "feedback",
  elogios: "elogios",
  avaliacao: "avaliacao",
  pdi: "pdi",
  clima: "clima",
};

export type BuscaGente = { tela: Tela } & Record<string, unknown>;

export const Route = createFileRoute("/_authenticated/gente")({
  // Repassa as outras chaves: os filtros de cada tela moram na URL
  // (`useFiltroNaUrl`, N7), e uma validação que devolvesse só `tela` os apagaria.
  // `visao` e `aba` são traduzidas para `tela` e saem.
  validateSearch: (busca: Record<string, unknown>): BuscaGente => {
    const { tela: bruta, visao, aba, ...resto } = busca ?? {};
    const pedida = String(bruta ?? "");
    const tela: Tela =
      Object.prototype.hasOwnProperty.call(TELAS, pedida)
        ? (pedida as Tela)
        : (DE_ABA[pedida] ?? DE_VISAO[String(visao ?? "")] ?? DE_ABA[String(aba ?? "")] ?? "minha-vez");
    return { ...resto, tela };
  },
  component: GentePage,
});

function GentePage() {
  const { tela } = Route.useSearch();
  const def = TELAS[tela];

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* A área (Planning People) sobe no eyebrow com o nome do item do menu;
          o <h1> é a pergunta da tela. */}
      <PageHeader titulo={def.titulo} pergunta={def.pergunta} descricao={def.descricao()} />
      <ConteudoDaTela tela={tela} />
    </div>
  );
}

function ConteudoDaTela({ tela }: { tela: Tela }) {
  switch (tela) {
    case "minha-vez":
      return <VisaoMinhaVez />;
    case "meu-time":
      return <VisaoMeuTime />;
    case "um-a-um":
      return <GenteUmAUmTab />;
    case "lideranca":
      return <GenteLiderancaTab />;
    case "feedback":
      return <GenteFeedbackTab />;
    case "elogios":
      return <GenteElogiosTab />;
    case "avaliacao":
      return <GenteAvaliacaoTab />;
    case "pdi":
      return <GentePdiTab />;
    case "cadastro":
      return <GenteView />;
    case "clima":
      return <GenteClimaTab />;
    case "adocao":
      return <Adocao />;
  }
}
