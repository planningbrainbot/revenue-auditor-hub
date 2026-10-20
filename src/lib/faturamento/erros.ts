// Erro do banco → mensagem legível (API.md §0.3).
//
// A RPC levanta exceção e o PostgREST devolve `{ code, message, details, hint }`:
//   42501  sem porta, sem papel, pedido fora do escopo, ação que o papel não faz → frase em português
//   P0002  id que não existe → "Pedido não encontrado."
//   22023  validação → "Pedido incompleto ou com erro." e `details` = {"erros":[{"campo","mensagem"}]}
//   55000  ação que a situação atual não permite → "Pedido FAT-… está em …: não dá para …"
//
// As server functions devolvem `Resultado<T>` em vez de lançar: assim o tipo do erro e a lista de campos
// chegam inteiros ao navegador (o erro lançado por server function atravessa a rede só com a mensagem). No
// navegador, `desembrulhar` volta a lançar, como `ErroFaturamento`, para o React Query.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-erros.test.mjs.
import type { ErroCampo } from "./tipos.ts";

export type TipoErro =
  /** 42501: a tela mostra `EstadoSemAcesso`, sem nenhum dado. */
  | "sem_acesso"
  /** P0002: a tela mostra "não encontrado". */
  | "nao_encontrado"
  /** 22023: a mensagem de cada campo vai abaixo dele. */
  | "validacao"
  /** 55000: a situação mudou; a tela relê o pedido. */
  | "transicao"
  /** A RPC ainda não existe no banco (a T1b não foi aplicada). */
  | "indisponivel"
  /** Sessão vencida ou sem login. */
  | "sessao"
  /** O resto: falha de rede, de banco ou do servidor. */
  | "falha";

export interface ErroFat {
  tipo: TipoErro;
  /** O `code` do Postgres ou do PostgREST, quando houve. */
  codigo: string | null;
  mensagem: string;
  /** Só em `validacao`. Campo `null` = erro geral. */
  campos: ErroCampo[];
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroFat };

export interface ErroBanco {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const PADRAO: Record<"sem_acesso" | "nao_encontrado" | "validacao" | "transicao", string> = {
  sem_acesso: "Seu acesso não inclui esta parte do Portal de Faturamento.",
  nao_encontrado: "Pedido não encontrado.",
  validacao: "Pedido incompleto ou com erro.",
  transicao: "A situação do pedido mudou e esta ação não vale mais. Atualize a página.",
};

/**
 * Mensagem do banco que serve para a tela: as RPCs do portal escrevem em português. As do próprio Postgres
 * ("permission denied for function …", "new row violates …") vêm em inglês e não servem: aí vale o padrão.
 */
function mensagemDoPortal(m: string | null | undefined): string | null {
  const t = (m ?? "").trim();
  if (!t) return null;
  if (
    /^(permission denied|new row violates|null value|duplicate key|invalid input|value too long|could not|function .* does not exist)/i.test(
      t,
    )
  )
    return null;
  return t;
}

/** `details` do 22023: `{"erros":[{"campo":"…","mensagem":"…"}]}`. Fora desse formato, lista vazia. */
export function camposDoDetalhe(details: string | null | undefined): ErroCampo[] {
  if (!details) return [];
  try {
    const obj = JSON.parse(details) as { erros?: unknown };
    if (!obj || !Array.isArray(obj.erros)) return [];
    return obj.erros
      .filter((e): e is { campo?: unknown; mensagem?: unknown } => !!e && typeof e === "object")
      .filter((e) => typeof e.mensagem === "string" && e.mensagem.trim() !== "")
      .map((e) => ({
        campo: typeof e.campo === "string" && e.campo ? e.campo : null,
        mensagem: (e.mensagem as string).trim(),
      }));
  } catch {
    return [];
  }
}

/**
 * Traduz o erro de uma chamada `rpc()` para a tela.
 *
 * @param rpc nome da RPC, para a mensagem de "ainda não existe" e para o log
 * @param oQue o que a pessoa tentou, para a mensagem genérica ("A leitura dos pedidos")
 */
export function traduzirErroBanco(
  e: ErroBanco | null | undefined,
  rpc: string,
  oQue: string,
): ErroFat {
  const codigo = e?.code ?? null;
  const doPortal = mensagemDoPortal(e?.message);

  switch (codigo) {
    case "42501":
      return { tipo: "sem_acesso", codigo, mensagem: doPortal ?? PADRAO.sem_acesso, campos: [] };
    case "P0002":
      return {
        tipo: "nao_encontrado",
        codigo,
        mensagem: doPortal ?? PADRAO.nao_encontrado,
        campos: [],
      };
    case "22023":
      return {
        tipo: "validacao",
        codigo,
        mensagem: doPortal ?? PADRAO.validacao,
        campos: camposDoDetalhe(e?.details),
      };
    case "55000":
      return { tipo: "transicao", codigo, mensagem: doPortal ?? PADRAO.transicao, campos: [] };
    // PostgREST: função não está no cache do schema (a migration da API ainda não foi aplicada).
    case "PGRST202":
    case "42883":
      return {
        tipo: "indisponivel",
        codigo,
        // O nome da função vai só para o log do servidor (`faturamento.functions.ts`), nunca para a tela.
        mensagem: "O Portal de Faturamento está fora do ar agora. Tente de novo em instantes.",
        campos: [],
      };
    // JWT vencido ou ausente.
    case "PGRST301":
    case "PGRST302":
    case "PGRST303":
      return {
        tipo: "sessao",
        codigo,
        mensagem: "Sua sessão expirou. Entre de novo para continuar.",
        campos: [],
      };
    default:
      return {
        tipo: "falha",
        codigo,
        // O código fica em `codigo` (e no log do servidor); a tela mostra só a frase.
        mensagem: `${oQue} falhou. Tente de novo em instantes.`,
        campos: [],
      };
  }
}

/** Erro lançado no navegador a partir de um `Resultado` com `ok: false`. */
export class ErroFaturamento extends Error {
  readonly tipo: TipoErro;
  readonly codigo: string | null;
  readonly campos: ErroCampo[];

