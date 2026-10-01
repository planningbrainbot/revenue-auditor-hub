// Regras do cadastro de unidade (/unidades), sem banco e sem rede: o servidor
// valida com elas, a tela mostra as mesmas pendências, e os testes rodam sem
// Supabase. Nada aqui importa por alias `@/` para o `node --test` enxergar.

export type TipoUnidade = "regional" | "interna";

/** O que a tela manda salvar. `id` ausente é unidade nova. */
export type UnidadeEntrada = {
  id?: number;
  nome_da_praca: string;
  tipo: TipoUnidade;
  razao_social: string | null;
  cnpj: string | null;
  data_inauguracao: string | null;
  royalties_percentual: number | null;
  csc_valor_fixo: number | null;
  csc_percentual_base_antiga: number | null;
  midia_mensal: number | null;
  midia_cac: boolean;
  paga_cac: boolean;
  cac_desde: string | null;
  absorve_midia: boolean;
  id_omie: string | null;
  id_asaas: string | null;
  pipefy_id: string | null;
  pipedrive_opcao_id: number | null;
  observacoes_financeiras: string | null;
};

/** A linha gravada em ops.unidades, já limpa. */
export type UnidadeLinha = Omit<UnidadeEntrada, "id">;

/** Registro da base "[PTRS-DB-02] Unidades" do Pipefy (table 307173431), lido para preencher o formulário. */
export type RegistroPipefyUnidade = {
  pipefy_id: string;
  titulo: string;
  unidade_de_negocio: string | null;
  sigla: string | null;
  razao_social: string | null;
  cnpj: string | null;
  id_omie: string | null;
  id_asaas: string | null;
  data_inauguracao: string | null;
  csc_valor_fixo: number | null;
  royalties_percentual: number | null;
  observacoes_financeiras: string | null;
  emails: string[];
};

const vazioVira = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

const soDigitos = (s: string) => s.replace(/\D+/g, "");

export function formatarCnpj(digitos: string): string {
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * CNPJ da unidade, um por linha. Curitiba tem quatro entidades e Goiânia duas
 * (matriz e filial), gravadas assim desde 18/09; a tela já exibe com quebra.
 */
export function normalizarCnpjs(texto: string | null): string | null {
  const linhas = (texto ?? "")
    .split(/[\n;,]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length === 0) return null;
  const saida: string[] = [];
  for (const l of linhas) {
    const d = soDigitos(l);
    if (d.length !== 14) throw new Error(`CNPJ inválido: "${l}". Precisa ter 14 dígitos.`);
    const f = formatarCnpj(d);
    if (!saida.includes(f)) saida.push(f);
  }
  return saida.join("\n");
}

/** "20.000,00", "R$ 5.000", "8", "8,5" → número. Vazio é null, nunca 0. */
export function lerNumeroBr(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.replace(/R\$|\s|%/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

/** "25/09/2026" ou "2026-09-25" → "2026-09-25". Data que não existe vira erro, não outra data. */
export function lerData(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  let iso: string | null = null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (br) iso = `${br[3]}-${br[2]}-${br[1]}`;
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) iso = t.slice(0, 10);
  if (!iso) throw new Error(`Data inválida: "${t}".`);
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Data inválida: "${t}".`);
  }
  return iso;
}

function faixa(nome: string, v: number | null, min: number, max: number): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${nome} precisa estar entre ${min} e ${max}.`);
  }
  return v;
}

/** Valida e limpa o que veio da tela. Lança Error com a frase que vai para o toast. */
export function validarUnidade(e: UnidadeEntrada): UnidadeLinha {
  const nome = (e.nome_da_praca ?? "").trim().replace(/\s+/g, " ");
  if (!nome) throw new Error("Informe o nome da unidade.");
  if (/^\d+$/.test(nome)) throw new Error("O nome da unidade não pode ser só número.");
  if (e.tipo !== "regional" && e.tipo !== "interna")
    throw new Error("Tipo precisa ser regional ou interna.");

  const opcao = e.pipedrive_opcao_id;
  if (opcao != null && (!Number.isInteger(opcao) || opcao <= 0)) {
    throw new Error("A opção do Pipedrive é o número inteiro do item no campo Unidade de Negócio.");
  }
  const idOmie = vazioVira(e.id_omie);
  if (idOmie && !/^\d+$/.test(idOmie)) throw new Error("O código do cliente no Omie é só número.");
  const pipefy = vazioVira(e.pipefy_id);
  if (pipefy && !/^\d+$/.test(pipefy)) throw new Error("O registro do Pipefy é só número.");

  const pagaCac = !!e.paga_cac;
  return {
    nome_da_praca: nome,
    tipo: e.tipo,
    razao_social: vazioVira(e.razao_social),
    cnpj: normalizarCnpjs(e.cnpj),
    data_inauguracao: lerData(e.data_inauguracao),
    royalties_percentual: faixa("Royalties", e.royalties_percentual, 0, 100),
    csc_valor_fixo: faixa("CSC fixo", e.csc_valor_fixo, 0, 10_000_000),
    csc_percentual_base_antiga: faixa(
      "CSC sobre a base antiga",
      e.csc_percentual_base_antiga,
      0,
      100,
    ),
    midia_mensal: faixa("Mídia mensal", e.midia_mensal, 0, 10_000_000),
    midia_cac: !!e.midia_cac,
    paga_cac: pagaCac,
    // Sem CAC a data de início não significa nada, e o funil de CAC lê esta coluna (DECISIONS 18/09).
    cac_desde: pagaCac ? lerData(e.cac_desde) : null,
    absorve_midia: !!e.absorve_midia,
    id_omie: idOmie,
    id_asaas: vazioVira(e.id_asaas),
    pipefy_id: pipefy,
    pipedrive_opcao_id: opcao ?? null,
    observacoes_financeiras: vazioVira(e.observacoes_financeiras),
  };
}

