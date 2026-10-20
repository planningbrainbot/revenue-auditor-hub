// Rótulos do Portal de Faturamento: a palavra e o tom de cada situação (um rótulo, um tom, em todas as
// telas: contrato `docs/design/contratos/faturamento.md` §1.2), o próximo passo e quem age (§3, coluna
// "Próximo passo"), o universo medido de cada papel (§2, `descricao`) e as frases de procedência.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-rotulos.test.mjs.
import type {
  Contexto,
  EstadoOmie,
  FiltroPedidos,
  Pendencia,
  ProximoPasso,
  Situacao,
  SituacaoFiltro,
  TipoRecorte,
} from "./tipos.ts";
import { diaMes, diaSP, diaEHora, horaSP, listaNomes, primeiroNome } from "./formato.ts";

/** Os cinco tons do `StatusBadge` (DESIGN.md §4). */
export type TomSituacao = "sucesso" | "atencao" | "perigo" | "info" | "neutro";

export const SITUACAO: Record<Situacao, { rotulo: string; tom: TomSituacao }> = {
  rascunho: { rotulo: "Rascunho", tom: "info" },
  aguardando_ok: { rotulo: "Aguardando OK", tom: "atencao" },
  devolvido: { rotulo: "Devolvido", tom: "atencao" },
  na_fila_omie: { rotulo: "Na fila do Omie", tom: "neutro" },
  // Simulado é informação, não alarme (§1.3): a simulação aparece no dado, nunca como selo de atenção.
  simulado: { rotulo: "Simulado", tom: "info" },
  erro_omie: { rotulo: "Erro no Omie", tom: "perigo" },
  os_criada: { rotulo: "OS criada", tom: "info" },
  em_conferencia: { rotulo: "Em conferência", tom: "info" },
  faturado: { rotulo: "Faturado", tom: "sucesso" },
  recebido: { rotulo: "Recebido", tom: "sucesso" },
  em_atraso: { rotulo: "Em atraso", tom: "perigo" },
  cancelamento_pedido: { rotulo: "Cancelamento pedido", tom: "atencao" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

/** Palavra da situação; valor que o contrato não conhece passa como veio (nunca some). */
export function rotuloSituacao(s: string): string {
  return (SITUACAO as Record<string, { rotulo: string }>)[s]?.rotulo ?? s;
}

export function tomSituacao(s: string): TomSituacao {
  return (SITUACAO as Record<string, { tom: TomSituacao }>)[s]?.tom ?? "neutro";
}

/** O grupo do card A faturar (API.md §1.2): enviados sem nota, sem os simulados. */
export const GRUPO_A_FATURAR: Situacao[] = [
  "aguardando_ok",
  "na_fila_omie",
  "erro_omie",
  "os_criada",
  "em_conferencia",
];

/** As etapas do gráfico "Em que etapa estão os pedidos em aberto?", na ordem do ciclo. */
export const ETAPAS_EM_ABERTO: Situacao[] = [
  "aguardando_ok",
  "devolvido",
  "na_fila_omie",
  "simulado",
  "erro_omie",
  "os_criada",
  "em_conferencia",
];

export function rotuloSituacaoFiltro(s: SituacaoFiltro): string {
  return s === "a_faturar" ? "A faturar" : rotuloSituacao(s);
}

export const PENDENCIA: Record<Pendencia, string> = {
  ok: "OK a dar",
  devolvido: "Devolvidos para corrigir",
  erro: "Erro no Omie",
};

// ------------------------------------------------------------------ próximo passo

export interface PassoLegivel {
  /** Quem age, curto: "Você", "Hugo", "Tesouraria", "Omie", "Cliente"; `null` quando ninguém. */
  quem: string | null;
  /** A frase da coluna: "OK de Hugo · desde 21/10". */
  texto: string;
  voce: boolean;
}

const NINGUEM: PassoLegivel = { quem: null, texto: "—", voce: false };

function quemAge(p: ProximoPasso): string | null {
  if (p.voce) return "Você";
  switch (p.quem) {
    case "pessoa":
      return primeiroNome(p.pessoa?.nome) || "Dono";
    case "tesouraria":
      return "Tesouraria";
    case "omie":
      return "Omie";
    case "cliente":
      return "Cliente";
    default:
      return null;
  }
}

/** "vence 24/10" ou "venceu 20/10", conforme a data já passou (em São Paulo). */
function vencimento(data: string | null, hoje: string): string | null {
  const d = diaMes(data);
  if (!d || !data) return null;
  return data < hoje ? `venceu ${d}` : `vence ${d}`;
}

function junta(...partes: (string | null | undefined | false)[]): string {
  return partes.filter(Boolean).join(" · ");
}

/**
 * A frase do próximo passo de um pedido (contrato §3): "OK de Hugo · desde 21/10", "Você corrige ·
 * devolvido em 21/10", "Tesouraria confere · vence 24/10", "Aguarda pagamento · vence 10/11", "Omie tenta
 * de novo às 14:20".
 *
 * @param hoje `AAAA-MM-DD` em São Paulo, para "vence" × "venceu" e para a hora da tentativa do Omie.
 */
export function proximoPasso(p: ProximoPasso | null | undefined, hoje: string): PassoLegivel {
  if (!p || !p.acao) return NINGUEM;
  const quem = quemAge(p);
  const voce = p.voce;
  const desde = diaMes(p.desde);
  const nome = quem ?? "";

  switch (p.acao) {
    case "terminar_rascunho":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você termina o rascunho" : `${nome || "O autor"} termina o rascunho`,
          desde && `desde ${desde}`,
        ),
      };
    case "dar_ok":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você dá o OK" : `OK de ${nome || "o dono"}`,
          desde && `desde ${desde}`,
        ),
      };
    case "corrigir":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você corrige" : `${nome || "O autor"} corrige`,
          desde && `devolvido em ${desde}`,
        ),
      };
    case "aguardar_omie": {
      if (!p.tentar_em) return { quem: "Omie", voce: false, texto: "Na fila do Omie" };
      const mesmoDia = diaSP(p.tentar_em) === hoje;
      const quando = mesmoDia ? `às ${horaSP(p.tentar_em)}` : `em ${diaEHora(p.tentar_em)}`;
      return { quem: "Omie", voce: false, texto: `Omie tenta de novo ${quando}` };
    }
    case "reenviar":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você reenvia" : `${nome || "Tesouraria"} reenvia`,
          desde && `erro desde ${desde}`,
        ),
      };
    case "conferir":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você confere" : `${nome || "Tesouraria"} confere`,
          vencimento(p.data, hoje),
        ),
      };
    case "faturar":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você fatura" : `${nome || "Tesouraria"} fatura`,
          vencimento(p.data, hoje),
        ),
      };
    case "aguardar_pagamento":
      return {
        quem: "Cliente",
        voce: false,
        texto: junta("Aguarda pagamento", vencimento(p.data, hoje)),
      };
    case "confirmar_cancelamento":
      return {
        quem,
        voce,
        texto: junta(
          voce ? "Você confirma o cancelamento" : `${nome || "Tesouraria"} confirma o cancelamento`,
          desde && `pedido em ${desde}`,
        ),
      };
    default:
      return NINGUEM;
  }
}

