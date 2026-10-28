/**
 * Contas da tela /comites (contrato docs/design/contratos/comites.md;
 * PRD wiki/prds/2026-10-ops-comites-da-rede.md).
 *
 * As respostas chegam cruas de ops.pesquisa_satisfacao_comite_socios e a conta
 * de cada comitê fica aqui, para o teste cobrir a régua do NPS (R-03) e das
 * médias (R-04) sem banco.
 */

export type TipoComite = "operacoes" | "growth" | "outro";

export type Comite = {
  id: string;
  codigo: string;
  tipo: TipoComite;
  titulo: string;
  data: string | null;
  apresentacao_url: string | null;
  apresentacao_arquivo: string | null;
  apresentacao_nome: string | null;
  gravacao_url: string | null;
  pesquisa_aberta: boolean;
};

export type Resposta = {
  id: number;
  created_at: string;
  comite_codigo: string | null;
  nps_recomendaria: number;
  clareza_resultados: number;
  utilidade_novidades: number;
  clareza_proximos_passos: number;
  frente_prioritaria: string | null;
  comentario: string | null;
};

export type Resumo = {
  respostas: number;
  /** % promotores menos % detratores, de -100 a 100; null sem resposta. */
  nps: number | null;
  promotores: number;
  neutros: number;
  detratores: number;
  clareza: number | null;
  utilidade: number | null;
  proximos: number | null;
  frentes: { codigo: string; rotulo: string; votos: number }[];
  comentarios: { quando: string; texto: string }[];
};

export const TIPOS: Record<TipoComite, string> = {
  operacoes: "Operações",
  growth: "Growth",
  outro: "Outro",
};

// Rótulos das frentes que o formulário grava (R-06). Código desconhecido aparece cru.
export const FRENTES: Record<string, string> = {
  cs_onboarding: "CS e onboarding",
  auditoria: "Auditoria e exposição de carteira",
  idu_metas: "IDU e metas por unidade",
  split_pagamento: "Split de pagamento",
  aquisicao_clientes: "Aquisição de clientes",
  midia_leads: "Mídia e leads",
  wallet: "Wallet",
  monetizacao_base: "Monetização da base",
  gmn_geo: "Google Meu Negócio e GEO",
  embaixadores_eventos: "Embaixadores e eventos",
  outra: "Outra",
};

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}

export function resumir(respostas: Resposta[]): Resumo {
  const n = respostas.length;
  const promotores = respostas.filter((r) => r.nps_recomendaria >= 9).length;
  const detratores = respostas.filter((r) => r.nps_recomendaria <= 6).length;
  const votos = new Map<string, number>();
  for (const r of respostas) {
    if (r.frente_prioritaria)
      votos.set(r.frente_prioritaria, (votos.get(r.frente_prioritaria) ?? 0) + 1);
  }
  return {
    respostas: n,
    nps: n ? Math.round(((promotores - detratores) / n) * 100) : null,
    promotores,
    neutros: n - promotores - detratores,
    detratores,
    clareza: media(respostas.map((r) => r.clareza_resultados)),
    utilidade: media(respostas.map((r) => r.utilidade_novidades)),
    proximos: media(respostas.map((r) => r.clareza_proximos_passos)),
    frentes: [...votos.entries()]
      .map(([codigo, v]) => ({ codigo, rotulo: FRENTES[codigo] ?? codigo, votos: v }))
      .sort((a, b) => b.votos - a.votos || a.rotulo.localeCompare(b.rotulo)),
    comentarios: respostas
      .filter((r) => r.comentario && r.comentario.trim())
      .map((r) => ({ quando: r.created_at, texto: r.comentario!.trim() }))
      .sort((a, b) => b.quando.localeCompare(a.quando)),
  };
}

/** Respostas de cada comitê, pela coluna comite_codigo. Sem código fica de fora. */
export function porComite(respostas: Resposta[]): Map<string, Resposta[]> {
  const m = new Map<string, Resposta[]>();
  for (const r of respostas) {
    if (!r.comite_codigo) continue;
    const lista = m.get(r.comite_codigo) ?? [];
    lista.push(r);
    m.set(r.comite_codigo, lista);
  }
  return m;
}

/** Mais recente primeiro; comitê sem data (ainda não marcado) vem no topo. */
export function ordenarComites(comites: Comite[]): Comite[] {
  return [...comites].sort((a, b) => {
    if (a.data === b.data) return a.titulo.localeCompare(b.titulo);
    if (!a.data) return -1;
    if (!b.data) return 1;
    return b.data.localeCompare(a.data);
  });
}

/** Endereço da pesquisa com o código do comitê (vai no QR do deck). */
export const URL_PESQUISA = "https://comite-pesquisa-planning17.vercel.app";
export function linkPesquisa(codigo: string) {
  return `${URL_PESQUISA}/?c=${encodeURIComponent(codigo)}`;
}

export function slugCodigo(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
