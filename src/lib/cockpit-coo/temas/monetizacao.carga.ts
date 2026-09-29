// Adaptador do tema Qui · Monetização: da carga que a tela da Monetização já baixa
// (`useMonetizacao()`: carregarMonetizacao + as páginas de carregarContasBase) para os dados
// simples que `montarMonetizacao` lê. Roda no NAVEGADOR; não há consulta nova ao banco, e a
// pessoa não vê nada que já não visse na Base de clientes e na Monetização.
//
// As regras são as da tela, importadas, nunca copiadas:
// - elegível = `oferta(conta, produto).status === "elegivel"` em Consultoria, Finance ou Cella
//   (a mesma chamada dos cartões da Base por unidade, `components/monetizacao/aquario.tsx`);
// - contato = `conta.contact`, que é o `com_contato` da Base. As contas já chegam com
//   `aplicarBase` aplicado pelo servidor (`lerContasBase`), e o adaptador não o reaplica;
// - unidades da conta = `unit_ids` (`ops.monetizacao_contas.unidade_ids`), que a carga traz em
//   cada conta. NÃO se usa `units[].account_keys`: `ops.monetizacao_unidades` não tem Construção
//   Civil, Consultoria, Sorocaba nem São Paulo, e São Bernardo está sem `unidade_id` (29/09);
// - unidades do negócio = união das unidades das contas cuja organização do Pipedrive é a do
//   negócio: a mesma regra que grava `ops.monetizacao_deals.unidade_ids` no sync
//   (`ops.monetizacao_replace_snapshot`), refeita aqui porque a carga não traz essa coluna.
//
// Imports relativos com extensão: o script de homologação roda este arquivo no Node.
import { cargaDoCrm, LIMITE_CARGA_PARADA_MS, oferta } from "../../monetizacao/model.ts";
import { PRODUTOS } from "../../monetizacao/types.ts";
import type { BaseMonetizacao, Conta, Metrica, Negocio } from "../../monetizacao/types";
import { inicioDaLeitura } from "./monetizacao.ts";
import type { DadosMonetizacao, GrupoBase, NegocioRegua } from "./monetizacao.ts";

type ContaDaCarga = Conta & { unit_ids?: number[] };

const EVENTOS = ["started", "scheduled", "meeting", "validated", "signed"] as const satisfies
  readonly Metrica[];

const dataHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function elegivel(a: Conta): boolean {
  return PRODUTOS.some((p) => oferta(a, p).status === "elegivel");
}

/** Unidades de uma conta: `unit_ids` da carga; sem ele, o mapa das unidades cadastradas. */
function unidadesDaConta(base: BaseMonetizacao) {
  const porChave = new Map<string, number[]>();
  for (const u of base.units)
    if (u.id !== null)
      for (const k of u.account_keys) porChave.set(k, [...(porChave.get(k) ?? []), u.id]);
  return (a: ContaDaCarga): number[] =>
    [...new Set(Array.isArray(a.unit_ids) ? a.unit_ids : (porChave.get(a.key) ?? []))].sort(
      (x, y) => x - y,
    );
}

export interface OpcoesCarga {
  /** Relógio (ms) para decidir carga parada; padrão, agora. */
  agora?: number;
  /**
   * A pessoa lê os negócios (view.aquario ou view.monetizacao, pela RLS de
   * `ops.monetizacao_deals`). Sem isso a lista vem vazia, e vazio não é "nenhum negócio".
   * Padrão: `permissions.view` (view.monetizacao) ou a carga ter trazido algum negócio.
   */
  acessoNegocios?: boolean;
}

