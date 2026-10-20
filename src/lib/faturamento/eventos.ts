// A linha do tempo da Ficha do pedido (contrato `docs/design/contratos/faturamento-pedido.md`, "O que
// aconteceu com este pedido?", RF-P10): cada evento de `receita.fat_eventos` em português, com quem fez
// ("Portal" quando foi automático) e a diferença de campos quando houve ("Valor: R$ 7.500,00 → R$ 5.000,00").
// O catálogo de eventos é o do API.md, seção Mudanças, item 7.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-ficha.test.mjs.
import type { EventoPedido, Json } from "./tipos.ts";
import { dataCompleta, dinheiro, primeiroNome, rotuloMes } from "./formato.ts";
import { rotuloSituacao } from "./rotulos.ts";

export interface EventoLegivel {
  id: number;
  /** "Hugo deu o OK", "Omie recusou: 'Chave suspensa'". */
  texto: string;
  /** Quem fez: o nome, ou "Portal" quando foi automático. */
  quem: string;
  em: string;
  /** "Valor: R$ 7.500,00 → R$ 5.000,00", um por campo. */
  mudancas: string[];
}

const ROTULO_CAMPO: Record<string, string> = {
  emissora_id: "Empresa",
  dono_id: "Dono da receita",
  tomador_tipo: "PF ou PJ",
  tomador_documento: "CNPJ ou CPF",
  tomador_nome: "Cliente",
  emails_envio: "E-mails para envio",
  projeto: "Projeto",
  servico_id: "Serviço",
  descricao_nf: "Descrição da nota",
  valor: "Valor",
  forma: "À vista ou parcelado",
  parcelas: "Parcelas",
  primeiro_vencimento: "1º vencimento",
  competencia: "Competência",
  documento: "Documento",
  meio: "Boleto ou pix",
  departamento: "Departamento",
  observacoes: "Observações",
  confirmou_emissora: "Empresa confirmada",
};

/** Campos guardados por id: a linha diz que mudou, sem mostrar o id. */
const SO_MUDOU = new Set(["emissora_id", "dono_id", "servico_id"]);

const PALAVRA: Record<string, string> = {
  pj: "PJ",
  pf: "PF",
  avulso: "à vista",
  parcelado: "parcelado",
  nf: "nota fiscal",
  recibo: "recibo",
  nd: "nota de débito",
  boleto: "boleto",
  pix: "pix",
};

function valorDoCampo(campo: string, v: Json | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (campo === "valor" && typeof v === "number") return dinheiro(v);
  if (campo === "primeiro_vencimento" && typeof v === "string") return dataCompleta(v) ?? v;
  if (campo === "competencia" && typeof v === "string") return rotuloMes(v) ?? v;
  if (campo === "confirmou_emissora") return v === true ? "sim" : "não";
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : "—";
  if (typeof v === "string") return PALAVRA[v] ?? v;
  return String(v);
}

/** As diferenças `{campo: {de, para}}` de um evento `alterado`, em português e na ordem do formulário. */
export function mudancasDoDiff(diff: EventoPedido["diff"]): string[] {
  if (!diff || typeof diff !== "object") return [];
  const out: string[] = [];
  for (const campo of Object.keys(ROTULO_CAMPO)) {
    const par = (diff as Record<string, Json>)[campo];
    if (!par || typeof par !== "object" || Array.isArray(par)) continue;
    const { de, para } = par as { de?: Json; para?: Json };
    const rotulo = ROTULO_CAMPO[campo];
    out.push(
      SO_MUDOU.has(campo)
        ? `${rotulo} trocado`
        : `${rotulo}: ${valorDoCampo(campo, de)} → ${valorDoCampo(campo, para)}`,
    );
  }
  return out;
}

function campo(diff: EventoPedido["diff"], chave: string): Json | undefined {
  return diff && typeof diff === "object" ? (diff as Record<string, Json>)[chave] : undefined;
}

function textoDe(diff: EventoPedido["diff"], chave: string): string | null {
  const v = campo(diff, chave);
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

/** O número da OS: `diff.omie_os_codigo` vem como `{de, para}` ou como número. */
function numeroDaOs(diff: EventoPedido["diff"]): string | null {
  const v = campo(diff, "omie_os_codigo");
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const para = (v as Record<string, Json>).para;
    return para === null || para === undefined ? null : String(para);
  }
  return v === null || v === undefined ? null : String(v);
}

