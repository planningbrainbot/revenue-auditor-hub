import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decidirJev } from "../cockpit-ceo/jev/adaptador.server";
import type { FalhaJev, LedgerJev, ResultadoJev } from "../cockpit-ceo/jev/adaptador.server";
import { JEV_MODELO } from "../cockpit-ceo/jev/contrato";
import type { PedidoJev, RegistroChamada } from "../cockpit-ceo/jev/contrato";
import { obterChaveOpenRouter } from "../cockpit-ceo/conversa/servidor.server";
import { fraseDaValidacao, traduzirErroBanco, type Resultado } from "./erros";
import { mesCorrenteSP } from "./formato";
import {
  jevFaturamentoLigado,
  lerConferencia,
  lerSugestao,
  pedidoConferencia,
  pedidoSugestao,
  TEMPO_JEV_MS,
  type Conferencia,
  type Sugestao,
} from "./jev";
import type { CatalogoServicos } from "./tipos";

/**
 * O validador zod de cada server function, com a recusa traduzida: sem isto o navegador recebe o JSON cru do
 * zod (achado B3 da revisão de 20/10/2026). O tipo de entrada continua o do schema.
 */
function entrada<T extends z.ZodTypeAny>(schema: T) {
  return (d: z.input<T>): z.output<T> => {
    const r = schema.safeParse(d);
    if (!r.success) throw new Error(fraseDaValidacao(r.error.issues.map((i) => i.path)));
    return r.data;
  };
}

// O Jev no Novo pedido (T5): `sugerirServico` (choice no catálogo da empresa) e `conferirDescricao` (noul:
// a descrição da nota combina com o serviço?). Contrato `docs/design/contratos/faturamento-novo.md`, Seção 2.
//
// - Liga só com FATURAMENTO_JEV=1 e a chave OPENROUTER_API_KEY no servidor (no local, também
//   COCKPIT_IA_KEYCHAIN=1, que lê a chave do Keychain). Sem isso, as funções respondem "desligado".
// - Antes de chamar o Jev, `ops.fat_servicos` confere a porta do portal e o papel da pessoa na empresa (é a
//   mesma regra do campo Serviço) e devolve o catálogo: a sugestão só escolhe dentro dele.
// - Corte de 3 s. Passou disso, a tela segue sem sugestão e sem erro.
// - O consumo vai para ops.cockpit_ia_consumo com cockpit = 'faturamento', com a sessão da pessoa (migration
//   20261020210000), no mesmo desenho do Cockpit do COO.
// - Ao Jev vão só a empresa, o serviço, a descrição, o projeto e o valor (`jev.ts`, `limparTexto`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

/** Teto por pessoa e por mês (o ledger só lê as linhas da própria pessoa, pela RLS). */
const LIMITES = { tentativas: 3_000, custoUsd: 2 };
/**
 * Custo atribuído a uma chamada que terminou sem custo informado (o corte de 3 s aborta antes da resposta).
 * O adaptador trava o mês inteiro nesse caso; aqui ela entra no teto por um valor 20× o medido (US$ 0,00005
 * por chamada no E0, 111 chamadas), para um corte de tempo não desligar o Jev do portal até o mês virar.
 */
const CUSTO_SEM_INFORMACAO_USD = 0.001;