// ------------------------------------------------------------------ recorte e universo medido

/**
 * O recorte de quem abre a tela, a partir do contexto. Com mais de um papel, vale o mais largo (API.md
 * §1.2): tesouraria e controladoria veem tudo do recorte, o gestor vê a empresa, o resto vê o seu.
 */
export function tipoRecorteDoContexto(ctx: Pick<Contexto, "papeis" | "emissoras">): TipoRecorte {
  if (ctx.papeis.tesouraria) return "tesouraria";
  if (ctx.papeis.controladoria) return "controladoria";
  if (ctx.emissoras.some((e) => e.meus_papeis.includes("gestor"))) return "gestor";
  return "pessoal";
}

/** Nomes das empresas para a frase; acima de quatro, a contagem. */
function empresas(apelidos: string[]): string {
  return apelidos.length > 4 ? `${apelidos.length} empresas` : listaNomes(apelidos);
}

/**
 * O perímetro da `descricao` (N1), conforme o papel (contrato §2, "Universo"):
 * "Seus pedidos como dono ou solicitante · DOC e PIS" · "Todos os pedidos da DOC (você é gestor)" ·
 * "Todas as empresas do seu recorte (tesouraria) · DOC, PIS e PRJ".
 */
export function fraseRecorte(tipo: TipoRecorte, apelidos: string[]): string {
  const lista = empresas(apelidos);
  switch (tipo) {
    case "pessoal":
      return junta("Seus pedidos como dono ou solicitante", lista);
    case "gestor": {
      const de = apelidos.length === 1 ? `da ${apelidos[0]}` : lista ? `de ${lista}` : "da empresa";
      return `Todos os pedidos ${de} (você é gestor)`;
    }
    case "tesouraria":
      return junta("Todas as empresas do seu recorte (tesouraria)", lista);
    case "controladoria":
      return junta("Todas as empresas do seu recorte (controladoria)", lista);
  }
}

/** "DOC e PIS em simulação: nada é gravado no Omie"; `null` sem empresa em simulação (§1.3). */
export function fraseSimulacao(apelidos: string[]): string | null {
  if (!apelidos.length) return null;
  return `${empresas(apelidos)} em simulação: nada é gravado no Omie`;
}

const OITO_HORAS = 8 * 60 * 60 * 1000;

function maisRecente(datas: (string | null | undefined)[]): string | null {
  let melhor: string | null = null;
  let melhorMs = -Infinity;
  for (const d of datas) {
    if (!d) continue;
    const ms = Date.parse(d);
    if (Number.isFinite(ms) && ms > melhorMs) {
      melhor = d;
      melhorMs = ms;
    }
  }
  return melhor;
}

