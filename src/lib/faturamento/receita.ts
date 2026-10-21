// Consulta da Receita pela CNPJá aberta (`https://open.cnpja.com/office/<cnpj>`, sem chave), para o bloqueio
// de CNPJ inapto (RF-P02, CA-05) não depender de dado vindo da tela. Quem consulta é o servidor, quando
// `ops.fat_tomador` responde `consultar_receita = true`; quem grava é `ops.fat_receita_cnpj_gravar`, executável
// só pelo service_role (API.md §2.9 e o aviso da T1b de 20/10/2026).
//
// A CNPJá aberta responde cerca de 4 consultas por minuto (medido em 14/10/2026) e devolve 429 acima disso:
// o limite daqui fica abaixo, e passar dele só adia a consulta (a tela segue com "situação não conferida").
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-formulario.test.mjs (junto com o Novo pedido).

export const URL_CNPJA = "https://open.cnpja.com/office/";
export const USER_AGENT_CNPJA = "planning-brain-faturamento/1.0 (+https://planningbrain.com.br)";

/** O `p_dados` de `fat_receita_cnpj_gravar` (API.md §2.9). */
export interface DadosReceita {
  fonte: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  /** ATIVA, BAIXADA, INAPTA, SUSPENSA ou NULA. */
  situacao: string | null;
  situacao_desde: string | null;
  /**
   * Endereço do tomador, que o conector manda ao Omie quando cadastra o cliente (API.md, Mudanças, entrada
   * do conector, item 1). Sem ele, o cliente novo entra no Omie só com município e UF.
   */
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  /** 8 dígitos, sem máscara (outro tamanho o banco recusa com 22023, então sai nulo). */
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  emails: string[];
  consultado_em: string;
}

const SITUACOES: Record<string, string> = {
  ativa: "ATIVA",
  baixada: "BAIXADA",
  inapta: "INAPTA",
  suspensa: "SUSPENSA",
  nula: "NULA",
};

/** Código numérico da Receita, quando o texto não vem: 1 nula, 2 ativa, 3 suspensa, 4 inapta, 8 baixada. */
const POR_CODIGO: Record<number, string> = {
  1: "NULA",
  2: "ATIVA",
  3: "SUSPENSA",
  4: "INAPTA",
  8: "BAIXADA",
};

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const DATA = /^\d{4}-\d{2}-\d{2}/;

/**
 * Resposta da CNPJá → `p_dados`. `null` quando a resposta não tem o mínimo (situação ou razão social): gravar
 * cache vazio faria o banco achar que consultou.
 */
export function dadosDaCnpja(json: unknown, agora: Date = new Date()): DadosReceita | null {
  if (!json || typeof json !== "object") return null;
  const d = json as {
    alias?: unknown;
    company?: { name?: unknown } | null;
    status?: { id?: unknown; text?: unknown } | null;
    statusDate?: unknown;
    address?: {
      street?: unknown;
      number?: unknown;
      details?: unknown;
      district?: unknown;
      zip?: unknown;
      city?: unknown;
      state?: unknown;
    } | null;
    emails?: { address?: unknown }[] | null;
  };
  const statusTexto = texto(d.status?.text);
  const situacao =
    (statusTexto && SITUACOES[semAcento(statusTexto)]) ||
    (typeof d.status?.id === "number" ? POR_CODIGO[d.status.id] : undefined) ||
    null;
  const razao = texto(d.company?.name);
  if (!situacao && !razao) return null;
  const desde = texto(d.statusDate);
  const emails = Array.isArray(d.emails)
    ? [
        ...new Set(
          d.emails.map((e) => texto(e?.address)?.toLowerCase()).filter((e): e is string => !!e),
        ),
      ]
    : [];
  const uf = texto(d.address?.state);
  const cep = (texto(d.address?.zip) ?? "").replace(/\D/g, "");
  return {
    fonte: "CNPJá aberta",
    razao_social: razao,
    nome_fantasia: texto(d.alias),
    situacao,
    situacao_desde: desde && DATA.test(desde) ? desde.slice(0, 10) : null,
    logradouro: texto(d.address?.street),
    numero: texto(d.address?.number),
    complemento: texto(d.address?.details),
    bairro: texto(d.address?.district),
    cep: cep.length === 8 ? cep : null,
    municipio: texto(d.address?.city),
    uf: uf ? uf.toUpperCase() : null,
    emails,
    consultado_em: agora.toISOString(),
  };
}

/**
 * Janela deslizante de chamadas: no máximo `maximo` em `janelaMs`. O relógio entra por parâmetro para o teste.
 * Vive na memória do processo do servidor: protege a CNPJá de rajada, não é cota distribuída.
 */
export class LimiteDeChamadas {
  readonly maximo: number;
  readonly janelaMs: number;
  private chamadas: number[] = [];

  constructor(maximo: number, janelaMs: number) {
    this.maximo = maximo;
    this.janelaMs = janelaMs;
  }

  /** Reserva uma chamada agora; `false` quando a janela está cheia. */
  tentar(agoraMs: number = Date.now()): boolean {
    this.chamadas = this.chamadas.filter((t) => agoraMs - t < this.janelaMs);
    if (this.chamadas.length >= this.maximo) return false;
    this.chamadas.push(agoraMs);
    return true;
  }
}
