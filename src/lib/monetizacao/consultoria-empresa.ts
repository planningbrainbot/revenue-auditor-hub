// Régua da aba "Buscar empresa" da tela Consultoria (`/monetizacao?aba=handoff-consultoria&visao=empresa`).
// Contrato: docs/design/contratos/monetizacao-consultoria-empresa.md. Pura: junta, por CNPJ, o que as duas outras
// abas já leem — a plataforma da Consultoria, as propostas, os negócios ganhos e a PAT (RPC do Cruzamento) e o
// onboarding (RPC do Handoff) — e responde "qual é o estado desta empresa na Consultoria?".
import type { ClienteBruto, PainelBruto } from "./handoff-consultoria.ts";
import {
  montarCruzamento,
  type Cliente,
  type ClienteApi,
  type CruzamentoBruto,
  type Negocio,
  type Proposta,
} from "./cruzamento-consultoria.ts";

export type TomSituacao = "sucesso" | "info" | "atencao" | "perigo" | "neutro";

export interface MesPatEmpresa {
  mes: string;
  faturado: number;
  recebido: number;
}

export interface Empresa {
  /** CNPJ (só dígitos) quando houver; sem ele, `card:<id>` do onboarding ou `deal:<id>` do Pipedrive. */
  chave: string;
  nome: string;
  cnpj: string | null;
  raiz: string | null;
  /** Todos os CNPJs que caem nesta ficha: o da plataforma e os do onboarding e dos negócios ligados pela raiz. */
  cnpjs: string[];
  /** Todos os nomes por que a empresa aparece (razão, fantasia, título do card, título do negócio). */
  nomes: string[];
  plataforma: { cliente: Cliente; api: ClienteApi } | null;
  propostas: Proposta[];
  negocios: Negocio[];
  onboarding: ClienteBruto[];
  /** PAT por mês (CNPJ exato; sem ele, a raiz). `null` sem a porta do Financeiro. */
  pat: MesPatEmpresa[] | null;
  situacao: { rotulo: string; tom: TomSituacao; detalhe: string };
}

const so = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const semAcento = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const ETAPA: Record<string, string> = {
  fila_processamento: "Fila de Processamento",
  fluxo_documentos: "Fluxo de Documentos",
  operacao: "Operação",
  qualidade: "Qualidade",
  saida_entrega: "Saída / Entrega",
  pos_entrega: "Pós-entrega",
};
export const rotuloEtapa = (e: string | null) => (e ? (ETAPA[e] ?? e) : "—");

/** A situação da empresa na Consultoria, da mais avançada para a menos. */
export function situacaoDa(e: Omit<Empresa, "situacao">): Empresa["situacao"] {
  const c = e.plataforma?.cliente;
  const api = e.plataforma?.api;
  if (c) {
    const recuperado = num(api?.credito_recuperado);
    if (recuperado > 0)
      return {
        rotulo: "Crédito recuperado",
        tom: "sucesso",
        detalhe: "a plataforma informa crédito já recuperado",
      };
    if (c.posEntregaComValor)
      return {
        rotulo: "Diagnóstico entregue",
        tom: "info",
        detalhe: "em Pós-entrega com valor identificado: esperando a negociação",
      };
    const abertos = c.projetos.filter((p) => !p.encerrado && !p.entregue);
    const etapa = abertos.sort((a, b) => (b.cadastrado ?? "").localeCompare(a.cadastrado ?? ""))[0]
      ?.etapa;
    if (etapa === "fluxo_documentos" || etapa === "fila_processamento")
      return {
        rotulo: "Esperando documentos",
        tom: "atencao",
        detalhe: `projeto em ${rotuloEtapa(etapa)}`,
      };
    if (etapa)
      return { rotulo: "Em diagnóstico", tom: "info", detalhe: `projeto em ${rotuloEtapa(etapa)}` };
    if (c.projetos.length)
      return {
        rotulo: "Projetos encerrados",
        tom: "neutro",
        detalhe: "nenhum projeto aberto agora",
      };
    return {
      rotulo: "Cadastrada, sem projeto",
      tom: "neutro",
      detalhe: "na plataforma, ainda sem projeto",
    };
  }
  if (e.onboarding.some((o) => o.encaminhado === "Sim"))
    return {
      rotulo: "Encaminhada, fora da plataforma",
      tom: "perigo",
      detalhe: 'marcada "Sim" no kickoff e não cadastrada na plataforma',
    };
  if (e.onboarding.length)
    return { rotulo: "No onboarding", tom: "neutro", detalhe: "ainda não chegou à Consultoria" };
  return {
    rotulo: "Vendida, fora da plataforma",
    tom: "neutro",
    detalhe: "negócio ganho em 2026, sem cadastro na plataforma",
  };
}

