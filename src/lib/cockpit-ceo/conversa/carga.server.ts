// Carga do Cockpit do CEO no servidor, para as ferramentas da conversa.
//
// É a MESMA carga que a tela monta no navegador (rota /cockpit-ceo): as mesmas funções de leitura
// (`ler*Cockpit`, `lerMonetizacao`), com a sessão da pessoa, a RLS e as portas de cada fonte. Nada
// aqui abre dado que a pessoa não leria na tela. A área `cockpit_ceo` é conferida antes de qualquer
// leitura, e cada leitura confere de novo a própria porta.
//
// Cache: por pessoa (id do usuário na chave), dez minutos, como o da tela. Nunca é compartilhado
// entre pessoas; `limparCache(userId)` existe para o teste e para o "atualizar" da tela.
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { lerContasBase, lerMonetizacao } from "@/lib/monetizacao/functions";
import { loadCatalogPages } from "@/lib/monetizacao/catalog-loader";
import { juntarCarteira } from "@/lib/monetizacao/juntar-carteira";
import {
  cargaDaEmpresa,
  clientesDaCarga,
  receitaDaCarga,
  retencaoDaCarga,
  mensagemDeErro,
} from "../adaptador-brain";
import type { FonteCockpit } from "../indicadores";
import type { ContextoCockpit } from "../contexto";
import { criarCachePorPessoa } from "./cache";
import { lerReceitaCockpit } from "../receita.functions";
import { lerCaixaCockpit } from "../caixa.functions";
import { lerAquisicaoCockpit } from "../aquisicao.functions";
import { lerOperacaoCockpit } from "../operacao.functions";
import { lerRetencaoCockpit } from "../retencao.functions";
import { lerClientesAtivosCockpit } from "../clientes-ativos.functions";

export const VALIDADE_CACHE_MS = 10 * 60_000;
export const CACHE_COM_ERRO_MS = 30_000;

/** Alguma leitura da carga respondeu com erro (não "sem acesso", que é estado estável). */
export function temParteComErro(f: FonteCockpit): boolean {
  return [
    f.monetizacao,
    f.receita,
    f.clientesAtivos,
    f.retencao,
    f.caixa,
    f.aquisicao,
    f.operacao,
  ].some((p) => p?.estado === "erro");
}

export class SemAreaCockpit extends Error {
  constructor() {
    super("Sua conta não tem a área Cockpit do CEO.");
  }
}

export interface AcessoConversa {
  userId: string;
  acessoBase: boolean;
  acessoNegocios: boolean;
}

/** Confere a área e as chaves no servidor. Quem não tem a área não chega a nenhuma leitura. */
export async function conferirAcesso(ctx: ContextoCockpit): Promise<AcessoConversa> {
  const acesso = await acessoDoUsuario(ctx.supabase, ctx.userId);
  if (!acesso.areas.includes("cockpit_ceo")) throw new SemAreaCockpit();
  const tem = (k: string) => acesso.permissions.includes(k);
  return {
    userId: ctx.userId,
    acessoBase: tem("view.aquario") || tem("view.clientes"),
    acessoNegocios: tem("view.aquario") || tem("view.monetizacao"),
  };
}

type Resultado<T> = { data?: T; error?: unknown; isLoading: false };
const ler = async <T>(fn: () => Promise<T>): Promise<Resultado<T>> => {
  try {
    return { data: await fn(), isLoading: false };
  } catch (error) {
    return { error, isLoading: false };
  }
};

async function lerMonetizacaoCompleta(ctx: ContextoCockpit) {
  const data = await lerMonetizacao(ctx);
  if (!data.catalog_pages || data.base_count === undefined)
    throw new Error("Não foi possível conferir os lotes da carteira.");
  const accounts = await loadCatalogPages(
    data.catalog_pages,
    (page) => lerContasBase(ctx, { after: page.after, through: page.through }),
    {
      catalog_at: data.catalog_at,
      scope_signature: data.scope_signature,
      base_count: data.base_count,
    },
  );
  return juntarCarteira(data, accounts);
}

/** Monta a FonteCockpit como a rota faz, com cada leitura falhando sozinha. */
export async function montarFonteServidor(
  ctx: ContextoCockpit,
  acesso: AcessoConversa,
  agora = new Date().toISOString(),
): Promise<FonteCockpit> {
  const hoje = hojeSaoPaulo();
  const comCarteira = acesso.acessoBase || acesso.acessoNegocios;
  const [mon, receita, clientes, retencao, caixa, aquisicao, operacao] = await Promise.all([
    // A carteira vem em ~26 lotes; em paralelo com as outras fontes um lote pode passar do teto do
    // PostgREST (medido em 25/09). Uma nova tentativa, depois das outras leituras, resolve.
    comCarteira
      ? ler(() => lerMonetizacaoCompleta(ctx)).then((r) =>
          r.error ? ler(() => lerMonetizacaoCompleta(ctx)) : r,
        )
      : Promise.resolve(null),
    ler(() => lerReceitaCockpit(ctx)),
    ler(() => lerClientesAtivosCockpit(ctx)),
    ler(() => lerRetencaoCockpit(ctx)),
    ler(() => lerCaixaCockpit(ctx)),
    ler(() => lerAquisicaoCockpit(ctx)),
    ler(() => lerOperacaoCockpit(ctx)),
  ]);
  const monetizacao: FonteCockpit["monetizacao"] = !mon
    ? { estado: "sem_acesso", erro: null, dados: null }
    : mon.error || !mon.data
      ? { estado: "erro", erro: mensagemDeErro(mon.error), dados: null }
      : { estado: "ok", erro: null, dados: mon.data };
  return {
    sintetico: false,
    hoje,
    agora,
    acessoBase: acesso.acessoBase,
    acessoNegocios: acesso.acessoNegocios,
    monetizacao,
    receita: receitaDaCarga(receita),
    clientesAtivos: clientesDaCarga(clientes),
    retencao: retencaoDaCarga(retencao),
    caixa: cargaDaEmpresa(caixa, "A carga de caixa e margem falhou."),
    aquisicao: cargaDaEmpresa(aquisicao, "A carga do Growth falhou."),
    operacao: cargaDaEmpresa(operacao, "A carga da operação falhou."),
  };
}

const cache = criarCachePorPessoa<FonteCockpit>({
  validadeMs: VALIDADE_CACHE_MS,
  validadeComErroMs: CACHE_COM_ERRO_MS,
  temErro: temParteComErro,
});

/** Fonte da pessoa, do cache dela quando ainda vale. A chave é o id do usuário, nunca outra coisa. */
export function fonteDaPessoa(
  ctx: ContextoCockpit,
  acesso: AcessoConversa,
  opcoes: { agora?: number; montar?: typeof montarFonteServidor } = {},
): Promise<FonteCockpit> {
  if (acesso.userId !== ctx.userId) throw new Error("Acesso e sessão de pessoas diferentes.");
  const agora = opcoes.agora ?? Date.now();
  return cache.obter(ctx.userId, agora, () =>
    (opcoes.montar ?? montarFonteServidor)(ctx, acesso, new Date(agora).toISOString()),
  );
}

export function limparCache(userId?: string) {
  cache.limpar(userId);
}
