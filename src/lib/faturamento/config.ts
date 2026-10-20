// A Configuração do faturamento (`/faturamento/configuracao`, contrato
// `docs/design/contratos/faturamento-configuracao.md`): filtros na URL, a busca por empresa ou pessoa, a
// ordem da tabela, o selo do Omie de cada empresa e os textos de efeito de cada papel.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-fila.test.mjs (junto com a Fila).
import type { EmissoraConfig, FaturaPor, PapelEmissora, PessoaConfig } from "./tipos.ts";
import type { TomSituacao } from "./rotulos.ts";

export type SecaoConfig = "pessoas" | "servicos" | "omie";

export type BuscaConfig = {
  busca?: string;
  inativas?: "sim";
  /** Apelido da empresa aberta no `Sheet`. */
  empresa?: string;
  secao?: SecaoConfig;
};

const APELIDO = /^[A-Z0-9][A-Z0-9 _-]{0,23}$/;

export function lerBuscaConfig(raw: Record<string, unknown>): BuscaConfig {
  const out: BuscaConfig = {};
  // Número vindo de link compartilhado ("?busca=8120") chega como número: vale também.
  const busca =
    typeof raw.busca === "string"
      ? raw.busca.trim().slice(0, 80)
      : typeof raw.busca === "number"
        ? String(raw.busca)
        : "";
  if (busca) out.busca = busca;
  if (raw.inativas === "sim" || raw.inativas === true) out.inativas = "sim";
  const empresa = typeof raw.empresa === "string" ? raw.empresa.trim().toUpperCase() : "";
  if (empresa && APELIDO.test(empresa)) out.empresa = empresa;
  if (raw.secao === "servicos" || raw.secao === "omie") out.secao = raw.secao;
  return out;
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * A tabela das empresas: busca por empresa ou por pessoa ("Hugo" mostra as empresas em que o Hugo tem
 * papel), inativas só com o filtro, e as que já têm pedido no portal primeiro, depois por apelido.
 */
export function filtrarEmpresas(emissoras: EmissoraConfig[], busca: BuscaConfig): EmissoraConfig[] {
  const termo = busca.busca ? semAcento(busca.busca) : "";
  return emissoras
    .filter((e) => busca.inativas === "sim" || e.ativa)
    .filter((e) => {
      if (!termo) return true;
      const daEmpresa = [e.apelido, e.razao_social, e.cnpj].some((t) =>
        semAcento(t ?? "").includes(termo),
      );
      const daPessoa = e.pessoas.some(
        (p) =>
          p.ativo &&
          (semAcento(p.pessoa.nome).includes(termo) || semAcento(p.email ?? "").includes(termo)),
      );
      return daEmpresa || daPessoa;
    })
    .sort(
      (a, b) =>
        Number(b.ativa) - Number(a.ativa) ||
        Number(b.tem_pedido) - Number(a.tem_pedido) ||
        a.apelido.localeCompare(b.apelido, "pt-BR"),
    );
}

export interface SeloOmie {
  rotulo: string;
  tom: TomSituacao;
  /** A mensagem legível da indisponibilidade, para o `title`. */
  detalhe: string | null;
}

/** Omie da empresa: Sem chave (neutro), Indisponível (perigo), Gravando (sucesso) ou Simulação (info). */
export function seloOmie(e: Pick<EmissoraConfig, "tem_chave" | "omie" | "modo_omie">): SeloOmie {
  if (!e.tem_chave) return { rotulo: "Sem chave", tom: "neutro", detalhe: null };
  if (e.omie?.indisponivel)
    return { rotulo: "Indisponível", tom: "perigo", detalhe: e.omie.motivo };
  if (e.modo_omie === "gravar") return { rotulo: "Gravando", tom: "sucesso", detalhe: null };
  return { rotulo: "Simulação", tom: "info", detalhe: null };
}

export const ROTULO_FATURA_POR: Record<FaturaPor, string> = {
  os: "OS",
  contrato: "Contrato",
  ambos: "Ambos",
};

export const ROTULO_PAPEL: Record<PapelEmissora, { singular: string; plural: string }> = {
  dono: { singular: "dono", plural: "Donos" },
  gestor: { singular: "gestor", plural: "Gestores" },
  solicitante: { singular: "solicitante", plural: "Solicitantes" },
};

/** O efeito de cada papel, abaixo da escolha no diálogo "Adicionar pessoa" (contrato, Seção 1). */
export const AJUDA_PAPEL: Record<PapelEmissora, string> = {
  dono: "Responde pelo que é faturado. Dá o OK nos pedidos em que é o dono.",
  gestor: "Vê todos os pedidos da empresa e substitui o dono ausente.",
  solicitante: "Cadastra pedidos; eles vão para o OK do dono antes do Omie.",
};

/** As pessoas ativas da empresa, por papel, na ordem dono, gestor, solicitante. */
export function pessoasPorPapel(
  e: Pick<EmissoraConfig, "pessoas">,
): Record<PapelEmissora, PessoaConfig[]> {
  const out: Record<PapelEmissora, PessoaConfig[]> = { dono: [], gestor: [], solicitante: [] };
  for (const p of e.pessoas) if (p.ativo && out[p.papel]) out[p.papel].push(p);
  for (const k of Object.keys(out) as PapelEmissora[])
    out[k].sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));
  return out;
}

/** O substituto padrão de um dono novo: o gestor da empresa (RF-A03), quando há um. */
export function substitutoPadrao(
  e: Pick<EmissoraConfig, "pessoas">,
  donoId?: string | null,
): string | null {
  const gestor = e.pessoas.find((p) => p.ativo && p.papel === "gestor" && p.pessoa.id !== donoId);
  return gestor ? gestor.pessoa.id : null;
}

/** "2 · Hugo, Paula" para a célula da tabela; "—" sem ninguém. */
export function resumoDoPapel(pessoas: PessoaConfig[]): string {
  if (!pessoas.length) return "—";
  const nomes = pessoas.map((p) => p.pessoa.nome.split(/\s+/)[0]).slice(0, 3);
  return `${pessoas.length} · ${nomes.join(", ")}${pessoas.length > 3 ? "…" : ""}`;
}

/**
 * A frase do diálogo de desativar (contrato, Ações): "{Nome} deixa de ser {papel} na {empresa}. {n} pedidos
 * esperam o OK dele; o gestor da empresa continua podendo dar o OK."
 */
export function fraseDesativar(p: PessoaConfig, apelido: string): string {
  const base = `${p.pessoa.nome} deixa de ser ${ROTULO_PAPEL[p.papel].singular} na ${apelido}.`;
  if (p.papel !== "dono") return base;
  const n = p.aguardando_ok ?? 0;
  if (n === 0) return `${base} Nenhum pedido espera o OK dele.`;
  return `${base} ${n} ${n === 1 ? "pedido espera" : "pedidos esperam"} o OK dele; o gestor da empresa continua podendo dar o OK.`;
}
