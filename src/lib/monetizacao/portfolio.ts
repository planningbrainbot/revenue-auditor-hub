import {
  baseRetroativaConsultoria,
  disponibilidade,
  hoje,
  limiteFaturamento,
  normal,
  oferta,
  SITUACOES_RECEITA,
} from "./model.ts";
import { ofertaRecon } from "./recon.ts";
import { PRODUTOS } from "./types.ts";
import type { BaseMonetizacao, Conta, Lista, Negocio, Oferta, Produto } from "./types";

export const ORIGENS_BASE = {
  antiga: "Base antiga",
  nova: "Base nova",
  divergente: "Origem divergente",
  confirmar: "Origem a confirmar",
} as const;
export type OrigemBase = keyof typeof ORIGENS_BASE;
export const origemBase = (a: Conta): OrigemBase => a.base_origin?.status || "confirmar";
// A conta retroativa sem regime continua visível para qualificação; não vira apta para envio.
export const potencialConsultoria = (a: Conta) =>
  baseRetroativaConsultoria(a) && oferta(a, "consultoria").status !== "fora_regra";
export const situacaoInicialProduto = (p: Produto | "") =>
  p === "consultoria" ? "potential" : p ? "eligible" : "";
export const situacoesIniciais = (p: Produto | "") => {
  const s = situacaoInicialProduto(p);
  return s ? [s] : [];
};

// Perfil (a conta atende à regra do produto?) e disponibilidade (já está em trabalho?) são
// dimensões separadas. "qualificar" é a pendência que o cartão do produto mostra; para
// Consultoria, só a base retroativa, não toda conta com origem pendente.
export const SITUACOES = {
  potential: "Base retroativa · aptas e regime a confirmar",
  free: "Prontas para enviar · aptas e disponíveis",
  eligible: "Aptas · perfil validado",
  occupied: "Aptas já em trabalho ou reservadas",
  qualificar: "A confirmar · ainda não validadas",
  review: "Dados a confirmar · todas as pendências",
  excluded: "Fora da regra do produto",
} as const;
export type Situacao = keyof typeof SITUACOES;

export const ABORDAGENS = {
  nunca: "Sem negócio, envio ou lista neste produto",
  aberta: "Negócio aberto no Pipedrive",
  enviada: "Envio registrado, negócio ainda não sincronizado",
  encerrada: "Abordada antes · negócio ganho ou perdido",
  sem_produto: "Negócio no Pipedrive sem produto definido",
  lista: "Em lista salva, ainda não enviada",
} as const;
export type Abordagem = keyof typeof ABORDAGENS;

// Deriva do mapa de model.ts: um rótulo só, para a tela e o filtro não divergirem.
export const SITUACOES_RECEITA_FILTRO = {
  ...SITUACOES_RECEITA,
  sem_consulta: "Sem consulta na Receita",
} as const;

export type PortfolioFilters = {
  query: string;
  receita: string[];
  band: string[];
  drivaBand: string[];
  segment: string[];
  contact: string[];
  regime: string[];
  origin: OrigemBase[];
  product: Produto | "";
  status: string[];
  approach: Abordagem[];
  overlap: boolean;
  unit: string[];
};
export const EMPTY_PORTFOLIO_FILTERS: PortfolioFilters = {
  query: "",
  receita: [],
  band: [],
  drivaBand: [],
  segment: [],
  contact: [],
  regime: [],
  origin: [],
  product: "",
  status: [],
  approach: [],
  overlap: false,
  unit: [],
};

type Dados = Pick<BaseMonetizacao, "cards" | "reservations" | "units"> & {
  lists?: Lista[];
};

type Reserva = BaseMonetizacao["reservations"][number];
type ItemEmLista = { lista: Lista; validada: boolean };
interface Indice {
  month: string;
  negocios: Map<number, Negocio[]>;
  reservas: Map<string, Reserva[]>;
  listas: Map<string, ItemEmLista[]>;
  estados: WeakMap<Conta, Partial<Record<Produto, EstadoProduto>>>;
}

