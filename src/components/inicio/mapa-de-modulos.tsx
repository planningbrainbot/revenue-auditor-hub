import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Brain,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  CircleDollarSign,
  Coins,
  Gauge,
  Handshake,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Plug,
  ShieldCheck,
  Store,
  Target,
  UsersRound,
  Video,
} from "lucide-react";
import { AnelArea, StatusBadge } from "@/components/planning";
import { cn } from "@/lib/utils";

/**
 * A porta de entrada organizada por MÓDULOS, só para o super admin.
 *
 * É a proposta do mapa "Jornadas do Planning Brain" (aba Módulos, revista em
 * 09/10/2026): cada módulo é um assunto de negócio com dono, dados e telas
 * próprios, lido da fundação até a gestão em cinco camadas. Por cima ficam as
 * experiências, portais que só montam telas dos módulos para um público.
 *
 * Módulo que ainda não existe aparece tracejado, com o selo "Planejado", e não
 * abre nada. Quem vê o mapa inteiro é só quem tem o nível máximo de acesso; o
 * resto continua com os cartões por área em `/inicio`.
 */

type Destino =
  /** Rota deste app. A área sai do próprio menu (`areasDoCaminho`). */
  | { tipo: "interno"; href: string }
  /** Outra aplicação no mesmo domínio: navegação de verdade. */
  | { tipo: "growth" | "financeiro" | "meet"; href: string }
  /**
   * A tela do sócio. Quem tem a área abre direto; o super admin, que não tem,
   * escolhe a unidade no "Ver como" e vê exatamente o que o sócio vê.
   */
  | { tipo: "ver_como"; href: string };

type Peca = {
  id: string;
  nome: string;
  resumo: string;
  /** Área cuja cor pinta o anel. Sem área do menu, o verde da marca. */
  area?: string;
  icone: LucideIcon;
  /** Sem destino = ainda não existe. */
  destino?: Destino;
};

type Camada = { slug: string; nome: string; modulos: Peca[] };

export const EXPERIENCIAS: Peca[] = [
  {
    id: "minha_unidade",
    nome: "Minha Unidade",
    resumo: "O Brain recortado para o sócio e a equipe da unidade.",
    area: "minha_unidade",
    icone: Gauge,
    destino: { tipo: "ver_como", href: "/painel-unidade" },
  },
  {
    id: "cockpit_ceo",
    nome: "Cockpit do CEO",
    resumo: "A rede inteira, com a composição de cada número.",
    area: "cockpit_ceo",
    icone: LayoutDashboard,
    destino: { tipo: "interno", href: "/cockpit-ceo" },
  },
  {
    id: "cockpit_coo",
    nome: "Cockpit do COO",
    resumo: "A rede inteira, pela rotina da semana.",
    area: "cockpit_coo",
    icone: ListChecks,
    destino: { tipo: "interno", href: "/cockpit-coo" },
  },
  {
    id: "brain_meet",
    nome: "Brain Meet",
    resumo: "Gravações e transcrições das reuniões.",
    icone: Video,
    destino: { tipo: "meet", href: "/growth/meet" },
  },
  {
    id: "portal_executor",
    nome: "Portal do executor",
    resumo: "Os contratos repassados a cada executor externo.",
    icone: BriefcaseBusiness,
  },
];