function diaUtilSP(agora: Date): boolean {
  const semana = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(agora);
  return semana !== "Sat" && semana !== "Sun";
}

/**
 * A leitura de situação do Omie das empresas do recorte, para a `procedencia` (§1.4 e estado "Omie não
 * lido" do §2): "situação do Omie lida às 14:00", "situação do Omie de 20/10 às 10:00, a leitura seguinte
 * falhou". Compara momentos por `Date.parse`, nunca por texto (API.md §0.4).
 */
export function fraseLeituraOmie(emissoras: { omie: EstadoOmie }[], agora: Date): string {
  const ok = maisRecente(emissoras.map((e) => e.omie?.ultimo_ok_em));
  const falha = maisRecente(emissoras.map((e) => e.omie?.ultima_falha_em));
  const hoje = diaSP(agora);
  const quando = (m: string) => (diaSP(m) === hoje ? `às ${horaSP(m)}` : `em ${diaEHora(m)}`);

  if (!ok && !falha) return "situação do Omie ainda não lida";
  if (falha && (!ok || Date.parse(falha) > Date.parse(ok))) {
    return ok
      ? `situação do Omie de ${diaEHora(ok)}, a leitura seguinte falhou`
      : `a leitura do Omie falhou ${quando(falha)}`;
  }
  const okMs = Date.parse(ok as string);
  if (diaUtilSP(agora) && agora.getTime() - okMs > OITO_HORAS) {
    return `situação do Omie de ${diaEHora(ok)}, sem leitura há mais de 8 h`;
  }
  return `situação do Omie lida ${quando(ok as string)}`;
}

// ------------------------------------------------------------------ o que pede atenção

export interface LinhaAtencao {
  chave: "erro_omie" | "ok_a_dar" | "devolvidos" | "para_faturar";
  titulo: string;
  quantidade: number;
  /** Vai inteiro para `fat_pedidos` (a soma de lá bate com a contagem). */
  filtro: FiltroPedidos;
  /** Rótulo do botão de destino. */
  acao: string;
}

/**
 * As linhas da caixa "O que pede atenção" de Meu faturamento (contrato §2, item 3), na ordem: erro no
 * Omie, OK a dar, devolvidos. Para quem só é tesouraria: erro no Omie e para faturar. Quem pede e também é
 * tesouraria vê as três primeiras. Só aparecem pendências com pedido.
 */
export function linhasDeAtencao(ctx: Pick<Contexto, "papeis" | "pendencias">): LinhaAtencao[] {
  const p = ctx.pendencias;
  const linhas: LinhaAtencao[] = [
    {
      chave: "erro_omie",
      titulo: "Erro no Omie",
      quantidade: p.erro_omie.quantidade,
      filtro: p.erro_omie.filtro,
      acao: "Ver os erros",
    },
  ];
  if (ctx.papeis.pede) {
    linhas.push(
      {
        chave: "ok_a_dar",
        titulo: "OK a dar",
        quantidade: p.ok_a_dar.quantidade,
        filtro: p.ok_a_dar.filtro,
        acao: "Dar o OK",
      },
      {
        chave: "devolvidos",
        titulo: "Devolvidos para corrigir",
        quantidade: p.devolvidos.quantidade,
        filtro: p.devolvidos.filtro,
        acao: "Corrigir",
      },
    );
  } else if (ctx.papeis.tesouraria && p.para_faturar) {
    linhas.push({
      chave: "para_faturar",
      titulo: "Para faturar",
      quantidade: p.para_faturar.quantidade,
      filtro: p.para_faturar.filtro,
      acao: "Ver os pedidos",
    });
  }
  return linhas.filter((l) => l.quantidade > 0);
}

// ------------------------------------------------------------------ procedência e papel

/**
 * Procedência de toda página da área (contrato §1.4): "Portal de Faturamento · situação do Omie lida às
 * {hora} (a cada 4 h em dia útil)", mais as empresas em simulação (§1.3: a simulação aparece no dado e
 * aqui, nunca como alarme fixo).
 */
export function procedenciaFaturamento(
  ctx: Pick<Contexto, "emissoras" | "simulacao" | "lido_em"> | undefined,
  agora: Date = new Date(),
): { fonte: string; atualizadoEm?: string } {
  if (!ctx) return { fonte: "Portal de Faturamento" };
  const partes = [
    `Portal de Faturamento · ${fraseLeituraOmie(ctx.emissoras, agora)} (a cada 4 h em dia útil)`,
    fraseSimulacao(ctx.simulacao),
  ].filter(Boolean);
  return { fonte: partes.join(" · "), atualizadoEm: ctx.lido_em };
}

/** Pode pedir em alguma empresa (dono, gestor ou solicitante)? É o que habilita "Novo pedido". */
export function podePedir(ctx: Pick<Contexto, "emissoras"> | undefined): boolean {
  return !!ctx?.emissoras.some((e) => e.pode_pedir);
}