/** O índice de empresas: uma por CNPJ, mais as do onboarding e dos negócios que não têm CNPJ. */
export function indiceEmpresas(
  cruzamento: CruzamentoBruto,
  handoff: PainelBruto | null,
  hoje: string,
): Empresa[] {
  const p = montarCruzamento(cruzamento, hoje);
  const apiPorId = new Map((cruzamento.clientes ?? []).map((c) => [String(c.id), c]));
  const porChave = new Map<string, Omit<Empresa, "situacao">>();
  const nova = (chave: string, nome: string, cnpj: string | null): Omit<Empresa, "situacao"> => ({
    chave,
    nome,
    cnpj,
    raiz: cnpj && cnpj.length === 14 ? cnpj.slice(0, 8) : null,
    cnpjs: cnpj ? [cnpj] : [],
    nomes: [nome],
    plataforma: null,
    propostas: [],
    negocios: [],
    onboarding: [],
    pat: null,
  });
  // Raiz → cliente da plataforma: o onboarding e o negócio com o CNPJ de uma filial caem na ficha da empresa que
  // está na plataforma (a mesma régua do Handoff, que casa pelo CNPJ e, sem ele, pela raiz).
  const raizNaPlataforma = new Map<string, Omit<Empresa, "situacao">>();
  const pegar = (cnpj: string | null, fallback: string, nome: string, seguirRaiz = true) => {
    const raiz = cnpj && cnpj.length === 14 ? cnpj.slice(0, 8) : null;
    let chave = cnpj ?? fallback;
    if (seguirRaiz && cnpj && !porChave.has(cnpj) && raiz && raizNaPlataforma.has(raiz)) {
      const alvo = raizNaPlataforma.get(raiz)!;
      chave = alvo.chave;
      if (!alvo.cnpjs.includes(cnpj)) alvo.cnpjs.push(cnpj);
    }
    let e = porChave.get(chave);
    if (!e) {
      e = nova(chave, nome, cnpj);
      porChave.set(chave, e);
    } else if (!e.nomes.includes(nome)) e.nomes.push(nome);
    return e;
  };

  for (const c of p.clientes) {
    const api = apiPorId.get(c.id);
    const e = pegar(c.cnpj, `cliente:${c.id}`, c.nome, false);
    e.plataforma = api ? { cliente: c, api } : null;
    // Duas filiais na plataforma ficam em fichas separadas; o que vier de fora vai para a matriz, se ela estiver lá.
    if (e.raiz && (!raizNaPlataforma.has(e.raiz) || e.cnpj?.slice(8, 12) === "0001"))
      raizNaPlataforma.set(e.raiz, e);
    for (const n of [api?.razao_social, api?.nome_fantasia])
      if (n && !e.nomes.includes(n)) e.nomes.push(n);
  }
  for (const o of handoff?.clientes ?? []) {
    const e = pegar(so(o.cnpj) || null, `card:${o.card}`, o.titulo);
    e.onboarding.push(o);
  }
  for (const n of p.negocios) {
    const e = pegar(n.cnpj, `deal:${n.deal}`, n.titulo);
    e.negocios.push(n);
    if (n.organizacao && !e.nomes.includes(n.organizacao)) e.nomes.push(n.organizacao);
  }
  // Propostas: CNPJ exato; sem ele, a raiz de uma empresa com CNPJ; sem CNPJ, o nome igual ao de uma empresa.
  const porRaiz = new Map<string, Omit<Empresa, "situacao">>();
  const porNome = new Map<string, Omit<Empresa, "situacao">>();
  for (const e of porChave.values()) {
    if (e.raiz && !porRaiz.has(e.raiz)) porRaiz.set(e.raiz, e);
    for (const n of e.nomes) if (!porNome.has(semAcento(n))) porNome.set(semAcento(n), e);
  }
  const porCnpj = new Map<string, Omit<Empresa, "situacao">>();
  for (const e of porChave.values())
    for (const c of e.cnpjs) if (!porCnpj.has(c)) porCnpj.set(c, e);
  for (const pr of p.propostas) {
    const alvo =
      (pr.cnpj && porCnpj.get(pr.cnpj)) ||
      (pr.cnpj && pr.cnpj.length === 14 && porRaiz.get(pr.cnpj.slice(0, 8))) ||
      porNome.get(semAcento(pr.empresa));
    if (alvo) alvo.propostas.push(pr);
  }
  // PAT por mês: CNPJ exato; sem ele, a raiz (a mesma regra do Handoff).
  const pat = cruzamento.porta_financeiro.aberta ? (cruzamento.pat ?? []) : null;
  const patPor = new Map<string, MesPatEmpresa[]>();
  for (const x of pat ?? [])
    patPor.set(x.cnpj, [
      ...(patPor.get(x.cnpj) ?? []),
      { mes: x.mes.slice(0, 7), faturado: num(x.faturado), recebido: num(x.recebido) },
    ]);
  for (const e of porChave.values()) {
    if (!pat) continue;
    if (!e.cnpj) {
      e.pat = [];
      continue;
    }
    const exatas = e.cnpjs.flatMap((c) => patPor.get(c) ?? []);
    const linhas =
      (exatas.length ? exatas : null) ??
      (e.raiz
        ? pat
            .filter((x) => x.cnpj.slice(0, 8) === e.raiz)
            .map((x) => ({
              mes: x.mes.slice(0, 7),
              faturado: num(x.faturado),
              recebido: num(x.recebido),
            }))
        : []);
    const mes = new Map<string, MesPatEmpresa>();
    for (const l of linhas) {
      const m = mes.get(l.mes) ?? { mes: l.mes, faturado: 0, recebido: 0 };
      m.faturado += l.faturado;
      m.recebido += l.recebido;
      mes.set(l.mes, m);
    }
    e.pat = [...mes.values()]
      .filter((m) => m.faturado || m.recebido)
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }
  return [...porChave.values()].map((e) => ({ ...e, situacao: situacaoDa(e) }));
}