/** Um evento em português (contrato: "Hugo deu o OK", "Tesouraria devolveu: '…'", "Omie criou a OS 3021"). */
export function eventoLegivel(e: EventoPedido): EventoLegivel {
  const quem = e.autor ? primeiroNome(e.autor.nome) || e.autor.nome : "Portal";
  const nome = e.autor ? quem : "O portal";
  const motivo = textoDe(e.diff, "motivo");
  const comMotivo = (frase: string) => (motivo ? `${frase}: '${motivo}'` : frase);
  const simulacao = textoDe(e.diff, "modo") === "simular";
  let texto: string;
  let mudancas: string[] = [];

  switch (e.evento) {
    case "criado":
      texto = `${nome} criou o rascunho`;
      break;
    case "alterado":
      texto = `${nome} alterou o pedido`;
      mudancas = mudancasDoDiff(e.diff);
      break;
    case "enviado":
      texto =
        e.para === "aguardando_ok" ? `${nome} enviou para o OK do dono` : `${nome} enviou ao Omie`;
      break;
    case "aprovado":
      texto = `${nome} deu o OK`;
      break;
    case "devolvido":
      texto = comMotivo(`${nome} devolveu`);
      break;
    case "reenviado":
      texto = `${nome} reenviou ao Omie`;
      break;
    case "descartado":
      texto = `${nome} descartou o pedido`;
      break;
    case "cancelamento_pedido":
      texto = comMotivo(`Cancelamento pedido por ${nome}`);
      break;
    case "cancelado":
      texto = comMotivo(`${nome} confirmou o cancelamento`);
      break;
    case "conferencia":
      texto = `${nome} começou a conferência`;
      break;
    case "faturar_pedido":
      texto = simulacao ? `${nome} faturou em simulação` : `${nome} pediu o faturamento ao Omie`;
      break;
    case "omie_cliente": {
      const existia = campo(e.diff, "cliente_existia");
      texto = simulacao
        ? existia === true
          ? "Simulação: o cliente já existe no Omie"
          : "Simulação: o cliente seria cadastrado no Omie"
        : existia === true
          ? "Omie: o cliente já existia"
          : "Omie: cliente cadastrado pelo portal";
      break;
    }
    case "omie_os_criada":
      texto = `Omie criou a OS${numeroDaOs(e.diff) ? ` ${numeroDaOs(e.diff)}` : ""}`;
      break;
    case "omie_os_alterada":
      texto = `Omie alterou a OS${numeroDaOs(e.diff) ? ` ${numeroDaOs(e.diff)}` : ""}`;
      break;
    case "omie_simulado":
      texto =
        campo(e.diff, "servico_existe") === false
          ? "Simulado: nada foi gravado no Omie (o serviço não existe lá)"
          : "Simulado: nada foi gravado no Omie";
      break;
    case "omie_erro":
      texto = comMotivo("Omie recusou");
      break;
    case "faturado": {
      const nf = textoDe(e.diff, "omie_nf_numero");
      texto = nf ? `Nota ${nf} emitida` : "Faturado no Omie";
      break;
    }
    case "faturado_simulado":
      texto = "Faturado em simulação: nenhuma nota emitida";
      break;
    case "faturado_no_omie": {
      const nf = textoDe(e.diff, "omie_nf_numero");
      texto = nf ? `Faturado direto no Omie: nota ${nf}` : "Faturado direto no Omie";
      break;
    }
    case "recebido":
      texto = "Todas as parcelas foram pagas";
      break;
    case "em_atraso":
      texto = "Parcela em atraso";
      break;
    case "parcela_paga": {
      const n = textoDe(e.diff, "parcela");
      const de = textoDe(e.diff, "de_parcelas");
      const valor = campo(e.diff, "valor");
      texto = `Parcela ${n ?? "?"}${de ? ` de ${de}` : ""} paga${typeof valor === "number" ? ` (${dinheiro(valor)})` : ""}`;
      break;
    }
    case "omie_resultado_ignorado":
      texto = "O Omie respondeu depois de o pedido mudar de situação; a situação ficou";
      break;
    default:
      texto =
        e.de && e.para && e.de !== e.para
          ? `${e.evento}: ${rotuloSituacao(e.de)} → ${rotuloSituacao(e.para)}`
          : e.evento;
  }
  return { id: e.id, texto, quem, em: e.em, mudancas };
}