// Índices por carga: negócios por organização, reservas e itens de lista por conta, e o estado
// já calculado de cada conta+produto. Cada interação reaproveita o que a carga já calculou, em
// vez de varrer negócios, listas e reservas para cada uma das ~10 mil contas.
const indices = new WeakMap<Dados, Indice>();
function indice(data: Dados): Indice {
  let idx = indices.get(data);
  if (idx) return idx;
  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  idx = {
    month: hoje().slice(0, 7),
    negocios: new Map(),
    reservas: new Map(),
    listas: new Map(),
    estados: new WeakMap(),
  };
  for (const c of data.cards) if (c.org_id !== null) push(idx.negocios, c.org_id, c);
  for (const r of data.reservations) push(idx.reservas, r.account_key, r);
  for (const lista of data.lists ?? [])
    for (const item of lista.items)
      if (!["sending", "sent", "uncertain"].includes(item.status))
        push(idx.listas, item.account_key + "|" + item.product, {
          lista,
          validada: item.status === "validated" || lista.status === "validated",
        });
  indices.set(data, idx);
  return idx;
}
function negociosDe(a: Conta, idx: Indice): Negocio[] {
  if (a.orgs.length === 1) return idx.negocios.get(a.orgs[0]) ?? [];
  return [...new Set(a.orgs.flatMap((o) => idx.negocios.get(o) ?? []))];
}
const quandoEncerrou = (c: Negocio) =>
  (c.status === "won" && c.won_on) || c.updated_at || c.created_at || "";

export interface EstadoProduto {
  perfil: Oferta;
  livre: boolean;
  motivoDisponibilidade: string;
  situacao: "free" | "occupied" | "qualificar" | "review" | "excluded";
  abordagem: Abordagem[];
  aberto: Negocio | null;
  encerrado: Negocio | null;
  semProduto: Negocio | null;
  envio: "registrado" | "incerto" | null;
  listas: ItemEmLista[];
}

// Uma leitura por conta+produto, compartilhada entre filtro, ordenação, contadores e tabela.
export function estadoProduto(a: Conta, produto: Produto, data: Dados): EstadoProduto {
  const idx = indice(data);
  const cached = idx.estados.get(a)?.[produto];
  if (cached) return cached;
  const perfil = oferta(a, produto);
  const deals = negociosDe(a, idx);
  const reservas = idx.reservas.get(a.key) ?? [];
  const disp = disponibilidade(a, produto, deals, idx.month, reservas);
  const own = deals.filter((c) => c.route === produto);
  const aberto = own.find((c) => c.status === "open") ?? null;
  const encerrado =
    own
      .filter((c) => c.status === "won" || c.status === "lost")
      .sort((x, y) => quandoEncerrou(y).localeCompare(quandoEncerrou(x)))[0] ?? null;
  const semProdutoDeals = deals.filter((c) => c.route === "sem_produto");
  const semProduto = semProdutoDeals.find((c) => c.status === "open") ?? semProdutoDeals[0] ?? null;
  // Reserva cujo negócio já chegou do Pipedrive é contada pelo negócio (aberto ou encerrado).
  const reserva = reservas.find(
    (r) =>
      r.product === produto &&
      ["sending", "sent", "uncertain"].includes(r.status) &&
      !(r.deal_id && deals.some((c) => c.id === r.deal_id)),
  );
  const envio = reserva ? (reserva.status === "uncertain" ? "incerto" : "registrado") : null;
  const listas = idx.listas.get(a.key + "|" + produto) ?? [];
  const abordagem: Abordagem[] = [];
  if (aberto) abordagem.push("aberta");
  else if (envio) abordagem.push("enviada");
  if (encerrado) abordagem.push("encerrada");
  if (semProduto) abordagem.push("sem_produto");
  if (listas.length) abordagem.push("lista");
  if (!abordagem.length) abordagem.push("nunca");
  const pendente =
    perfil.status === "revisar" && (produto !== "consultoria" || potencialConsultoria(a));
  const situacao =
    perfil.status === "elegivel"
      ? disp.free
        ? "free"
        : "occupied"
      : perfil.status === "fora_regra"
        ? "excluded"
        : pendente
          ? "qualificar"
          : "review";
  const estado: EstadoProduto = {
    perfil,
    livre: disp.free,
    motivoDisponibilidade: disp.reason,
    situacao,
    abordagem,
    aberto,
    encerrado,
    semProduto,
    envio,
    listas,
  };
  idx.estados.set(a, { ...idx.estados.get(a), [produto]: estado });
  return estado;
}