/** Os ids dos campos da base do Pipefy (o `name` em record_fields é o rótulo, que muda). */
const CAMPO = {
  sigla: "sigla",
  unidade: "nome_da_pra_a",
  razao: "raz_o_social",
  cnpj: "cnpj",
  omie: "id_do_omie",
  asaas: "id_do_asaas",
  inauguracao: "data_de_inaugura_o",
  csc: "csc_valor_fixo_r",
  royalties: "royalties",
  obs: "observa_es_financeiras",
  email1: "email_do_financeiro",
  email2: "email_financeiro_2",
} as const;

type NoPipefy = {
  id: string;
  title: string | null;
  record_fields: { field: { id: string } | null; value: string | null }[];
};

/** Um registro do Pipefy no formato do formulário. Campo ilegível fica vazio em vez de derrubar a lista. */
export function lerRegistroPipefy(no: NoPipefy): RegistroPipefyUnidade {
  const f: Record<string, string> = {};
  for (const r of no.record_fields ?? []) if (r.field?.id && r.value) f[r.field.id] = r.value;
  const seguro = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  return {
    pipefy_id: String(no.id),
    titulo: (no.title ?? "").trim(),
    unidade_de_negocio: vazioVira(f[CAMPO.unidade]),
    sigla: vazioVira(f[CAMPO.sigla]),
    razao_social: vazioVira(f[CAMPO.razao]),
    cnpj: seguro(() => normalizarCnpjs(f[CAMPO.cnpj] ?? null)),
    id_omie: vazioVira(f[CAMPO.omie]),
    id_asaas: vazioVira(f[CAMPO.asaas]),
    data_inauguracao: seguro(() => lerData(f[CAMPO.inauguracao])),
    csc_valor_fixo: lerNumeroBr(f[CAMPO.csc]),
    royalties_percentual: lerNumeroBr(f[CAMPO.royalties]),
    observacoes_financeiras: vazioVira(f[CAMPO.obs]),
    emails: [f[CAMPO.email1], f[CAMPO.email2]]
      .map((x) => (x ?? "").trim().toLowerCase())
      .filter((x) => x.includes("@")),
  };
}

/** O que a unidade precisa ter, e o que ainda não tem. Lido de ops.unidades e de ops.csc_unidades. */
export type Pendencia = { chave: string; texto: string };

export function pendenciasDaUnidade(
  u: {
    tipo: string | null;
    cnpj: string | null;
    razao_social: string | null;
    data_inauguracao: string | null;
    royalties_percentual: number | null;
    pipedrive_opcao_id: number | null;
    pipefy_id: string | null;
    id_omie: string | null;
  },
  /** null quando quem olha não pode ler ops.csc_unidades: a pendência não é afirmada. */
  noFaturamentoDoCsc: boolean | null,
): Pendencia[] {
  const p: Pendencia[] = [];
  if (u.pipedrive_opcao_id == null) {
    p.push({
      chave: "pipedrive",
      texto: "Sem a opção do Pipedrive: contrato vendido para ela grava o número no lugar do nome.",
    });
  }
  if (!u.pipefy_id) {
    p.push({
      chave: "pipefy",
      texto:
        "Sem vínculo com a base de Unidades do Pipefy: cliente cadastrado lá não cai nesta unidade.",
    });
  }
  if ((u.tipo ?? "") !== "regional") return p;
  if (!u.cnpj) p.push({ chave: "cnpj", texto: "Sem CNPJ." });
  if (!u.razao_social) p.push({ chave: "razao_social", texto: "Sem razão social." });
  if (!u.data_inauguracao)
    p.push({
      chave: "inauguracao",
      texto: "Sem data de inauguração: aparece como Ativa e fora do tempo de casa.",
    });
  if (u.royalties_percentual == null) {
    p.push({
      chave: "royalties",
      texto: "Sem percentual de royalties: a apuração não gera royalties, só CAC e CSC.",
    });
  }
  if (!u.id_omie)
    p.push({
      chave: "omie",
      texto: "Sem cliente no Omie da Partners: não dá para faturar CSC nem royalties.",
    });
  if (noFaturamentoDoCsc === false) {
    p.push({ chave: "csc", texto: "Fora do faturamento do CSC: não aparece em Emitir faturas." });
  }
  return p;
}

/** Sigla do faturamento do CSC: 2 a 5 letras, maiúsculas, sem acento. */
export function normalizarSigla(s: string | null | undefined): string {
  const t = (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  if (t.length < 2 || t.length > 5)
    throw new Error("A sigla do CSC precisa ter de 2 a 5 letras (ex.: SOR, REC).");
  return t;
}

export function normalizarEmails(lista: string[]): string[] {
  const saida: string[] = [];
  for (const bruto of lista) {
    for (const e of bruto.split(/[\s,;]+/)) {
      const t = e.trim().toLowerCase();
      if (!t) continue;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) throw new Error(`E-mail inválido: "${e}".`);
      if (!saida.includes(t)) saida.push(t);
    }
  }
  return saida;
}
