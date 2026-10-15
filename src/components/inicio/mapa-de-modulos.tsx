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

/**
 * A porta de entrada organizada pelas três frentes do Brain, só para o super
 * admin.
 *
 * É a mesma divisão do material de investidores ("Planning em Detalhe", seção
 * Produto, 15/10/2026): aquisição traz clientes novos para as unidades,
 * monetização leva novos serviços a quem já é cliente e retenção é a gestão da
 * rede no dia a dia. Os módulos do mapa de 09/10 cabem nelas; os que servem às
 * três ficam fora das colunas, em Gestão (lê as três) e Base comum (sustenta as
 * três).
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

type Frente = {
  slug: string;
  nome: string;
  /** A tese da frente, com as palavras do material de investidores. */
  tese: string;
  /** Onde ela mora hoje. */
  produto: string;
  pecas: Peca[];
};

export const FRENTES: Frente[] = [
  {
    slug: "aquisicao",
    nome: "Aquisição",
    tese: "Uma máquina de vendas que entrega clientes às unidades",
    produto: "Brain Growth",
    pecas: [
      {
        id: "marketing",
        nome: "Marketing e Mídia",
        resumo: "Investimento, leads, CAC e ROAS por campanha.",
        icone: Megaphone,
        destino: { tipo: "growth", href: "/growth/trafego" },
      },
      {
        id: "comercial",
        nome: "Comercial",
        resumo: "Funil, ligações avaliadas por IA e distribuição de leads.",
        icone: Handshake,
        destino: { tipo: "growth", href: "/growth/comercial" },
      },
      {
        id: "brain_meet",
        nome: "Brain Meet",
        resumo: "Reuniões gravadas, transcritas e resumidas.",
        icone: Video,
        destino: { tipo: "meet", href: "/growth/meet" },
      },
      {
        id: "aquisicao",
        nome: "Broker",
        resumo: "Clientes da matriz vendidos às unidades, com o CAC.",
        area: "broker",
        icone: Store,
        destino: { tipo: "interno", href: "/broker" },
      },
    ],
  },
  {
    slug: "monetizacao",
    nome: "Monetização",
    tese: "Cada cliente da base é um novo ponto de venda",
    produto: "Base do Brain",
    pecas: [
      {
        id: "clientes",
        nome: "Base de clientes",
        resumo: "Regime, porte e segmento de cada empresa.",
        area: "clientes",
        icone: Building2,
        destino: { tipo: "interno", href: "/clientes" },
      },
      {
        id: "monetizacao",
        nome: "Monetização",
        resumo: "Novos serviços para a base, com cadência de contato.",
        area: "monetizacao",
        icone: Coins,
        destino: { tipo: "interno", href: "/monetizacao" },
      },
      {
        id: "inteligencia",
        nome: "Inteligência da Base",
        resumo: "Necessidade detectada na contabilidade de cada cliente.",
        area: "clientes",
        icone: Brain,
      },
      {
        id: "ofertas",
        nome: "Parceiros e Ofertas",
        resumo: "Quem executa, o que se vende e quanto cada um leva.",
        area: "monetizacao",
        icone: Briefcase,
      },
      {
        id: "portal_executor",
        nome: "Portal do executor",
        resumo: "Os contratos repassados a cada executor externo.",
        area: "monetizacao",
        icone: BriefcaseBusiness,
      },
    ],
  },
  {
    slug: "retencao",
    nome: "Retenção",
    tese: "A rede funciona como uma empresa só",
    produto: "Brain Ops e Financeiro",
    pecas: [
      {
        id: "desempenho",
        nome: "Desempenho da Rede",
        resumo: "Nota de 0 a 100, ranking e metas de cada unidade.",
        area: "rede",
        icone: Activity,
        destino: { tipo: "interno", href: "/rede-overview" },
      },
      {
        id: "cs",
        nome: "CS e Relacionamento",
        resumo: "NPS, auditoria e acompanhamento do cliente.",
        area: "rede",
        icone: HeartPulse,
        destino: { tipo: "interno", href: "/painel-cs" },
      },
      {
        id: "receita",
        nome: "Receita e Repasses",
        resumo: "Royalties, faturamento e split por unidade e mês.",
        area: "receita",
        icone: CircleDollarSign,
        destino: { tipo: "interno", href: "/receita-overview" },
      },
      {
        id: "financeiro",
        nome: "Financeiro",
        resumo: "Fluxo de caixa, DRE e inadimplência do grupo.",
        icone: Landmark,
        destino: { tipo: "financeiro", href: "/financeiro" },
      },
      {
        id: "gente",
        nome: "Gente",
        resumo: "Avaliação, PDI e clima das pessoas da rede.",
        area: "people",
        icone: UsersRound,
        destino: { tipo: "interno", href: "/gente" },
      },
      {
        id: "minha_unidade",
        nome: "Minha Unidade",
        resumo: "O Brain recortado para o sócio e a equipe da unidade.",
        area: "minha_unidade",
        icone: Gauge,
        destino: { tipo: "ver_como", href: "/painel-unidade" },
      },
    ],
  },
];

