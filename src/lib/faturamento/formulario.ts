// O formulário do pedido (`/faturamento/novo`, contrato `docs/design/contratos/faturamento-novo.md`).
//
// A tela confere na hora o que dá (obrigatórios, dígito verificador, e-mail, valor, parcelas, a marca da
// empresa), para a pessoa não descobrir o erro só no fim; quem decide é o banco (`fat_pedido_enviar`, API.md
// §1.11), que confere tudo de novo. As chaves dos erros são as mesmas do `p_dados` (§1.10), para a mensagem
// do banco e a da tela caírem no mesmo campo.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-formulario.test.mjs.
import type {
  DadosPedido,
  DocumentoFiscal,
  ErroCampo,
  FichaPedido,
  FormaPagamento,
  MeioPagamento,
  TipoTomador,
} from "./tipos.ts";
import { dinheiro, primeiroNome, rotuloMes } from "./formato.ts";

/** O estado do formulário: o que a pessoa digita, como texto, antes de virar `p_dados`. */
export interface FormPedido {
  emissora_id: string | null;
  dono_id: string | null;
  tomador_tipo: TipoTomador;
  /** Como foi digitado (com ou sem máscara). */
  tomador_documento: string;
  tomador_nome: string;
  emails_envio: string[];
  projeto: string;
  servico_id: string | null;
  descricao_nf: string;
  /** "1.500,00" ou "1500.00". */
  valor: string;
  documento: DocumentoFiscal | null;
  forma: FormaPagamento | null;
  /** Só vale em parcelado (2 a 36). */
  parcelas: string;
  meio: MeioPagamento | null;
  /** `AAAA-MM-DD`. */
  primeiro_vencimento: string;
  /** `AAAA-MM`; vazio enquanto acompanha o 1º vencimento. */
  competencia: string;
  /** A pessoa mudou a competência à mão: ela para de acompanhar o vencimento. */
  competencia_manual: boolean;
  departamento: string | null;
  observacoes: string;
  confirmou_emissora: boolean;
}

export function formularioVazio(
  inicio: { emissora_id?: string | null; dono_id?: string | null } = {},
): FormPedido {
  return {
    emissora_id: inicio.emissora_id ?? null,
    dono_id: inicio.dono_id ?? null,
    tomador_tipo: "pj",
    tomador_documento: "",
    tomador_nome: "",
    emails_envio: [],
    projeto: "",
    servico_id: null,
    descricao_nf: "",
    valor: "",
    documento: null,
    forma: null,
    parcelas: "",
    meio: null,
    primeiro_vencimento: "",
    competencia: "",
    competencia_manual: false,
    departamento: null,
    observacoes: "",
    confirmou_emissora: false,
  };
}

/** O formulário de um rascunho ou devolvido salvo (`fat_pedido`). */
export function formularioDoPedido(ficha: FichaPedido): FormPedido {
  const p = ficha.pedido;
  const comp = p.competencia ? p.competencia.slice(0, 7) : "";
  const doVenc = p.primeiro_vencimento ? p.primeiro_vencimento.slice(0, 7) : "";
  return {
    emissora_id: p.emissora.id,
    dono_id: p.dono?.id ?? null,
    tomador_tipo: p.tomador.tipo ?? "pj",
    tomador_documento: p.tomador.documento ?? "",
    tomador_nome: p.tomador.nome ?? "",
    emails_envio: p.emails_envio ?? [],
    projeto: p.projeto ?? "",
    servico_id: p.servico?.id ?? null,
    descricao_nf: p.descricao_nf ?? "",
    valor: p.valor === null || p.valor === undefined ? "" : valorParaDigitar(p.valor),
    documento: p.documento,
    forma: p.forma,
    parcelas: p.forma === "parcelado" && p.parcelas ? String(p.parcelas) : "",
    meio: p.meio,
    primeiro_vencimento: p.primeiro_vencimento ?? "",
    competencia: comp,
    competencia_manual: !!comp && comp !== doVenc,
    departamento: p.departamento,
    observacoes: p.observacoes ?? "",
    confirmou_emissora: p.confirmou_emissora,
  };
}