function ledgerFaturamento(db: DB): LedgerJev {
  let fila: Promise<unknown> = Promise.resolve();
  return {
    async ler() {
      const inicioMes = `${mesCorrenteSP()}-01T03:00:00Z`;
      const { data, error } = await db
        .from("cockpit_ia_consumo")
        .select("id, em, estado, reserva_id, custo_usd, custo_desconhecido, latencia_ms, codigo")
        .eq("tipo", "jev")
        .eq("cockpit", "faturamento")
        .gte("em", inicioMes);
      if (error) throw new Error("ledger do Jev indisponível");
      const registros: RegistroChamada[] = (data ?? []).map(
        (r: Record<string, unknown>): RegistroChamada => ({
          id: String(r.estado === "reservada" ? r.id : r.reserva_id),
          em: String(r.em),
          exemplo: "faturamento",
          taxonomia: "faturamento-servico-v1",
          estado: r.estado === "reservada" ? "reservada" : r.estado === "ok" ? "ok" : "falha",
          // Sem custo informado: entra no teto pelo custo atribuído, sem travar (ver acima).
          custoUsd: r.custo_desconhecido
            ? CUSTO_SEM_INFORMACAO_USD
            : r.custo_usd === null
              ? null
              : Number(r.custo_usd),
          custoDesconhecido: false,
          latenciaMs: (r.latencia_ms as number | null) ?? null,
          codigo: (r.codigo as string | null) ?? null,
        }),
      );
      // Reserva sem desfecho (processo que caiu, ou chamada de outra instância em curso): o mesmo custo atribuído.
      const comDesfecho = new Set(
        registros.filter((r) => r.estado !== "reservada").map((r) => r.id),
      );
      for (const r of registros.filter((x) => x.estado === "reservada" && !comDesfecho.has(x.id)))
        registros.push({
          ...r,
          estado: "falha",
          custoUsd: CUSTO_SEM_INFORMACAO_USD,
          custoDesconhecido: false,
        });
      return registros;
    },
    async anexar(r) {
      const linha =
        r.estado === "reservada"
          ? {
              id: r.id,
              tipo: "jev",
              modelo: JEV_MODELO,
              estado: "reservada",
              cockpit: "faturamento",
            }
          : {
              tipo: "jev",
              modelo: r.modelo ?? JEV_MODELO,
              estado: r.estado,
              reserva_id: r.id,
              custo_usd: r.custoUsd ?? null,
              custo_desconhecido: !!r.custoDesconhecido,
              tokens_entrada: r.tokens?.entrada ?? null,
              tokens_saida: r.tokens?.saida ?? null,
              latencia_ms: r.latenciaMs ?? null,
              codigo: r.codigo ?? null,
              cockpit: "faturamento",
            };
      const { error } = await db.from("cockpit_ia_consumo").insert(linha);
      if (error) throw new Error("não foi possível registrar o consumo do Jev");
    },
    comTrava(fn) {
      const agora = fila.then(fn, fn);
      fila = agora.catch(() => undefined);
      return agora;
    },
  };
}

export type EstadoJev = "ok" | "desligado" | "sem_chave" | "tempo_esgotado" | "bloqueado" | "falha";

async function chamarJev(
  supabase: unknown,
  pedido: PedidoJev,
  exemplo: string,
): Promise<ResultadoJev | FalhaJev | { estado: "desligado" | "sem_chave" }> {
  if (!jevFaturamentoLigado(process.env)) return { estado: "desligado" };
  const chave = await obterChaveOpenRouter();
  if (!chave) return { estado: "sem_chave" };
  return decidirJev(pedido, {
    obterChave: async () => chave,
    ledger: ledgerFaturamento((supabase as DB).schema("ops")),
    exemplo,
    timeoutMs: TEMPO_JEV_MS,
    limites: LIMITES,
  });
}

function estadoDa(r: { estado: string; codigo?: string }): EstadoJev {
  if (
    r.estado === "ok" ||
    r.estado === "desligado" ||
    r.estado === "sem_chave" ||
    r.estado === "bloqueado"
  )
    return r.estado;
  return r.codigo === "tempo_esgotado" ? "tempo_esgotado" : "falha";
}

/** O catálogo da empresa com a sessão da pessoa: confere a porta e o papel antes de qualquer chamada ao Jev. */
/**
 * Os nomes do cliente que não podem ir ao Jev, lidos pelo servidor (não dependem do que o navegador mandar):
 * o nome que `fat_tomador` devolve para o documento e a razão social da base. Somam-se ao nome digitado na
 * tela. Falha na leitura não impede a chamada: o nome digitado continua saindo do texto.
 */
async function nomesDoTomador(
  supabase: unknown,
  documento: string | null | undefined,
  emissora: string,
): Promise<string[]> {
  if (!documento || documento.replace(/[^0-9A-Za-z]/g, "").length < 11) return [];
  const { data, error } = await (supabase as DB)
    .schema("ops")
    .rpc("fat_tomador", { p_documento: documento, p_emissora: emissora });
  if (error || !data) return [];
  const t = data as { nome?: string | null; base?: { razao_social?: string | null } | null };
  return [t.nome, t.base?.razao_social].filter((x): x is string => !!x);
}

async function catalogo(supabase: unknown, emissora: string): Promise<Resultado<CatalogoServicos>> {
  const { data, error } = await (supabase as DB)
    .schema("ops")
    .rpc("fat_servicos", { p_emissora: emissora });
  if (error)
    return {
      ok: false,
      erro: traduzirErroBanco(error, "ops.fat_servicos", "A leitura do catálogo"),
    };
  return { ok: true, dados: data as CatalogoServicos };
}

/** O Jev está ligado no portal? A tela só mostra o botão e o aviso com ele ligado. */
export const estadoJevFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ ligado: boolean }> => ({
    ligado: jevFaturamentoLigado(process.env),
  }));