/** Lê as três frentes. */
export const GESTAO: Peca[] = [
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
];

/** Sustenta as três frentes. */
export const BASE_COMUM: Peca[] = [
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
    resumo: "Os sistemas de fora traduzidos para o vocabulário de dentro.",
    area: "admin",
    icone: Plug,
    destino: { tipo: "interno", href: "/admin/integracoes" },
  },
];

const ROTULO = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

export function MapaDeModulos({
  alcanca,
  abrir,
}: {
  /** A pessoa consegue abrir este destino? */
  alcanca: (d: Destino) => boolean;
  abrir: (d: Destino) => void;
}) {
  const props = { alcanca, abrir };
  return (
    <div className="w-full max-w-6xl space-y-8">
      <div className="grid gap-4 lg:grid-cols-3">
        {FRENTES.map((f) => (
          <section
            key={f.slug}
            aria-labelledby={`frente-${f.slug}`}
            className="flex flex-col gap-2 rounded-xl bg-muted/40 p-2"
          >
            <header className="space-y-1 px-1.5 pb-1.5 pt-1">
              <h2 id={`frente-${f.slug}`} className={ROTULO}>
                {f.nome}
              </h2>
              {/* Duas linhas reservadas no desktop: a tese curta não desalinha os cartões. */}
              <p className="text-base font-semibold leading-snug text-foreground lg:min-h-[2lh]">
                {f.tese}
              </p>
              <p className="text-xs text-muted-foreground">{f.produto}</p>
            </header>
            {f.pecas.map((p) => (
              <CartaoPeca key={p.id} peca={p} {...props} />
            ))}
          </section>
        ))}
      </div>

      <Faixa id="gestao" titulo="Gestão" legenda="Lê as três frentes." pecas={GESTAO} {...props} />
      <Faixa
        id="base-comum"
        titulo="Base comum"
        legenda="Sustenta as três frentes."
        pecas={BASE_COMUM}
        {...props}
      />
    </div>
  );
}

function Faixa({
  id,
  titulo,
  legenda,
  pecas,
  alcanca,
  abrir,
}: {
  id: string;
  titulo: string;
  legenda: string;
  pecas: Peca[];
  alcanca: (d: Destino) => boolean;
  abrir: (d: Destino) => void;
}) {
  return (
    <section aria-labelledby={`faixa-${id}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`faixa-${id}`} className={ROTULO}>
          {titulo}
        </h2>
        <p className="text-[13px] text-muted-foreground">{legenda}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pecas.map((p) => (
          <CartaoPeca key={p.id} peca={p} alcanca={alcanca} abrir={abrir} />
        ))}
      </div>
    </section>
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