// Prontas primeiro; depois o que falta confirmar; por último o que já está em trabalho ou fora.
const ORDEM: Record<EstadoProduto["situacao"], number> = {
  free: 0,
  qualificar: 1,
  review: 2,
  occupied: 3,
  excluded: 4,
};

export function atendeSituacao(a: Conta, produto: Produto, state: string, e: EstadoProduto) {
  switch (state) {
    case "potential":
      return produto === "consultoria" && potencialConsultoria(a);
    case "free":
      return e.situacao === "free";
    case "occupied":
      return e.situacao === "occupied";
    case "eligible":
      return e.perfil.status === "elegivel";
    case "qualificar":
      return e.situacao === "qualificar";
    case "review":
      return e.perfil.status === "revisar";
    case "excluded":
      return e.perfil.status === "fora_regra";
    default:
      return true;
  }
}

// "unknown" é não saber nada: conta com teto pelo porte tem opção própria ("teto:0.36"), para o
// recorte por faixa não esconder justamente as que o teto tornou aptas.
const atendeFaixa = (a: Conta, b: string) =>
  b === "unknown"
    ? !a.band && a.faturamento_teto == null
    : b.startsWith("exact:")
      ? a.band === b.slice(6)
      : b.startsWith("teto:")
        ? !a.band && a.faturamento_teto === Number(b.slice(5))
        : (limiteFaturamento(a)?.[0] ?? -1) >= Number(b);

// Dentro de um filtro, as opções marcadas somam (OU). Entre filtros, vale a interseção (E).
// Filtro vazio não restringe. Situação vazia usa a situação inicial do produto.
export function filtrarCarteira(
  accounts: Conta[],
  f: PortfolioFilters,
  data: Dados,
  { ignorarSituacao = false }: { ignorarSituacao?: boolean } = {},
): Conta[] {
  const units = f.unit.length
    ? new Set(data.units.filter((u) => f.unit.includes(u.key)).flatMap((u) => u.account_keys))
    : null;
  const query = normal(f.query);
  const states = f.status.length ? f.status : situacoesIniciais(f.product);
  const estados = new Map<string, EstadoProduto>();
  const rows = accounts.filter((a) => {
    if (units && !units.has(a.key)) return false;
    if (f.origin.length && !f.origin.includes(origemBase(a))) return false;
    if (query && !normal([a.name, a.segment, a.unit_label].join(" ")).includes(query)) return false;
    if (f.band.length && !f.band.some((b) => atendeFaixa(a, b))) return false;
    if (
      f.drivaBand.length &&
      !(a.driva?.group_revenue_band && f.drivaBand.includes(a.driva.group_revenue_band))
    )
      return false;
    if (
      f.segment.length &&
      !f.segment.some((s) => (s === "unknown" ? !a.segment : a.segment === s))
    )
      return false;
    if (
      f.regime.length &&
      !f.regime.some((r) => (r === "unknown" ? !a.regime : normal(a.regime) === normal(r)))
    )
      return false;
    if (f.contact.length && !f.contact.includes(String(a.contact))) return false;
    if (f.receita.length && !f.receita.includes(a.situacao_receita ?? "sem_consulta")) return false;
    if (
      f.overlap &&
      PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").length +
        Number(ofertaRecon(a).status === "elegivel") <
        2
    )
      return false;
    if (f.product) {
      const e = estadoProduto(a, f.product, data);
      estados.set(a.key, e);
      if (!ignorarSituacao && !states.some((s) => atendeSituacao(a, f.product as Produto, s, e)))
        return false;
      if (f.approach.length && !f.approach.some((x) => e.abordagem.includes(x))) return false;
    }
    return true;
  });
  // Ordena pelo mesmo limite que decide a oferta: quem tem teto pelo porte fica acima de quem não
  // tem faturamento nenhum, em vez de empatar no fim da lista.
  const faixa = (a: Conta) => {
    const l = limiteFaturamento(a);
    return l ? l[0] : -1;
  };
  return rows.sort(
    (a, b) =>
      (f.product ? ORDEM[estados.get(a.key)!.situacao] - ORDEM[estados.get(b.key)!.situacao] : 0) ||
      faixa(b) - faixa(a) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}