const entradaComum = {
  emissora: z.string().uuid(),
  descricao: z.string().max(4_000),
  valor: z.number().finite().nullable().optional(),
  /** Só para tirar o nome do texto antes de ir ao Jev; nunca é enviado. */
  nomeCliente: z.string().max(200).nullable().optional(),
  /** O CNPJ ou CPF do cliente: o servidor busca o nome dele para tirar do texto. Nunca vai ao Jev. */
  documento: z.string().max(30).nullable().optional(),
};

export interface RespostaSugestao {
  estado: EstadoJev;
  sugestao: Sugestao | null;
  opcoes: number;
  filtrado: boolean;
  latenciaMs: number | null;
  custoUsd: number | null;
}

/** Sugere o serviço do catálogo da empresa pela descrição e pelo projeto (choice + `nenhum`). */
export const sugerirServico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z.object({ ...entradaComum, projeto: z.string().max(300).nullable().optional() }).strict(),
    ),
  )
  .handler(async ({ context, data }): Promise<Resultado<RespostaSugestao>> => {
    const vazio = (estado: EstadoJev): Resultado<RespostaSugestao> => ({
      ok: true,
      dados: {
        estado,
        sugestao: null,
        opcoes: 0,
        filtrado: false,
        latenciaMs: null,
        custoUsd: null,
      },
    });
    if (!jevFaturamentoLigado(process.env)) return vazio("desligado");
    const cat = await catalogo(context.supabase, data.emissora);
    if (!cat.ok) return cat;
    const servicos = cat.dados.servicos ?? [];
    if (!servicos.length) return vazio("ok");
    const montado = pedidoSugestao({
      emissora: cat.dados.emissora.apelido,
      projeto: data.projeto ?? "",
      descricao: data.descricao,
      valor: data.valor ?? null,
      servicos,
      nomesParaTirar: [
        data.nomeCliente,
        ...(await nomesDoTomador(context.supabase, data.documento, data.emissora)),
      ],
    });
    const r = await chamarJev(context.supabase, montado.pedido, "faturamento-sugestao");
    const base = { opcoes: montado.opcoes, filtrado: montado.filtrado };
    if (r.estado !== "ok" || !("respostas" in r))
      return {
        ok: true,
        dados: { ...base, estado: estadoDa(r), sugestao: null, latenciaMs: null, custoUsd: null },
      };
    return {
      ok: true,
      dados: {
        ...base,
        estado: "ok",
        sugestao: lerSugestao(r.respostas.servico, montado.mapa, servicos),
        latenciaMs: r.latenciaMs,
        custoUsd: r.custoUsd,
      },
    };
  });

export interface RespostaConferencia {
  estado: EstadoJev;
  conferencia: Conferencia | null;
  latenciaMs: number | null;
  custoUsd: number | null;
}

/** A descrição da nota combina com o serviço escolhido? (noul). Só aviso: a tela não bloqueia. */
export const conferirDescricao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ ...entradaComum, servico: z.string().uuid() }).strict()))
  .handler(async ({ context, data }): Promise<Resultado<RespostaConferencia>> => {
    const nada = (estado: EstadoJev): Resultado<RespostaConferencia> => ({
      ok: true,
      dados: { estado, conferencia: null, latenciaMs: null, custoUsd: null },
    });
    if (!jevFaturamentoLigado(process.env)) return nada("desligado");
    if (!data.descricao.trim()) return nada("ok");
    const cat = await catalogo(context.supabase, data.emissora);
    if (!cat.ok) return cat;
    const servico = (cat.dados.servicos ?? []).find((s) => s.id === data.servico);
    // Serviço fora do catálogo liberado da empresa: não há o que conferir.
    if (!servico) return nada("ok");
    const pedido = pedidoConferencia({
      emissora: cat.dados.emissora.apelido,
      servico,
      descricao: data.descricao,
      valor: data.valor ?? null,
      nomesParaTirar: [
        data.nomeCliente,
        ...(await nomesDoTomador(context.supabase, data.documento, data.emissora)),
      ],
    });
    const r = await chamarJev(context.supabase, pedido, "faturamento-conferencia");
    if (r.estado !== "ok" || !("respostas" in r))
      return {
        ok: true,
        dados: { estado: estadoDa(r), conferencia: null, latenciaMs: null, custoUsd: null },
      };
    return {
      ok: true,
      dados: {
        estado: "ok",
        conferencia: lerConferencia(r.respostas.combina),
        latenciaMs: r.latenciaMs,
        custoUsd: r.custoUsd,
      },
    };
  });