  constructor(erro: ErroFat) {
    super(erro.mensagem);
    this.name = "ErroFaturamento";
    this.tipo = erro.tipo;
    this.codigo = erro.codigo;
    this.campos = erro.campos;
  }
}

/** Devolve os dados ou lança `ErroFaturamento` (para `queryFn` e `mutationFn`). */
export function desembrulhar<T>(r: Resultado<T>): T {
  if (r.ok) return r.dados;
  throw new ErroFaturamento(r.erro);
}

/** O tipo do erro de uma consulta, para escolher o estado da tela; `falha` para qualquer outro erro. */
export function tipoDoErro(e: unknown): TipoErro {
  return e instanceof ErroFaturamento ? e.tipo : "falha";
}

/** Vale tentar de novo? Só falha passageira; acesso, validação e transição não mudam sozinhos. */
export function valeTentarDeNovo(tentativas: number, e: unknown): boolean {
  return tipoDoErro(e) === "falha" && tentativas < 1;
}

// ------------------------------------------------------------------ validação da entrada (zod)

const ROTULO_ENTRADA: Record<string, string> = {
  emissora: "empresa",
  emissora_id: "empresa",
  dono_id: "dono da receita",
  tomador_documento: "CNPJ ou CPF",
  tomador_nome: "nome do cliente",
  emails_envio: "e-mails para envio",
  projeto: "projeto",
  servico: "serviço",
  servico_id: "serviço",
  descricao: "descrição",
  descricao_nf: "descrição da nota",
  valor: "valor",
  parcelas: "número de parcelas",
  primeiro_vencimento: "1º vencimento",
  competencia: "competência",
  departamento: "departamento",
  observacoes: "observações",
  documento: "documento",
  motivo: "motivo",
  id: "pedido",
};

/**
 * A frase de uma entrada recusada pelo validador da server function, no lugar do JSON cru do zod: "O campo
 * número de parcelas veio fora do formato aceito." `caminhos` são os `path` dos problemas.
 */
export function fraseDaValidacao(caminhos: (string | number)[][]): string {
  const nomes = [
    ...new Set(
      caminhos.map((p) => {
        const chave = [...p].reverse().find((x) => typeof x === "string") as string | undefined;
        return chave ? (ROTULO_ENTRADA[chave] ?? chave) : null;
      }),
    ),
  ].filter((x): x is string => !!x);
  if (!nomes.length)
    return "Os dados enviados vieram fora do formato aceito. Atualize a página e tente de novo.";
  return nomes.length === 1
    ? `O campo ${nomes[0]} veio fora do formato aceito. Confira e tente de novo.`
    : `Os campos ${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]} vieram fora do formato aceito. Confira e tente de novo.`;
}