/** Busca por nome (todas as palavras, sem acento) ou por CNPJ (3 dígitos ou mais, também a raiz). */
export function buscarEmpresas(indice: Empresa[], q: string, limite = 30): Empresa[] {
  const texto = semAcento(q);
  const digitos = q.replace(/\D/g, "");
  if (texto.length < 2 && digitos.length < 3) return [];
  const palavras = texto.split(/\s+/).filter((w) => w && !/^\d+$/.test(w) && !/[./-]/.test(w));
  const pontos = (e: Empresa) => {
    if (digitos.length >= 3 && e.cnpjs.length) {
      if (e.cnpjs.includes(digitos)) return 100;
      if (e.cnpjs.some((c) => c.startsWith(digitos))) return 80;
      if (e.cnpjs.some((c) => c.includes(digitos))) return 60;
    }
    if (palavras.length) {
      const nomes = e.nomes.map(semAcento);
      if (nomes.some((n) => n === texto)) return 90;
      if (nomes.some((n) => n.startsWith(texto))) return 70;
      if (nomes.some((n) => palavras.every((w) => n.includes(w)))) return 50;
    }
    return 0;
  };
  return indice
    .map((e) => ({ e, p: pontos(e) }))
    .filter((x) => x.p > 0)
    .sort(
      (a, b) =>
        b.p - a.p ||
        Number(!!b.e.plataforma) - Number(!!a.e.plataforma) ||
        (b.e.plataforma?.cliente.valor ?? 0) - (a.e.plataforma?.cliente.valor ?? 0) ||
        a.e.nome.localeCompare(b.e.nome, "pt-BR"),
    )
    .slice(0, limite)
    .map((x) => x.e);
}

/** As outras empresas do mesmo grupo: mesma raiz de CNPJ ou mesmo grupo econômico na plataforma. */
export function doMesmoGrupo(indice: Empresa[], e: Empresa): Empresa[] {
  const grupo = semAcento(e.plataforma?.api.grupo_economico);
  return indice.filter(
    (x) =>
      x.chave !== e.chave &&
      ((e.raiz && x.raiz === e.raiz) ||
        (grupo && semAcento(x.plataforma?.api.grupo_economico) === grupo)),
  );
}