export const CAMADAS: Camada[] = [
  {
    slug: "fundacao",
    nome: "Fundação",
    modulos: [
      {
        id: "identidade",
        nome: "Identidade e Acesso",
        resumo: "Quem entra, o que cada papel abre e o escopo de cada pessoa.",
        area: "admin",
        icone: ShieldCheck,
        destino: { tipo: "interno", href: "/admin/usuarios" },
      },
      {
        id: "rede",
        nome: "Rede",
        resumo: "Unidades e sócios: o cadastro que todo o resto referencia.",
        area: "rede",
        icone: Landmark,
        destino: { tipo: "interno", href: "/unidades" },
      },
      {
        id: "integracoes",
        nome: "Integrações",
        resumo: "Traduz os sistemas de fora para o vocabulário de dentro.",
        area: "admin",
        icone: Plug,
        destino: { tipo: "interno", href: "/admin/integracoes" },
      },
    ],
  },
  {
    slug: "captar",
    nome: "Captar",
    modulos: [
      {
        id: "marketing",
        nome: "Marketing e Mídia",
        resumo: "Mídia paga, campanhas, criativos e o custo de cada lead.",
        icone: Megaphone,
        destino: { tipo: "growth", href: "/growth/trafego" },
      },
      {
        id: "comercial",
        nome: "Comercial",
        resumo: "Do lead ao deal ganho: funil, reuniões, ligações e distribuição.",
        icone: Handshake,
        destino: { tipo: "growth", href: "/growth/comercial" },
      },
      {
        id: "aquisicao",
        nome: "Aquisição (Broker)",
        resumo: "Clientes da matriz vendidos às unidades, com o CAC.",
        area: "broker",
        icone: Store,
        destino: { tipo: "interno", href: "/broker" },
      },
    ],
  },
  {
    slug: "carteira",
    nome: "Carteira",
    modulos: [
      {
        id: "clientes",
        nome: "Clientes",
        resumo: "Empresas, contatos e contratos, com o MRR de cada um.",
        area: "clientes",
        icone: Building2,
        destino: { tipo: "interno", href: "/clientes" },
      },
      {
        id: "cs",
        nome: "CS e Relacionamento",
        resumo: "O acompanhamento do cliente depois da venda.",
        area: "rede",
        icone: HeartPulse,
        destino: { tipo: "interno", href: "/painel-cs" },
      },
      {
        id: "monetizacao",
        nome: "Monetização",
        resumo: "Receita nova sobre a base que já é cliente.",
        area: "monetizacao",
        icone: Coins,
        destino: { tipo: "interno", href: "/monetizacao" },
      },
      {
        id: "ofertas",
        nome: "Parceiros e Ofertas",
        resumo: "Quem executa, o que se vende e quanto cada um leva.",
        area: "monetizacao",
        icone: Briefcase,
      },
      {
        id: "inteligencia",
        nome: "Inteligência da Base",
        resumo: "Necessidade por CNPJ, clusters e score por oferta.",
        area: "clientes",
        icone: Brain,
      },
    ],
  },
  {
    slug: "dinheiro",
    nome: "Dinheiro e pessoas",
    modulos: [
      {
        id: "receita",
        nome: "Receita e Repasses",
        resumo: "O dinheiro que circula entre matriz e unidades.",
        area: "receita",
        icone: CircleDollarSign,
        destino: { tipo: "interno", href: "/receita-overview" },
      },
      {
        id: "gente",
        nome: "Gente",
        resumo: "As pessoas da rede e o desenvolvimento delas.",
        area: "people",
        icone: UsersRound,
        destino: { tipo: "interno", href: "/gente" },
      },
    ],
  },
  {
    slug: "leitura",
    nome: "Leitura e gestão",
    modulos: [
      {
        id: "financeiro",
        nome: "Financeiro",
        resumo: "A contabilidade gerencial do grupo.",
        icone: Landmark,
        destino: { tipo: "financeiro", href: "/financeiro" },
      },
      {
        id: "desempenho",
        nome: "Desempenho da Rede",
        resumo: "Como cada unidade está indo, em números comparáveis.",
        area: "rede",
        icone: Activity,
        destino: { tipo: "interno", href: "/rede-overview" },
      },
      {
        id: "gestao",
        nome: "Gestão Executiva",
        resumo: "Metas, OKRs, tarefas e decisões da diretoria.",
        area: "cockpit_coo",
        icone: Target,
        destino: { tipo: "interno", href: "/cockpit-coo/compromissos" },
      },
      {
        id: "planejamento",
        nome: "Planejamento",
        resumo: "Forecast único de aquisição, monetização e retenção.",
        area: "cockpit_ceo",
        icone: CalendarRange,
      },
    ],
  },
];

const ROTULO =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

export function MapaDeModulos({
  alcanca,
  abrir,
}: {
  /** A pessoa consegue abrir este destino? */
  alcanca: (d: Destino) => boolean;
  abrir: (d: Destino) => void;
}) {
  return (
    <div className="w-full max-w-6xl space-y-8">
      <section aria-labelledby="mapa-experiencias" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="mapa-experiencias" className={ROTULO}>
            Experiências
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Montam telas dos módulos para um público e um recorte.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {EXPERIENCIAS.map((p) => (
            <CartaoPeca key={p.id} peca={p} alcanca={alcanca} abrir={abrir} />
          ))}
        </div>
      </section>

      <section aria-labelledby="mapa-modulos" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="mapa-modulos" className={ROTULO}>
            Módulos
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Da fundação à gestão. Cada um tem dono, dados e telas próprios.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CAMADAS.map((c) => (
            <div
              key={c.slug}
              role="group"
              aria-labelledby={`camada-${c.slug}`}
              className="flex flex-col gap-2 rounded-xl bg-muted/40 p-2"
            >
              <h3 id={`camada-${c.slug}`} className={cn(ROTULO, "px-1.5 pb-0.5 pt-1")}>
                {c.nome}
              </h3>
              {c.modulos.map((p) => (
                <CartaoPeca key={p.id} peca={p} alcanca={alcanca} abrir={abrir} />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CartaoPeca({
  peca,
  alcanca,
  abrir,
}: {
  peca: Peca;
  alcanca: (d: Destino) => boolean;
  abrir: (d: Destino) => void;
}) {
  const corpo = (
    <>
      <span className="flex items-center gap-2">
        <AnelArea area={peca.area ?? ""} icone={peca.icone} tamanho="sm" />
        <span className="text-sm font-semibold leading-tight text-foreground">{peca.nome}</span>
      </span>
      <span className="block text-[13px] leading-snug text-muted-foreground">{peca.resumo}</span>
    </>
  );

  // Ainda não existe: tracejado, sem clique.
  if (!peca.destino) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-card/60 p-3">
        {corpo}
        <StatusBadge tom="neutro" className="self-start">
          Planejado
        </StatusBadge>
      </div>
    );
  }

  const destino = peca.destino;
  if (!alcanca(destino)) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 opacity-70">
        {corpo}
        <StatusBadge tom="neutro" className="self-start">
          Sem acesso
        </StatusBadge>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => abrir(destino)}
      className="group relative flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors duration-120 ease-planning hover:border-input hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {corpo}
    </button>
  );
}

export type { Destino };
