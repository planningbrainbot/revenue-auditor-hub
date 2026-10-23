// Régua da aba Cella da Monetização (`/monetizacao?aba=cella`, contrato docs/design/contratos/monetizacao-cella.md).
// Uma linha por card da Planning ligado ao funil 9 da Diehl & Cella: o contrato (negócio principal lá) e as teses do
// mesmo cliente, com o valor que a Cella cadastrar. Sem dependência de React: os testes importam este arquivo no Node.

/** Honorário de êxito do contrato do Radar Jurídico Tributário (20% do crédito apurado; decisão do Pedro em 22/10/2026). */
export const PERCENTUAL_HONORARIO = 0.2;
/** Parte da Planning no honorário da parceria (regra do deck de 13/10/2026). */
export const PARTE_PLANNING = 0.25;
/** Etapas do funil 9 deles. */
export const ETAPAS_DELES: Record<number, string> = {
  35: "Reunião agendada",
  36: "Proposta enviada ou negociação",
  37: "Stand by",
};

export type NegocioDeles = {
  cella_deal_id: number;
  deal_id: number;
  principal: boolean;
  titulo: string;
  status: string;
  stage_id: number | null;
  valor: number | string;
  data_contrato: string | null;
  tipo_contrato: string | null;
  atualizado_deles_em: string | null;
};

export type CellaBruto = {
  sync: { rodado_em: string | null; status: string | null } | null;
  cards: {
    id: number;
    pipe: number;
    nome: string;
    titulo?: string | null;
    url: string | null;
    status: string;
    etapa: string | null;
    dono: string | null;
    unidade: string | null;
  }[];
  envios: {
    deal_id: number;
    estado: string;
    vinculo: string | null;
    status_deles: string | null;
    cella_deal_id: number | null;
    assinatura: string | null;
  }[];
  negocios: NegocioDeles[];
};

export const VISOES_CELLA = ["contratos", "sem-valor", "abertos", "divergentes"] as const;
export type VisaoCella = (typeof VISOES_CELLA)[number];

export type Tese = { titulo: string; status: string; valor: number; etapa: string | null };

export type LinhaCella = {
  deal_id: number;
  nome: string;
  /** Nome da organização no Pipedrive da Planning, quando é outro (ex.: a Tech Med está na org "REVENDEDOR PHILIPS"). */
  org: string | null;
  url: string | null;
  unidade: string | null;
  dono: string | null;
  etapaAqui: string | null;
  statusAqui: string;
  /** Situação do negócio principal no funil deles: open, won ou lost; null quando o negócio sumiu de lá. */
  statusLa: string | null;
  etapaLa: string | null;
  assinadoEm: string | null;
  diasDesdeAssinatura: number | null;
  teses: Tese[];
  /** Negócios do mesmo cliente que não são tese (mensalidade, assessoria): fora do crédito. */
  outros: Tese[];
  credito: number;
  honorario: number;
  planning: number;
  atualizadoLa: string | null;
  assinado: boolean;
  semValor: boolean;
  aberto: boolean;
  divergente: boolean;
};

const numero = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const naoETese = (n: NegocioDeles) =>
  /assessoria|mensal|mensalidade/i.test(n.titulo) || /Mensal$/.test(n.tipo_contrato ?? "");
/** Título do card sem o sufixo do envio ("· Cella [AQ:…]") nem "(cópia)". */
export function nomeDoCard(titulo: string | null | undefined, org: string): string {
  const t = String(titulo ?? "")
    .replace(/\s*·.*$/, "")
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\(c[óo]pia\)/gi, "")
    .trim();
  return t || org;
}
const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\W+/)[0] ?? "";
const dias = (de: string, ate: string) =>
  Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

export function montarCella(b: CellaBruto, hoje: string): LinhaCella[] {
  const envio = new Map(b.envios.map((e) => [Number(e.deal_id), e]));
  const porCard = new Map<number, NegocioDeles[]>();
  for (const n of b.negocios) {
    const l = porCard.get(Number(n.deal_id)) ?? [];
    l.push(n);
    porCard.set(Number(n.deal_id), l);
  }
  return b.cards
    .map((c): LinhaCella => {
      const e = envio.get(Number(c.id));
      const deles = porCard.get(Number(c.id)) ?? [];
      const principal =
        deles.find((n) => n.principal && Number(n.cella_deal_id) === Number(e?.cella_deal_id)) ??
        deles.find((n) => n.principal) ??
        null;
      const extras = deles.filter((n) => n !== principal);
      const paraTese = (n: NegocioDeles): Tese => ({
        titulo: n.titulo,
        status: n.status,
        valor: numero(n.valor),
        etapa: n.stage_id != null ? (ETAPAS_DELES[n.stage_id] ?? null) : null,
      });
      const teses = extras.filter((n) => !naoETese(n)).map(paraTese);
      const outros = extras.filter(naoETese).map(paraTese);
      const credito = teses.filter((t) => t.status !== "lost").reduce((s, t) => s + t.valor, 0);
      const honorario = credito * PERCENTUAL_HONORARIO;
      const statusLa = principal?.status ?? null;
      const assinadoEm = (statusLa === "won" ? principal?.data_contrato : null) ?? null;
      const assinado = statusLa === "won";
      return {
        deal_id: Number(c.id),
        nome: nomeDoCard(c.titulo, c.nome),
        org: chave(nomeDoCard(c.titulo, c.nome)) === chave(c.nome) ? null : c.nome,
        url: c.url,
        unidade: c.unidade,
        dono: c.dono,
        etapaAqui: c.etapa,
        statusAqui: c.status,
        statusLa,
        etapaLa: principal?.stage_id != null ? (ETAPAS_DELES[principal.stage_id] ?? null) : null,
        assinadoEm,
        diasDesdeAssinatura: assinadoEm ? dias(assinadoEm, hoje) : null,
        teses,
        outros,
        credito,
        honorario,
        planning: honorario * PARTE_PLANNING,
        atualizadoLa: principal?.atualizado_deles_em ?? null,
        assinado,
        semValor: assinado && !teses.some((t) => t.valor > 0 && t.status !== "lost"),
        aberto: statusLa === "open",
        // Aberto aqui e fechado lá (o envio parou de mexer), ou perdido aqui com o contrato aberto lá.
        divergente: e?.estado === "parado_deles" || (c.status === "lost" && statusLa === "open"),
      };
    })
    .sort(
      (a, b) =>
        Number(b.assinado) - Number(a.assinado) ||
        (a.assinadoEm ?? "9").localeCompare(b.assinadoEm ?? "9") ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

export function filtrarCella(linhas: LinhaCella[], visao: VisaoCella): LinhaCella[] {
  if (visao === "sem-valor") return linhas.filter((l) => l.semValor);
  if (visao === "abertos") return linhas.filter((l) => l.aberto);
  if (visao === "divergentes") return linhas.filter((l) => l.divergente);
  return linhas.filter((l) => l.assinado);
}

export function resumoCella(linhas: LinhaCella[]) {
  const assinados = linhas.filter((l) => l.assinado);
  const credito = assinados.reduce((s, l) => s + l.credito, 0);
  return {
    assinados: assinados.length,
    semValor: assinados.filter((l) => l.semValor).length,
    credito,
    honorario: credito * PERCENTUAL_HONORARIO,
    planning: credito * PERCENTUAL_HONORARIO * PARTE_PLANNING,
    abertos: linhas.filter((l) => l.aberto).length,
    divergentes: linhas.filter((l) => l.divergente).length,
  };
}