// ------------------------------------------------------------------ campos

export function soDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/**
 * O documento sem máscara: maiúsculo, só letras e números. Desde a T1b (20/10/2026) o CNPJ pode ser
 * alfanumérico (letras nas 12 primeiras posições, os dois dígitos verificadores sempre números, regra da
 * Receita de 2026); o CPF continua só com números.
 */
export function normalizarDocumento(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Valor do caractere no cálculo do dígito: o código ASCII menos 48 (0–9 valem 0–9; A vale 17). */
const valorDoCaractere = (c: string) => c.charCodeAt(0) - 48;

function digitoCpf(base: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

function digitoCnpj(base: string): number {
  const pesos =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = base.split("").reduce((s, c, i) => s + valorDoCaractere(c) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const CPF = /^\d{11}$/;
/** 12 posições alfanuméricas e 2 dígitos verificadores numéricos. */
const CNPJ = /^[0-9A-Z]{12}\d{2}$/;

/** O tipo pelo formato do documento sem máscara: CPF (11 números) ou CNPJ (14, alfanumérico ou não). */
export function tipoDoDocumento(v: string | null | undefined): "pf" | "pj" | null {
  const d = normalizarDocumento(v);
  if (CPF.test(d)) return "pf";
  if (CNPJ.test(d)) return "pj";
  return null;
}

/** CPF ou CNPJ (numérico ou alfanumérico) com dígito verificador certo. Sequência repetida não vale. */
export function documentoValido(v: string | null | undefined): boolean {
  const d = normalizarDocumento(v);
  const tipo = tipoDoDocumento(d);
  if (!tipo) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  if (tipo === "pf") {
    return (
      digitoCpf(d.slice(0, 9), 10) === Number(d[9]) &&
      digitoCpf(d.slice(0, 10), 11) === Number(d[10])
    );
  }
  return (
    digitoCnpj(d.slice(0, 12)) === Number(d[12]) && digitoCnpj(d.slice(0, 13)) === Number(d[13])
  );
}

/** O erro do documento, na mesma frase do banco; `null` quando está certo. */
export function erroDoDocumento(tipo: TipoTomador, v: string): string | null {
  const d = normalizarDocumento(v);
  const nome = tipo === "pj" ? "CNPJ" : "CPF";
  if (!d) return `Informe o ${nome}.`;
  if (tipo === "pf" && !CPF.test(d)) return "O CPF tem 11 números.";
  if (tipo === "pj" && !CNPJ.test(d))
    return d.length === 14
      ? "Os dois últimos caracteres do CNPJ são números."
      : "O CNPJ tem 14 caracteres.";
  if (!documentoValido(d)) return `${nome} com dígito verificador errado.`;
  return null;
}

/**
 * Máscara enquanto digita: CNPJ "12.ABC.345/01DE-35" (até 14 caracteres) e CPF "123.456.789-09" (até 11
 * números). Letra só entra no CNPJ.
 */
export function mascararDocumento(tipo: TipoTomador, v: string): string {
  const d = tipo === "pf" ? soDigitos(v).slice(0, 11) : normalizarDocumento(v).slice(0, 14);
  if (tipo === "pf") {
    return (
      [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(".") +
      (d.length > 9 ? `-${d.slice(9)}` : "")
    );
  }
  let out = d.slice(0, 2);
  if (d.length > 2) out += `.${d.slice(2, 5)}`;
  if (d.length > 5) out += `.${d.slice(5, 8)}`;
  if (d.length > 8) out += `/${d.slice(8, 12)}`;
  if (d.length > 12) out += `-${d.slice(12)}`;
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailValido(v: string): boolean {
  return EMAIL.test(v.trim());
}

/** Junta e-mails: minúsculos, sem repetição (como o banco normaliza). */
export function juntarEmails(atuais: string[], novos: string[]): string[] {
  const out: string[] = [];
  for (const e of [...atuais, ...novos]) {
    const n = e.trim().toLowerCase();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** "Alteração  contratual " → "Alteração contratual" (é a chave de projeto da Ana). */
export function normalizarProjeto(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

/**
 * Valor digitado → número com 2 casas. Aceita "1.500,00", "1500,5", "1500.50" e "1500". Com vírgula, o
 * ponto é milhar; sem vírgula, o ponto é decimal. `null` para vazio ou inválido.
 */
export function lerValor(v: string): number | null {
  const t = v
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 1500 → "1.500,00" (o que o campo mostra ao sair). */
export function valorParaDigitar(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** O número de parcelas que vale: avulso é 1; parcelado é o digitado. */
export function parcelasDoFormulario(f: Pick<FormPedido, "forma" | "parcelas">): number | null {
  if (f.forma === "avulso") return 1;
  if (f.forma !== "parcelado") return null;
  // Vazio, 0, 37 ou -1 vão como `null`: o rascunho se salva assim mesmo (RF-P01), e a pendência aparece no
  // campo. `Number("")` dá 0, e o 0 derrubava o salvar com o erro do validador (revisão de 20/10/2026).
  if (!/^\d+$/.test(f.parcelas.trim())) return null;
  const n = Number(f.parcelas);
  return n >= 1 && n <= 36 ? n : null;
}

/**
 * A resposta da busca do cliente ainda vale? Só se é do documento e da empresa que o formulário tem agora: a
 * consulta à Receita leva segundos, e uma resposta velha não pode trocar o bloqueio nem o aviso de contrato
 * do cliente novo (revisão de 20/10/2026, "resposta antiga da busca do cliente sobrescreve a nova").
 */
export function buscaAindaVale(
  pedida: { documento: string; emissora: string },
  form: Pick<FormPedido, "tomador_documento" | "emissora_id">,
): boolean {
  return (
    pedida.documento === normalizarDocumento(form.tomador_documento) &&
    pedida.emissora === form.emissora_id
  );
}

/** Data `AAAA-MM-DD` de verdade, com ano entre 2000 e 2100 (o campo de data aceita "0026-10-21"). */
export function dataValida(v: string | null | undefined): boolean {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  if (a < 2000 || a > 2100 || m < 1 || m > 12) return false;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return d >= 1 && d <= ultimo;
}

/**
 * A prévia das parcelas pode ser pedida? A mesma regra do banco (`fat_parcelas_previa`): valor maior que
 * zero, de 1 a 36 parcelas e 1º vencimento válido. A tela e o hook usam esta, para a tela não dizer "pronta"
 * enquanto o hook está desligado (revisão de 20/10/2026).
 */
export function previaPronta(
  valor: number | null,
  parcelas: number | null,
  primeiroVencimento: string | null,
): boolean {
  return (
    valor !== null &&
    valor > 0 &&
    parcelas !== null &&
    parcelas >= 1 &&
    parcelas <= 36 &&
    dataValida(primeiroVencimento)
  );
}

/** O aviso do 1º vencimento no passado: não bloqueia o envio (decisão pendente da Ana, API.md §1.11). */
export function avisoDoVencimento(primeiroVencimento: string, hoje: string): string | null {
  return dataValida(primeiroVencimento) && primeiroVencimento < hoje
    ? "O 1º vencimento já passou."
    : null;
}

const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/**
 * As competências que o campo oferece: de 12 meses antes a 24 depois do mês corrente, mais a que o pedido
 * já tiver fora dessa faixa. Um seletor próprio, porque o `<input type="month">` não abre no Firefox.
 */
export function opcoesDeCompetencia(
  mesCorrente: string,
  atual?: string | null,
): { valor: string; rotulo: string }[] {
  const [a, m] = mesCorrente.split("-").map(Number);
  const out: { valor: string; rotulo: string }[] = [];
  for (let i = -12; i <= 24; i++) {
    const total = a * 12 + (m - 1) + i;
    const ano = Math.floor(total / 12);
    const mes = (total % 12) + 1;
    out.push({
      valor: `${ano}-${String(mes).padStart(2, "0")}`,
      rotulo: `${MESES_CURTOS[mes - 1]}/${ano}`,
    });
  }
  if (atual && /^\d{4}-\d{2}$/.test(atual) && !out.some((o) => o.valor === atual)) {
    const [aa, mm] = atual.split("-").map(Number);
    out.push({ valor: atual, rotulo: `${MESES_CURTOS[mm - 1]}/${aa}` });
    out.sort((x, y) => x.valor.localeCompare(y.valor));
  }
  return out;
}

/** A competência que vale: a digitada, ou o mês do 1º vencimento enquanto ela o acompanha. */
export function competenciaDoFormulario(
  f: Pick<FormPedido, "competencia" | "competencia_manual" | "primeiro_vencimento">,
): string | null {
  if (f.competencia_manual && /^\d{4}-\d{2}$/.test(f.competencia)) return f.competencia;
  if (dataValida(f.primeiro_vencimento)) return f.primeiro_vencimento.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(f.competencia) ? f.competencia : null;
}

/** "{serviço} · {projeto} · {competência}", o padrão da descrição da nota (contrato, Seção 2). */
export function descricaoPadrao(
  servico: string,
  projeto: string,
  competencia: string | null,
): string {
  return [servico.trim(), normalizarProjeto(projeto), competencia ? rotuloMes(competencia) : null]
    .filter(Boolean)
    .join(" · ");
}

const vazio = (s: string) => (s.trim() === "" ? null : s);

/** O formulário → `p_dados` de `fat_pedido_salvar` (todas as chaves: o que está vazio vai como `null`). */
export function dadosParaSalvar(f: FormPedido): DadosPedido {
  const comp = competenciaDoFormulario(f);
  return {
    emissora_id: f.emissora_id,
    dono_id: f.dono_id,
    tomador_tipo: f.tomador_tipo,
    tomador_documento: normalizarDocumento(f.tomador_documento) || null,
    tomador_nome: vazio(f.tomador_nome.trim()),
    emails_envio: juntarEmails([], f.emails_envio),
    projeto: vazio(normalizarProjeto(f.projeto)),
    servico_id: f.servico_id,
    descricao_nf: vazio(f.descricao_nf.trim()),
    valor: lerValor(f.valor),
    forma: f.forma,
    parcelas: parcelasDoFormulario(f),
    // Data fora do formato (ou com ano errado) não vai: o rascunho se salva e a pendência fica no campo.
    primeiro_vencimento: dataValida(f.primeiro_vencimento) ? f.primeiro_vencimento : null,
    competencia: comp ? `${comp}-01` : null,
    documento: f.documento,
    meio: f.meio,
    departamento: f.departamento,
    observacoes: vazio(f.observacoes.trim()),
    confirmou_emissora: f.confirmou_emissora,
  };
}

// ------------------------------------------------------------------ conferência na hora

export interface ContextoConferencia {
  /** O cliente tem contrato vigente em outra empresa do grupo (RF-P03). */
  contratoEmOutra: boolean;
  /** A situação do cliente na Receita barra o envio (RF-P02). */
  bloqueio: string | null;
}

/**
 * O que a tela já sabe que barra o envio, na ordem dos campos (contrato, "Enviar valida tudo no servidor; a
 * tela também confere na hora o que dá"). Lista vazia não garante o envio: o banco confere de novo.
 */
export function pendenciasLocais(f: FormPedido, ctx: ContextoConferencia): ErroCampo[] {
  const erros: ErroCampo[] = [];
  const falta = (campo: string, mensagem: string) => erros.push({ campo, mensagem });

  if (!f.emissora_id) falta("emissora_id", "Escolha a empresa que fatura.");
  if (ctx.contratoEmOutra && !f.confirmou_emissora)
    falta("confirmou_emissora", "Confirme a empresa que fatura.");
  if (!f.dono_id) falta("dono_id", "Escolha o dono da receita.");
  const doc = erroDoDocumento(f.tomador_tipo, f.tomador_documento);
  if (doc) falta("tomador_documento", doc);
  else if (ctx.bloqueio) falta("tomador_documento", ctx.bloqueio);
  if (!f.tomador_nome.trim()) falta("tomador_nome", "Informe o nome do cliente.");
  if (!f.emails_envio.length) falta("emails_envio", "Informe ao menos um e-mail para envio.");
  const ruins = f.emails_envio.filter((e) => !emailValido(e));
  if (ruins.length) falta("emails_envio", `E-mail inválido: ${ruins.join(", ")}.`);

  if (!normalizarProjeto(f.projeto)) falta("projeto", "Informe o nome do projeto.");
  if (!f.servico_id) falta("servico_id", "Escolha o serviço.");
  if (!f.descricao_nf.trim()) falta("descricao_nf", "Escreva a descrição da nota.");

  const valor = lerValor(f.valor);
  if (valor === null)
    falta("valor", f.valor.trim() ? "Valor inválido: use 1.500,00." : "Informe o valor.");
  else if (valor <= 0) falta("valor", "O valor precisa ser maior que zero.");
  if (!f.documento) falta("documento", "Escolha nota fiscal, recibo ou nota de débito.");
  if (!f.forma) falta("forma", "Escolha à vista ou parcelado.");
  if (f.forma === "parcelado") {
    const n = Number(f.parcelas);
    if (!Number.isInteger(n) || n < 2 || n > 36)
      falta("parcelas", "Parcelado vai de 2 a 36 parcelas.");
  }
  if (!f.meio) falta("meio", "Escolha boleto ou pix.");
  if (!f.primeiro_vencimento) falta("primeiro_vencimento", "Informe o 1º vencimento.");
  else if (!dataValida(f.primeiro_vencimento))
    falta("primeiro_vencimento", "Data inválida: confira o dia, o mês e o ano.");
  if (!f.observacoes.trim()) falta("observacoes", "Escreva as observações.");
  return erros;
}

/** Os erros de um campo, para mostrar abaixo dele. */
export function errosDoCampo(erros: ErroCampo[], campo: string): string[] {
  return erros.filter((e) => e.campo === campo).map((e) => e.mensagem);
}

// ------------------------------------------------------------------ o que acontece ao enviar

export interface CenarioEnvio {
  /** Quem cadastra é o dono escolhido. */
  souDono: boolean;
  nomeDono: string | null;
  apelido: string | null;
  simulacao: boolean;
}

/** O rótulo do botão principal: "Enviar" ou "Enviar para o OK de Hugo" (RF-P05, decisão 3A). */
export function rotuloEnviar(c: Pick<CenarioEnvio, "souDono" | "nomeDono">): string {
  if (c.souDono || !c.nomeDono) return "Enviar";
  return `Enviar para o OK de ${primeiroNome(c.nomeDono)}`;
}

/** A frase do rodapé (uma frase, muda com o caso). */
export function fraseAoEnviar(c: CenarioEnvio): string {
  const empresa = c.apelido ?? "empresa escolhida";
  const base = c.souDono
    ? `O pedido vai para a fila do Omie da ${empresa} e depois para a tesouraria faturar.`
    : c.nomeDono
      ? `Você não é o dono da receita: o pedido vai para o OK de ${primeiroNome(c.nomeDono)} antes de ir ao Omie.`
      : "Escolha o dono da receita: quando não é você, o pedido vai para o OK dele antes de ir ao Omie.";
  return c.simulacao
    ? `${base} O Omie da ${empresa} está em simulação: o pedido percorre o fluxo, mas nada é gravado lá.`
    : base;
}

/** "R$ 5.333,33 + R$ 5.333,33 + R$ 5.333,34": a prévia lida em voz alta (leitor de tela e teste). */
export function resumoParcelas(parcelas: { valor: number }[]): string {
  return parcelas.map((p) => dinheiro(p.valor)).join(" + ");
}