export function dadosDaCarga(
  base: BaseMonetizacao,
  hoje: string,
  opcoes: OpcoesCarga = {},
): DadosMonetizacao {
  const agora = opcoes.agora ?? Date.now();
  const acessoNegocios = opcoes.acessoNegocios ?? (base.permissions.view || base.cards.length > 0);
  const unidadesDe = unidadesDaConta(base);
  const contas = base.accounts as ContaDaCarga[];

  // ── Negócios ─────────────────────────────────────────────────────────
  let negocios: DadosMonetizacao["negocios"];
  const orgsComNegocio = new Set<number>();
  if (!acessoNegocios)
    negocios = {
      ok: false,
      estado: "acesso_insuficiente",
      motivo:
        "Seu acesso não lê os negócios da Monetização (view.aquario ou view.monetizacao). Sem permissão não é o mesmo que nenhum negócio.",
    };
  else if (!base.measured_at)
    negocios = {
      ok: false,
      estado: "fonte_indisponivel",
      motivo: "O CRM ainda não teve uma carga de indicadores concluída.",
    };
  else {
    for (const c of base.cards) if (c.org_id !== null) orgsComNegocio.add(c.org_id);
    const unidadesDaOrg = new Map<number, Set<number>>();
    for (const a of contas)
      for (const o of a.orgs ?? []) {
        if (!orgsComNegocio.has(o)) continue;
        const s = unidadesDaOrg.get(o) ?? new Set<number>();
        for (const u of unidadesDe(a)) s.add(u);
        unidadesDaOrg.set(o, s);
      }
    const desde = inicioDaLeitura(hoje);
    const datas = (c: Negocio, k: (typeof EVENTOS)[number]) =>
      (c.events?.[k] ?? []).map((e) => e.date).filter((d): d is string => !!d);
    const lista: NegocioRegua[] = [];
    for (const c of base.cards) {
      const n: NegocioRegua = {
        id: c.id,
        unidade_ids:
          c.org_id === null ? [] : [...(unidadesDaOrg.get(c.org_id) ?? [])].sort((x, y) => x - y),
        started: datas(c, "started"),
        scheduled: datas(c, "scheduled"),
        meeting: datas(c, "meeting"),
        validated: datas(c, "validated"),
        signed: datas(c, "signed"),
      };
      // Negócio sem nenhum evento desde o começo do que o tema lê não muda nenhum número.
      if (EVENTOS.some((k) => n[k].some((d) => d >= desde))) lista.push(n);
    }
    const crm = cargaDoCrm(base.measured_at, base.sync_error, agora);
    negocios = {
      ok: true,
      lista,
      atualizadoEm: base.measured_at,
      parada:
        crm.parada || base.sync_error
          ? `Indicadores do CRM parados desde ${dataHora(base.measured_at)}${base.sync_error ? `: ${crm.porque}` : "."} O número vale até essa data.`
          : null,
    };
  }

  // ── Base ─────────────────────────────────────────────────────────────
  let baseParte: DadosMonetizacao["base"];
  if (!base.catalog_at)
    baseParte = {
      ok: false,
      estado: "fonte_indisponivel",
      motivo: "O catálogo da Base de clientes ainda não teve uma carga concluída.",
    };
  else {
    const grupos = new Map<string, GrupoBase>();
    for (const a of contas) {
      if (!elegivel(a)) continue;
      const ids = unidadesDe(a);
      const chave = ids.join(",");
      const g = grupos.get(chave) ?? {
        unidade_ids: ids,
        elegiveis: 0,
        comContato: 0,
        trabalhadas: negocios.ok ? 0 : null,
      };
      g.elegiveis++;
      if (a.contact === true) g.comContato++;
      if (g.trabalhadas !== null && (a.orgs ?? []).some((o) => orgsComNegocio.has(o)))
        g.trabalhadas++;
      grupos.set(chave, g);
    }
    const parada = agora - Date.parse(base.catalog_at) > LIMITE_CARGA_PARADA_MS;
    baseParte = {
      ok: true,
      grupos: [...grupos.values()],
      atualizadoEm: base.catalog_at,
      parada: parada
        ? `Catálogo da Base parado desde ${dataHora(base.catalog_at)}. O número vale até essa data.`
        : null,
    };
  }

  return { base: baseParte, negocios };
}

/**
 * Estado da consulta do `useMonetizacao()` quando não há dados: a tela chama `dadosSemCarga`
 * com o que sai daqui. A mensagem de acesso vem de `lerMonetizacao` ("Seu acesso não inclui...").
 */
export function falhaDaCarga(erro: unknown): {
  estado: "fonte_indisponivel" | "acesso_insuficiente";
  motivo: string;
} {
  const texto = erro instanceof Error ? erro.message : typeof erro === "string" ? erro : "";
  if (/seu acesso não inclui|sem permissão|sem acesso/i.test(texto))
    return { estado: "acesso_insuficiente", motivo: texto };
  if (/unauthorized|jwt|token/i.test(texto))
    return {
      estado: "fonte_indisponivel",
      motivo: "A sessão não foi reconhecida pelo servidor. Entre novamente para carregar os números.",
    };
  return {
    estado: "fonte_indisponivel",
    motivo: texto || "A carga de Base e Monetização falhou por um motivo não identificado.",
  };
}
