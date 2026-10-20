/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Omie e do banco chega sem tipo. */
// Conector do Omie do Portal de Faturamento (T2 da E1, 20/10/2026). Lógica pura, sem API do Deno: testada no Node em
// tests/faturamento-omie.test.mjs. O servidor (index.ts) só liga isto ao PostgREST e ao fetch.
//
// Fonte: PM Work/execution/portal-faturamento-prd-20261013/e1/API.md §0.6, §0.7 e §2 (as RPCs integracoes.fat_*),
// spec §5.2 e §8, E0 §3. Campos do Omie conferidos na documentação oficial (servicos/os, servicos/osp, geral/clientes,
// servicos/servico, financas/pesquisartitulos) e em leituras reais da DOC em 20/10 (mensagens de "não cadastrado",
// busca de cliente por CNPJ, StatusOS e títulos por nCodOS).
//
// As travas, na ordem em que valem:
// 1. **Simulação.** O modo é o do envio (`omie_envios.modo`, carimbado com o `modo_omie` da emissora quando o pedido
//    entrou na fila). Qualquer valor que não seja exatamente "gravar" é simulação. Em simulação o cliente do Omie só
//    deixa passar os métodos da lista LEITURAS: Incluir, Alterar, Faturar e Upsert são recusados antes do fetch. O
//    envio volta `simulado` com o param que IRIA ao Omie e o que as leituras acharam.
// 2. **Idempotência.** Antes de incluir, consulta pelo código de integração (cCodIntOS = número do pedido; cliente =
//    documento). "Já existe" é sucesso. Escrita nunca é repetida dentro da mesma tentativa: a próxima tentativa começa
//    pela consulta.
// 3. **Uma chamada por vez por chave**, com pausa mínima entre chamadas. As chaves são as mesmas da carga do Brain
//    Financeiro e do financeiro.
// 4. **Erros do Omie** (cliente do Financeiro, pipeline/lib/omie_api.py, e a nota omie-425-misuse-nao-repetir):
//    425 com MISUSE_API_PROCESS para a emissora na hora e reagenda para depois do bloqueio (repetir estende o
//    castigo); REDUNDANT espera e repete (só leitura); SOAP-ENV:Client-* nunca repete; 403 marca a emissora como
//    indisponível, sem derrubar as outras.
// 5. **Chave** só em memória: nunca em resposta, log ou erro (o texto de erro do Omie passa por limpeza).

export const VERSAO = "faturamento-omie-v1-2026-10-20";
export const OMIE_BASE = "https://app.omie.com.br/api/v1";

/** Pausa mínima entre duas chamadas da mesma chave (o E0 leu 170 vezes com 1,1 s sem nenhum bloqueio). */
export const PAUSA_MS = 1100;
/** Tentativas de erro passageiro (rede, 5xx, 429) antes de virar erro para a tesouraria. O banco espera 1, 5, 15, 60 min. */
export const MAX_TENTATIVAS = 6;
/** Envios reservados por vez e no máximo por rodada (o cron roda a cada 2 minutos). */
export const LOTE = 4;
export const MAX_POR_RODADA = 12;
/** Tempo de uma rodada: para antes do intervalo do cron, para duas rodadas nunca falarem com a mesma chave ao mesmo tempo. */
export const ORCAMENTO_MS = 80_000;
/** Folga somada ao bloqueio que o Omie anuncia (MISUSE). */
export const MARGEM_BLOQUEIO_S = 30;
/** REDUNDANT com espera até isto é aguardado e repetido na hora (só leitura); acima, volta para a fila. */
export const ESPERA_REDUNDANT_MAX_S = 20;
/** Bloqueio assumido quando o Omie não diz quantos segundos. */
export const BLOQUEIO_PADRAO_S = 300;
/** Etapa em que a OS nasce: 50 = "Faturar". É a única em que o FaturarOS fatura (royalties e CSC, 2026). */
export const ETAPA_OS = "50";
/** Espera depois do FaturarOS antes de ler a nota (a OS demora a aparecer faturada; CSC, 30/09). */
export const ESPERA_POS_FATURAR_MS = 4000;
/** Teto de páginas do catálogo (50 por página; a maior emissora tem 42 serviços). */
export const MAX_PAGINAS_CATALOGO = 20;

/** Métodos que só leem. Em simulação, só estes passam. */
export const LEITURAS: ReadonlySet<string> = new Set([
  "ConsultarCliente",
  "ListarClientes",
  "ListarClientesResumido",
  "ConsultarOS",
  "StatusOS",
  "ListarOS",
  "ConsultarCadastroServico",
  "ListarCadastroServico",
  "ListarDepartamentos",
  "PesquisarLancamentos",
  "ConsultarContaReceber",
  "ListarContasReceber",
  "ListarNFSEs",
]);
/** Escritas que o conector faz em gravação. Qualquer outro método é recusado nos dois modos. */
export const ESCRITAS: ReadonlySet<string> = new Set([
  "IncluirCliente",
  "IncluirOS",
  "AlterarOS",
  "FaturarOS",
]);

export const OPERACOES = [
  "garantir_cliente",
  "incluir_os",
  "alterar_os",
  "faturar_os",
  "consultar_status",
  "sincronizar_servicos",
] as const;

const ACAO: Record<string, string> = {
  garantir_cliente: "o cadastro do cliente",
  incluir_os: "a ordem de serviço",
  alterar_os: "a alteração da ordem de serviço",
  faturar_os: "o faturamento",
  consultar_status: "a leitura da situação da OS",
  sincronizar_servicos: "a leitura do catálogo de serviços",
};

export type Modo = "simular" | "gravar";
export type Resultado = {
  status: "ok" | "simulado" | "erro" | "pendente";
  resposta: any;
  erro_legivel: string | null;
  codigos: Record<string, any>;
};
export type Transporte = (url: string, corpo: string) => Promise<{ status: number; texto: string }>;

// ---------------------------------------------------------------------------------------------------- utilidades

export const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/**
 * Documento normalizado como no banco (receita.fat_documento_normalizar): só letras e dígitos, letras maiúsculas.
 * CNPJ alfanumérico (IN RFB 2.229/2024, desde julho de 2026) tem letras nas 12 primeiras posições; CPF é só dígito.
 */
export const documento = (v: unknown) =>
  String(v ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
const texto = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
export const cortar = (v: unknown, n: number) => texto(v).slice(0, n);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
export const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/** "2026-11-13" → "13/11/2026" (o Omie só aceita dd/mm/aaaa). */
export function dataBr(iso: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
/** "13/11/2026" → "2026-11-13". */
export function isoDeBr(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** Data e hora do Omie (horário de Brasília, sem horário de verão desde 2019) → ISO com fuso. */
export function momentoBr(data: unknown, hora: unknown): string | null {
  const d = isoDeBr(data);
  if (!d) return null;
  const h = /^\d{2}:\d{2}(:\d{2})?$/.test(String(hora ?? "")) ? String(hora) : "00:00:00";
  return `${d}T${h.length === 5 ? `${h}:00` : h}-03:00`;
}
/** Hoje em São Paulo, AAAA-MM-DD. */
export function hojeSP(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}
/** CNPJ 00.000.000/0000-00 (ou 12.ABC.345/01DE-35), CPF 000.000.000-00: é como o Omie e o Pipefy guardam. */
export function documentoFormatado(doc: unknown): string {
  const d = documento(doc);
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}
/** Para casar rótulos (departamento): sem acento, minúsculo, espaço colapsado. */
export function normalizar(v: unknown): string {
  return texto(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
export function listaEmails(...listas: unknown[]): string[] {
  const vistos = new Set<string>();
  for (const l of listas) {
    for (const e of Array.isArray(l) ? l : []) {
      const x = texto(e).toLowerCase();
      if (/^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$/.test(x)) vistos.add(x);
    }
  }
  return [...vistos];
}
const emissoraId = (envio: any) => String(envio?.emissora?.id ?? envio?.emissora_id ?? "");
export const nomeEmissora = (envio: any) =>
  texto(envio?.emissora?.nome ?? envio?.emissora?.apelido ?? envio?.payload?.emissora?.apelido) ||
  "emissora";
const codigoOS = (envio: any) =>
  String(
    envio?.payload?.pedido?.codigo_integracao ||
      envio?.codigo_integracao ||
      envio?.payload?.pedido?.numero ||
      "",
  );
const horaSP = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Tira app_key e app_secret de qualquer objeto, em qualquer profundidade (a tabela recusa a resposta com elas). */
export function semChave(v: any): any {
  if (Array.isArray(v)) return v.map(semChave);
  if (v && typeof v === "object") {
    const o: Record<string, any> = {};
    for (const [k, x] of Object.entries(v))
      if (k !== "app_key" && k !== "app_secret") o[k] = semChave(x);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------- erros

/** Erro de uma chamada ao Omie, já classificado. A mensagem nunca leva a chave. */
export class ErroOmie extends Error {
  classe: string;
  http: number | null;
  segundos: number | null;
  faultcode: string | null;
  faultstring: string | null;
  metodo: string;
  constructor(info: {
    classe: string;
    http: number | null;
    segundos: number | null;
    faultcode: string | null;
    faultstring: string | null;
    metodo: string;
  }) {
    super(
      `${info.metodo}: ${info.classe}${info.http ? ` (HTTP ${info.http})` : ""}: ${info.faultstring ?? ""}`,
    );
    this.name = "ErroOmie";
    this.classe = info.classe;
    this.http = info.http;
    this.segundos = info.segundos;
    this.faultcode = info.faultcode;
    this.faultstring = info.faultstring;
    this.metodo = info.metodo;
  }
}

/** Escrita pedida com a emissora em simulação. Nunca deveria acontecer: é a rede de segurança da trava. */
export class EscritaBloqueada extends Error {
  metodo: string;
  constructor(metodo: string) {
    super(`Escrita ${metodo} recusada: envio em simulação`);
    this.name = "EscritaBloqueada";
    this.metodo = metodo;
  }
}

/**
 * Classes:
 * - indisponivel: 403, chave inválida ou aplicativo suspenso (AGRO desde 07/2026; MAROX Serviços em 13/10).
 * - bloqueio: MISUSE_API_PROCESS / "consumo indevido" (425). `segundos` = o que o Omie manda esperar.
 * - redundante: REDUNDANT / "consumo redundante" (500, Client-6): pedido idêntico em sequência. Espera e repete.
 * - vazio: Client-5113 "Não existem registros" (lista vazia, não erro).
 * - ja_faturada, ja_existe: idempotência ("já faturada", "já cadastrada").
 * - nao_encontrado: Client-103/5004 "… não cadastrada para o Código de Integração [x]" (lido na DOC em 20/10).
 * - chamador: outro SOAP-ENV:Client-*. Nunca repete.
 * - passageiro: rede, 408, 425 sem MISUSE, 429, 5xx do servidor.
 */
export function classificarErroOmie(http: number | null, corpo: string) {
  let faultstring: string | null = null;
  let faultcode: string | null = null;
  try {
    const j = JSON.parse(corpo);
    faultstring = j?.faultstring != null ? String(j.faultstring) : null;
    faultcode = j?.faultcode != null ? String(j.faultcode) : null;
  } catch {
    /* corpo que não é JSON (HTML de proxy, texto cru) */
  }
  const tudo = `${faultcode ?? ""} ${faultstring ?? corpo ?? ""}`;
  const m = /(\d+)\s*segundo/i.exec(tudo);
  const segundos = m ? Number(m[1]) : null;
  const base = {
    http,
    segundos,
    faultcode,
    faultstring: faultstring ?? (corpo ? corpo.slice(0, 300) : null),
  };
  if (
    http === 403 ||
    /aplicativo (est[áa] )?suspenso|chave de acesso (est[áa] )?inv[áa]lida/i.test(tudo)
  ) {
    return { classe: "indisponivel", ...base };
  }
  if (/MISUSE_API_PROCESS|consumo indevido/i.test(tudo)) return { classe: "bloqueio", ...base };
  if (/REDUNDANT|consumo redundante/i.test(tudo)) return { classe: "redundante", ...base };
  if (/Client-5113|n[ãa]o existem registros/i.test(tudo)) return { classe: "vazio", ...base };
  if (/j[áa] (foi |est[áa] )?faturad/i.test(tudo)) return { classe: "ja_faturada", ...base };
  if (/j[áa] (foi |est[áa] )?(cadastrad|inclu[íi]d)|j[áa] existe/i.test(tudo))
    return { classe: "ja_existe", ...base };
  if (/n[ãa]o (foi |est[áa] )?(cadastrad|encontrad|localizad)/i.test(tudo))
    return { classe: "nao_encontrado", ...base };
  if (/SOAP-ENV:Client/i.test(faultcode ?? "")) return { classe: "chamador", ...base };
  return { classe: "passageiro", ...base };
}

/** Texto do Omie limpo para a tesouraria: sem "ERROR:", sem o "!" do fim, sem chave, curto. */
export function falaDoOmie(e: { faultstring?: string | null }) {
  return cortar(
    String(e.faultstring ?? "")
      .replace(/^\s*ERROR:\s*/i, "")
      .replace(/\s*!+\s*$/, ""),
    300,
  );
}

/**
 * O que fazer com um erro do Omie: status do envio, frase para quem opera e códigos para o banco (API §2.3:
 * tentar_em, bloquear_emissora_ate, emissora_indisponivel).
 */
export function decidir(e: ErroOmie, envio: any, agora: Date): Resultado {
  const emissora = nomeEmissora(envio);
  const acao = ACAO[envio?.operacao] ?? "a chamada";
  const resposta = {
    erro: { classe: e.classe, metodo: e.metodo, http: e.http, omie: falaDoOmie(e) || null },
  };
  if (e.classe === "bloqueio") {
    const ate = new Date(
      agora.getTime() + ((e.segundos ?? BLOQUEIO_PADRAO_S) + MARGEM_BLOQUEIO_S) * 1000,
    ).toISOString();
    return {
      status: "pendente",
      resposta,
      erro_legivel:
        `O Omie da ${emissora} bloqueou a chave por excesso de chamadas até ${horaSP(ate)}. ` +
        "O envio volta para a fila sozinho depois disso.",
      codigos: { tentar_em: ate, bloquear_emissora_ate: ate },
    };
  }
  if (e.classe === "indisponivel") {
    return {
      status: "erro",
      resposta,
      erro_legivel:
        `A chave do Omie da ${emissora} está suspensa ou inválida: peça uma nova ao administrador da empresa no Omie. ` +
        "Depois de trocada, é só reenviar.",
      codigos: { emissora_indisponivel: true },
    };
  }
  if (e.classe === "redundante") {
    const ate = new Date(agora.getTime() + Math.max(e.segundos ?? 30, 30) * 1000).toISOString();
    return {
      status: "pendente",
      resposta,
      erro_legivel: `O Omie da ${emissora} pediu para esperar antes de repetir ${acao}; o envio volta sozinho.`,
      codigos: { tentar_em: ate },
    };
  }
  if (e.classe === "passageiro") {
    const tentativas = Number(envio?.tentativas ?? 1);
    if (tentativas >= MAX_TENTATIVAS) {
      return {
        status: "erro",
        resposta,
        erro_legivel:
          `O Omie da ${emissora} não respondeu em ${tentativas} tentativas (${e.http ? `HTTP ${e.http}` : "sem conexão"}). ` +
          "Reenvie mais tarde; nada foi duplicado.",
        codigos: {},
      };
    }
    return {
      status: "pendente",
      resposta,
      erro_legivel: `O Omie da ${emissora} não respondeu agora; o envio volta para a fila sozinho.`,
      codigos: {},
    };
  }
  // chamador, nao_encontrado, ja_existe/ja_faturada fora de contexto, vazio: não adianta repetir.
  const fala = falaDoOmie(e);
  return {
    status: "erro",
    resposta,
    erro_legivel: `O Omie da ${emissora} recusou ${acao}${fala ? `: ${fala}` : "."}`.replace(
      /\.?$/,
      ".",
    ),
    codigos: {},
  };
}

// ---------------------------------------------------------------------------------------------------- cliente do Omie

export type Ritmo = { ultima: number };

/**
 * Cliente do Omie de uma emissora para um envio.
 * - `modo` diferente de "gravar": só LEITURAS (EscritaBloqueada antes de qualquer rede).
 * - Pausa mínima de PAUSA_MS entre chamadas da mesma chave (o `ritmo` é compartilhado por emissora na rodada).
 * - Leitura repete erro passageiro (2 vezes) e REDUNDANT curto (2 vezes). Escrita nunca repete aqui.
 * - `chamadas` guarda método, HTTP e duração de cada chamada, sem param e sem chave (vai para a resposta do envio).
 */
export function criarOmie(o: {
  transporte: Transporte;
  credencial: { app_key: string; app_secret: string };
  modo: Modo;
  dormir: (ms: number) => Promise<void>;
  relogio?: () => number;
  ritmo?: Ritmo;
  pausaMs?: number;
}) {
  const relogio = o.relogio ?? (() => Date.now());
  const ritmo = o.ritmo ?? { ultima: 0 };
  const pausa = o.pausaMs ?? PAUSA_MS;
  const { app_key, app_secret } = o.credencial;
  const chamadas: Array<{ metodo: string; http: number | null; ms: number; classe?: string }> = [];
  const limpar = (t: string) => {
    let s = String(t ?? "");
    for (const segredo of [app_key, app_secret]) if (segredo) s = s.split(segredo).join("«chave»");
    return s;
  };

  async function chamar(endpoint: string, metodo: string, param: any): Promise<any> {
    const leitura = LEITURAS.has(metodo);
    if (!leitura && o.modo !== "gravar") throw new EscritaBloqueada(metodo);
    if (!leitura && !ESCRITAS.has(metodo))
      throw new Error(`Método ${metodo} fora da lista do conector`);
    let passageiros = 0;
    let redundantes = 0;
    for (;;) {
      const espera = pausa - (relogio() - ritmo.ultima);
      if (espera > 0) await o.dormir(espera);
      const t0 = relogio();
      let http: number | null = null;
      let corpo = "";
      try {
        const r = await o.transporte(
          `${OMIE_BASE}/${endpoint}/`,
          JSON.stringify({ call: metodo, app_key, app_secret, param: [param] }),
        );
        http = r.status;
        corpo = limpar(r.texto);
      } catch (e) {
        corpo = limpar(String((e as Error)?.message ?? e));
      }
      ritmo.ultima = relogio();
      if (http === 200) {
        let j: any = null;
        try {
          j = JSON.parse(corpo);
        } catch {
          j = null;
        }
        // O Omie às vezes responde 200 com fault no corpo.
        if (j && !(j.faultcode && j.faultstring)) {
          chamadas.push({ metodo, http, ms: relogio() - t0 });
          return j;
        }
      }
      const c = classificarErroOmie(http, corpo);
      chamadas.push({ metodo, http, ms: relogio() - t0, classe: c.classe });
      if (
        leitura &&
        c.classe === "redundante" &&
        redundantes < 2 &&
        (c.segundos ?? 10) <= ESPERA_REDUNDANT_MAX_S
      ) {
        redundantes++;
        await o.dormir(((c.segundos ?? 10) + 1) * 1000);
        continue;
      }
      if (leitura && c.classe === "passageiro" && passageiros < 2) {
        passageiros++;
        await o.dormir(2000 * passageiros);
        continue;
      }
      throw new ErroOmie({ ...c, metodo });
    }
  }

  /** Leitura que pode não achar: "não cadastrado" e "não existem registros" viram null. */
  async function consultar(endpoint: string, metodo: string, param: any): Promise<any | null> {
    try {
      return await chamar(endpoint, metodo, param);
    } catch (e) {
      if (e instanceof ErroOmie && (e.classe === "nao_encontrado" || e.classe === "vazio"))
        return null;
      throw e;
    }
  }

  return { chamar, consultar, chamadas, modo: o.modo };
}
export type Omie = ReturnType<typeof criarOmie>;

// ---------------------------------------------------------------------------------------------------- montagem

/**
 * IncluirCliente (geral/clientes). codigo_cliente_integracao = documento (spec §8). Razão social até 60 caracteres,
 * nome fantasia até 100, um e-mail (o campo é do cadastro; todos os e-mails vão na OS) e tag "Cliente", a mesma que a
 * Base de clientes lê do Omie. Endereço: o da consulta da Receita em cache (integracoes.receita_cnpj), quando houver;
 * sem ela, só o município e a UF da foto do pedido.
 */
export function montarCliente(payload: any, receita?: any | null) {
  const t = payload?.tomador ?? {};
  const doc = documento(t.documento);
  const nome = texto(t.nome) || documentoFormatado(doc);
  const emails = listaEmails(payload?.pedido?.emails_envio, t.emails);
  const c: Record<string, any> = {
    codigo_cliente_integracao: String(t.codigo_cliente_integracao || doc),
    cnpj_cpf: documentoFormatado(doc),
    razao_social: cortar(nome, 60),
    nome_fantasia: cortar(nome, 100),
    tags: [{ tag: "Cliente" }],
  };
  if (emails.length) c.email = emails[0];
  const r = receita ?? {};
  if (texto(r.logradouro)) c.endereco = cortar(r.logradouro, 60);
  if (texto(r.numero)) c.endereco_numero = cortar(r.numero, 60);
  if (texto(r.complemento)) c.complemento = cortar(r.complemento, 60);
  if (texto(r.bairro)) c.bairro = cortar(r.bairro, 60);
  const cep = digitos(r.cep);
  if (cep.length === 8) {
    c.cep = `${cep.slice(0, 5)}-${cep.slice(5)}`;
    // Preenche pelo CEP só o que ficou vazio (logradouro, bairro, cidade).
    c.pesquisar_cep = "S";
  }
  const municipio = texto(r.municipio) || texto(t.municipio);
  const uf = texto(r.uf) || texto(t.uf);
  if (municipio) c.cidade = cortar(municipio, 40);
  if (/^[A-Za-z]{2}$/.test(uf)) c.estado = uf.toUpperCase();
  return c;
}

/** Tem endereço de verdade (logradouro e CEP) para o cadastro do cliente? */
export const temEndereco = (receita: any | null) =>
  !!(texto(receita?.logradouro) && digitos(receita?.cep).length === 8);

/** Parcelas da foto do pedido, em ordem, com o total conferido contra o valor. */
export function parcelasDoPedido(payload: any) {
  const lista = (Array.isArray(payload?.parcelas) ? payload.parcelas : [])
    .map((p: any) => ({
      n: Number(p.n),
      vencimento: String(p.vencimento ?? ""),
      valor: centavos(p.valor),
    }))
    .sort((a: any, b: any) => a.n - b.n);
  const soma = centavos(lista.reduce((s: number, p: any) => s + p.valor, 0));
  return { lista, soma };
}

/**
 * IncluirOS (servicos/os). Recibo e nota de débito também saem por OS (Ana, 15/10), com Email.cEnvRecibo = "S", como
 * a royalties-faturamento e a csc-faturamento-mensal fazem na Partners.
 * - Cabecalho: cCodIntOS = número do pedido; etapa 50; cCodParc 999 com o bloco Parcelas (a forma customizada, a única
 *   que aceita os vencimentos do portal); dDtPrevisao = 1º vencimento.
 * - Item: o serviço do catálogo (nCodServico) leva LC 116, código municipal e impostos do cadastro (ninguém digita
 *   imposto); cCodCategItem repete a categoria porque sem ele o item fica com a categoria do cadastro do serviço
 *   (lição da CSC de 08/2026). cDescServ = descrição da nota.
 * - Recibo e ND: a linha impressa vem do cadastro do serviço, não do cDescServ (royalties, 14/09); por isso a
 *   descrição vai também em cDadosAdicNF.
 * - Email: os e-mails do pedido; boleto ou pix conforme o meio (o Omie aceita só um dos dois); link da NFS-e só na NF.
 * - Parcelas: tipo do documento e meio de pagamento (15 boleto, 17 pix); pix não gera boleto.
 * - Observacoes (não sai na nota): número do pedido, projeto, competência e as observações.
 */
export function montarOS(
  payload: any,
  ctx: {
    nCodCli: number | null;
    cCodDepto: string | null;
    categoria: string | null;
    contaCorrente: number | null;
  },
) {
  const ped = payload?.pedido ?? {};
  const srv = payload?.servico ?? {};
  const { lista } = parcelasDoPedido(payload);
  const recibo = ped.documento === "recibo" || ped.documento === "nd";
  const pix = ped.meio === "pix";
  const valor = centavos(ped.valor);
  const descricao = cortar(ped.descricao_nf, 2000);
  const competencia = /^(\d{4})-(\d{2})/.exec(String(ped.competencia ?? ""));
  const obs = [
    `Pedido ${ped.numero ?? codigoOS({ payload })} do Portal de Faturamento.`,
    texto(ped.projeto) && `Projeto: ${texto(ped.projeto)}.`,
    competencia && `Competência: ${competencia[2]}/${competencia[1]}.`,
    texto(ped.observacoes) && `Observações: ${texto(ped.observacoes)}`,
  ]
    .filter(Boolean)
    .join(" ");
  const info: Record<string, any> = { cCodCateg: ctx.categoria, nCodCC: ctx.contaCorrente };
  if (recibo && descricao) info.cDadosAdicNF = descricao;
  return {
    Cabecalho: {
      cCodIntOS: codigoOS({ payload }),
      nCodCli: ctx.nCodCli,
      cEtapa: ETAPA_OS,
      dDtPrevisao: dataBr(lista[0]?.vencimento ?? ped.primeiro_vencimento),
      cCodParc: "999",
      nQtdeParc: lista.length,
    },
    InformacoesAdicionais: info,
    Email: {
      cEnvRecibo: recibo ? "S" : "N",
      cEnvLink: recibo ? "N" : "S",
      cEnvBoleto: pix ? "N" : "S",
      cEnvPix: pix ? "S" : "N",
      cEnviarPara: listaEmails(ped.emails_envio).join("; "),
    },
    Departamentos: ctx.cCodDepto
      ? [{ cCodDepto: ctx.cCodDepto, nPerc: 100, nValor: valor, nValorFixo: "S" }]
      : [],
    ServicosPrestados: [
      {
        nCodServico: num(srv.codigo_omie),
        cCodCategItem: ctx.categoria,
        nQtde: 1,
        nValUnit: valor,
        cDescServ: descricao,
        cNaoGerarFinanceiro: "N",
        cReembolso: "N",
      },
    ],
    Parcelas: lista.map((p: any) => ({
      nParcela: p.n,
      dDtVenc: dataBr(p.vencimento),
      nValor: p.valor,
      tipo_documento: pix ? "PIX" : "BOL",
      meio_pagamento: pix ? "17" : "15",
      nao_gerar_boleto: pix ? "S" : "N",
    })),
    Observacoes: { cObsOS: cortar(obs, 2000) },
  };
}

/** O que impede gravar a OS (frases para a tesouraria). Em simulação viram avisos. */
export function pendenciasDaOS(payload: any, param: any, leituras: { servico_existe?: boolean }) {
  const p: string[] = [];
  const emissora = texto(payload?.emissora?.apelido) || "emissora";
  const { lista, soma } = parcelasDoPedido(payload);
  if (!param.Cabecalho.nCodCli) p.push("O cliente ainda não tem código no Omie da emissora.");
  if (!param.ServicosPrestados[0].nCodServico)
    p.push("O serviço do pedido não tem código do Omie.");
  else if (leituras.servico_existe === false) {
    p.push(
      `O serviço ${texto(payload?.servico?.codigo) || param.ServicosPrestados[0].nCodServico} não existe ou está inativo ` +
        `no Omie da ${emissora}: a controladoria precisa sincronizar o catálogo.`,
    );
  }
  if (!param.InformacoesAdicionais.cCodCateg)
    p.push("O serviço está sem categoria padrão: a controladoria define em Configuração.");
  if (!param.InformacoesAdicionais.nCodCC) {
    p.push(
      `Falta a conta corrente do Omie da ${emissora}: a controladoria escolhe em Configuração antes de gravar.`,
    );
  }
  if (!param.Email.cEnviarPara) p.push("O pedido não tem e-mail de envio.");
  if (!lista.length) p.push("O pedido chegou sem parcelas.");
  else if (soma !== centavos(payload?.pedido?.valor))
    p.push("A soma das parcelas não bate com o valor do pedido.");
  if (lista.some((x: any) => !dataBr(x.vencimento))) p.push("Há parcela sem vencimento.");
  return p;
}

/**
 * AlterarOS: o mesmo conteúdo da inclusão sobre a OS que já existe (pedido devolvido e reenviado). O primeiro item
 * existente é alterado (cAcaoItem "A", nIdItem da consulta) e os demais saem ("E").
 */
export function montarAlterarOS(base: ReturnType<typeof montarOS>, atual: any) {
  const nCodOS = num(atual?.Cabecalho?.nCodOS);
  const itens: any[] = Array.isArray(atual?.ServicosPrestados) ? atual.ServicosPrestados : [];
  const novo = base.ServicosPrestados[0];
  const servicos = itens.length
    ? itens.map((it: any, i: number) =>
        i === 0
          ? { ...novo, nIdItem: num(it.nIdItem), cAcaoItem: "A" }
          : { nIdItem: num(it.nIdItem), cAcaoItem: "E" },
      )
    : [{ ...novo, cAcaoItem: "I" }];
  const { cCodIntOS: _c, ...cab } = base.Cabecalho;
  return { ...base, Cabecalho: { nCodOS, ...cab }, ServicosPrestados: servicos };
}

const SITUACAO_TITULO: Record<string, string> = {
  RECEBIDO: "pago",
  LIQUIDADO: "pago",
  CANCELADO: "cancelado",
  ATRASADO: "em_atraso",
};
/** Títulos da OS (financas/pesquisartitulos, filtrado por nCodOS): parcela de "001/003", situação e pagamento. */
export function titulosDaOS(resp: any) {
  const out: any[] = [];
  for (const x of Array.isArray(resp?.titulosEncontrados) ? resp.titulosEncontrados : []) {
    const c = x?.cabecTitulo ?? {};
    if (c.cNatureza && c.cNatureza !== "R") continue;
    const parcela = Number(/^(\d+)/.exec(String(c.cNumParcela ?? ""))?.[1] ?? 0);
    if (!parcela) continue;
    const t: Record<string, any> = {
      parcela,
      codigo: num(c.nCodTitulo),
      situacao: SITUACAO_TITULO[String(c.cStatus ?? "").toUpperCase()] ?? "a_vencer",
    };
    const pago = isoDeBr(c.dDtPagamento);
    if (pago) t.pago_em = pago;
    out.push(t);
  }
  return out.sort((a, b) => a.parcela - b.parcela);
}

/** StatusOS (+ títulos) → p_status de integracoes.fat_status_aplicar (API §2.4). Só chaves documentadas. */
export function leituraStatus(st: any, lancamentos: any | null, lidoEm: string) {
  const out: Record<string, any> = {
    os: { codigo: num(st?.nCodOS), etapa: st?.cEtapa ?? null },
    lido_em: lidoEm,
  };
  if (st?.cFaturada === "S") {
    const rps =
      (Array.isArray(st?.ListaRpsNfse) ? st.ListaRpsNfse : []).find((r: any) => texto(r?.nNfse)) ??
      null;
    const numero = texto(rps?.nNfse) || texto(st?.cNumRecibo) || null;
    const link = rps
      ? texto(rps.cUrlNfse) || texto(rps.cUrlPdfDest) || null
      : texto(st?.cUrlPdfRecibo) || null;
    if (numero) out.nf = { numero, link, emitida_em: momentoBr(st?.dDtFat, st?.cHrFat) };
  }
  if (lancamentos) out.titulos = titulosDaOS(lancamentos);
  return out;
}

/** Um cadastro do ListarCadastroServico → item de p_catalogo (API §2.6), igual à semente do E0. */
export function servicoDoOmie(c: any) {
  const cab = c?.cabecalho ?? {};
  const il = c?.intListar ?? {};
  const imp =
    c?.impostos && typeof c.impostos === "object" && !Array.isArray(c.impostos) ? c.impostos : null;
  const s: Record<string, any> = {
    codigo_omie: il.nCodServ != null ? String(il.nCodServ) : "",
    descricao: texto(cab.cDescricao),
    codigo: texto(cab.cCodigo) || null,
    codigo_lc116: texto(cab.cCodLC116) || null,
    codigo_municipal: texto(cab.cCodServMun) || null,
    id_tributacao: texto(cab.cIdTrib) || null,
    categoria: texto(cab.cCodCateg) || null,
    inativo: c?.info?.inativo === "S",
  };
  // O banco recusa tributacao que não seja objeto: sem impostos, a chave não vai (e o cadastro mantém o que tinha).
  if (imp) s.tributacao = imp;
  return s;
}

// ---------------------------------------------------------------------------------------------------- operações

export type Contexto = {
  omie: Omie;
  modo: Modo;
  agora: () => Date;
  dormir: (ms: number) => Promise<void>;
  /** Departamentos do Omie por emissora, lidos uma vez por rodada. */
  departamentos: Map<string, Array<{ codigo: string; descricao: string; inativo?: string }>>;
  statusAplicar: (pedido: string, status: any) => Promise<any>;
  servicosAplicar: (emissora: string, catalogo: any[]) => Promise<any>;
  /** Consulta da Receita em cache para o CNPJ (ops.fat_conector_receita_cnpj); nulo sem consulta. */
  receitaCnpj?: (cnpj: string) => Promise<any | null>;
};

const fim = (ctx: Contexto, resposta: any, codigos: Record<string, any> = {}): Resultado => ({
  status: ctx.modo === "gravar" ? "ok" : "simulado",
  resposta,
  erro_legivel: null,
  codigos,
});
const erro = (
  resposta: any,
  erro_legivel: string,
  codigos: Record<string, any> = {},
): Resultado => ({
  status: "erro",
  resposta,
  erro_legivel,
  codigos,
});

async function garantirCliente(envio: any, ctx: Contexto): Promise<Resultado> {
  const payload = envio?.payload ?? {};
  const t = payload.tomador ?? {};
  const doc = documento(t.documento);
  let param = montarCliente(payload);
  if (!/^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$/.test(doc)) {
    const base = { metodo: "IncluirCliente", param };
    return erro(
      base,
      "O documento do tomador chegou incompleto no pedido; nada foi enviado ao Omie.",
    );
  }
  const leituras: Record<string, any> = {};
  let achado: { codigo: number; integracao: string | null; inativo: boolean; por: string } | null =
    null;

  const vinculo = num(envio?.cliente_omie?.codigo_cliente_omie);
  if (vinculo) {
    const c = await ctx.omie.consultar("geral/clientes", "ConsultarCliente", {
      codigo_cliente_omie: vinculo,
    });
    if (c)
      achado = {
        codigo: vinculo,
        integracao: texto(c.codigo_cliente_integracao) || null,
        inativo: c.inativo === "S",
        por: "vinculo",
      };
  }
  if (!achado) {
    const c = await ctx.omie.consultar("geral/clientes", "ConsultarCliente", {
      codigo_cliente_integracao: param.codigo_cliente_integracao,
    });
    const codigo = num(c?.codigo_cliente_omie);
    if (codigo)
      achado = {
        codigo,
        integracao: texto(c.codigo_cliente_integracao) || null,
        inativo: c.inativo === "S",
        por: "codigo_integracao",
      };
  }
  if (!achado) {
    // Cliente cadastrado à mão (sem código de integração): procura pelo documento. A busca aceita com e sem máscara.
    const l = await ctx.omie.consultar("geral/clientes", "ListarClientes", {
      pagina: 1,
      registros_por_pagina: 20,
      apenas_importado_api: "N",
      // Com máscara, como o Omie guarda (com e sem máscara funcionou na DOC em 20/10; a máscara cobre o alfanumérico).
      clientesFiltro: { cnpj_cpf: documentoFormatado(doc) },
    });
    const lista = (Array.isArray(l?.clientes_cadastro) ? l.clientes_cadastro : []).filter(
      (c: any) => documento(c.cnpj_cpf) === doc && num(c.codigo_cliente_omie),
    );
    leituras.cadastros_com_o_documento = lista.length;
    const c = lista.find((x: any) => x.inativo !== "S") ?? lista[0];
    if (c) {
      achado = {
        codigo: num(c.codigo_cliente_omie)!,
        integracao: texto(c.codigo_cliente_integracao) || null,
        inativo: c.inativo === "S",
        por: "documento",
      };
    }
  }

  if (achado) {
    leituras.cliente_existe = true;
    leituras.achado_por = achado.por;
    const avisos = achado.inativo
      ? ["O cliente está inativo no Omie da emissora: a OS pode ser recusada."]
      : [];
    return fim(
      ctx,
      { metodo: null, param_se_nao_existisse: param, leituras, avisos },
      {
        codigo_cliente_omie: achado.codigo,
        codigo_cliente_integracao: achado.integracao,
        cliente_existia: true,
      },
    );
  }
  leituras.cliente_existe = false;
  // Cliente novo: endereço da consulta da Receita (só leitura do nosso banco, nos dois modos).
  const avisos: string[] = [];
  let receita: any = null;
  if (doc.length === 14 && ctx.receitaCnpj) receita = await ctx.receitaCnpj(doc);
  param = montarCliente(payload, receita);
  leituras.endereco_da_receita = temEndereco(receita);
  if (!temEndereco(receita)) {
    avisos.push(
      doc.length === 11
        ? "Pessoa física: o cliente entra no Omie só com município e UF (a NFS-e pode pedir o endereço)."
        : "Sem consulta da Receita com endereço no Brain para este CNPJ: o cliente entra no Omie só com município e " +
            "UF (a NFS-e pode pedir o endereço).",
    );
  }
  const base = { metodo: "IncluirCliente", param };
  if (ctx.modo !== "gravar") {
    return fim(
      ctx,
      { ...base, leituras, avisos },
      {
        codigo_cliente_integracao: param.codigo_cliente_integracao,
        cliente_existia: false,
      },
    );
  }
  let r: any;
  try {
    r = await ctx.omie.chamar("geral/clientes", "IncluirCliente", param);
  } catch (e) {
    if (!(e instanceof ErroOmie && e.classe === "ja_existe")) throw e;
    // Corrida com outro cadastro: o cliente entrou entre a consulta e a inclusão. Consulta de novo.
    r = await ctx.omie.consultar("geral/clientes", "ConsultarCliente", {
      codigo_cliente_integracao: param.codigo_cliente_integracao,
    });
    if (!num(r?.codigo_cliente_omie)) throw e;
  }
  return fim(
    ctx,
    { ...base, leituras, avisos, retorno: r },
    {
      codigo_cliente_omie: num(r?.codigo_cliente_omie),
      codigo_cliente_integracao: param.codigo_cliente_integracao,
      cliente_existia: false,
    },
  );
}

/** Código do departamento no Omie da emissora pelo nome do pedido (lista lida uma vez por rodada). */
async function departamento(envio: any, ctx: Contexto, avisos: string[]): Promise<string | null> {
  const nome = texto(envio?.payload?.pedido?.departamento);
  if (!nome) return null;
  const id = emissoraId(envio);
  let lista = ctx.departamentos.get(id);
  if (!lista) {
    const r = await ctx.omie.consultar("geral/departamentos", "ListarDepartamentos", {
      pagina: 1,
      registros_por_pagina: 100,
    });
    const lidos: Array<{ codigo: string; descricao: string; inativo?: string }> = (
      Array.isArray(r?.departamentos) ? r.departamentos : []
    ).map((d: any) => ({
      codigo: String(d.codigo ?? ""),
      descricao: String(d.descricao ?? ""),
      inativo: d.inativo,
    }));
    ctx.departamentos.set(id, lidos);
    lista = lidos;
  }
  const alvo = normalizar(nome);
  const d = lista.find((x) => normalizar(x.descricao) === alvo && x.inativo !== "S" && x.codigo);
  if (!d)
    avisos.push(
      `O departamento "${nome}" não existe no Omie da ${nomeEmissora(envio)}: a OS vai sem departamento.`,
    );
  return d?.codigo ?? null;
}

function padroes(payload: any) {
  return {
    categoria: texto(payload?.servico?.categoria) || null,
    contaCorrente:
      num(payload?.servico?.conta_corrente) ?? num(payload?.emissora?.conta_corrente_padrao),
  };
}

async function incluirOS(envio: any, ctx: Contexto): Promise<Resultado> {
  const payload = envio?.payload ?? {};
  const cCodIntOS = codigoOS(envio);
  const leituras: Record<string, any> = {};
  const avisos: string[] = [];

  // 1. Idempotência: OS com este código já existe = sucesso (CA-06).
  const existente = await ctx.omie.consultar("servicos/os", "ConsultarOS", { cCodIntOS });
  if (existente) {
    const cab = existente.Cabecalho ?? {};
    leituras.os_existe = true;
    const codigos = {
      nCodOS: num(cab.nCodOS),
      cNumOS: cab.cNumOS ?? null,
      cEtapa: cab.cEtapa ?? null,
      ja_existia: true,
    };
    if (ctx.modo !== "gravar")
      avisos.push(
        "Já existe OS com este código no Omie: em gravação, o envio só ligaria o pedido a ela.",
      );
    return fim(ctx, { metodo: null, leituras, avisos }, codigos);
  }
  leituras.os_existe = false;

  // 2. Cliente (do garantir_cliente que veio antes) e serviço.
  const nCodCli =
    num(envio?.dependencia?.codigos?.codigo_cliente_omie) ??
    num(envio?.cliente_omie?.codigo_cliente_omie);
  leituras.cliente_existe = !!nCodCli;
  const nCodServ = num(payload?.servico?.codigo_omie);
  if (nCodServ) {
    const s = await ctx.omie.consultar("servicos/servico", "ConsultarCadastroServico", {
      nCodServ,
    });
    leituras.servico_existe = !!s && s?.info?.inativo !== "S";
  } else {
    leituras.servico_existe = false;
  }
  const cCodDepto = await departamento(envio, ctx, avisos);
  if (cCodDepto) leituras.departamento = cCodDepto;

  const param = montarOS(payload, { nCodCli, cCodDepto, ...padroes(payload) });
  const pendencias = pendenciasDaOS(payload, param, leituras);
  const codigosSim = {
    cliente_existe: leituras.cliente_existe,
    servico_existe: leituras.servico_existe,
    os_existe: false,
  };
  if (ctx.modo !== "gravar") {
    // Em simulação o cliente novo ainda não tem código: a pendência dele não conta.
    const avisosSim = pendencias.filter(
      (p) => nCodCli || !p.startsWith("O cliente ainda não tem código"),
    );
    return fim(
      ctx,
      { metodo: "IncluirOS", param, leituras, avisos: [...avisos, ...avisosSim] },
      codigosSim,
    );
  }
  if (pendencias.length) {
    return erro(
      { metodo: "IncluirOS", param, leituras, avisos },
      `Nada foi gravado no Omie. ${pendencias.join(" ")}`,
    );
  }

  // 3. Grava.
  let r: any;
  try {
    r = await ctx.omie.chamar("servicos/os", "IncluirOS", param);
  } catch (e) {
    if (!(e instanceof ErroOmie && e.classe === "ja_existe")) throw e;
    const os = await ctx.omie.consultar("servicos/os", "ConsultarOS", { cCodIntOS });
    if (!num(os?.Cabecalho?.nCodOS)) throw e;
    r = { nCodOS: os.Cabecalho.nCodOS, cNumOS: os.Cabecalho.cNumOS, ja_existia: true };
  }
  const nCodOS = num(r?.nCodOS ?? r?.Cabecalho?.nCodOS);
  if (!nCodOS) {
    return erro(
      { metodo: "IncluirOS", param, leituras, retorno: r },
      `O Omie da ${nomeEmissora(envio)} não devolveu o número da OS: confira no Omie antes de reenviar.`,
    );
  }
  return fim(
    ctx,
    { metodo: "IncluirOS", param, leituras, avisos, retorno: r },
    {
      nCodOS,
      cNumOS: r?.cNumOS ?? r?.Cabecalho?.cNumOS ?? null,
      cEtapa: ETAPA_OS,
    },
  );
}

async function alterarOS(envio: any, ctx: Contexto): Promise<Resultado> {
  const payload = envio?.payload ?? {};
  const nCodOS = num(payload?.omie_os_codigo);
  const chave = nCodOS ? { nCodOS } : { cCodIntOS: codigoOS(envio) };
  const leituras: Record<string, any> = {};
  const avisos: string[] = [];
  const atual = await ctx.omie.consultar("servicos/os", "ConsultarOS", chave);
  leituras.os_existe = !!atual;
  if (!atual) {
    const r = { metodo: "AlterarOS", leituras, avisos };
    const msg = `A OS deste pedido não está mais no Omie da ${nomeEmissora(envio)}: confira no Omie antes de reenviar.`;
    return ctx.modo === "gravar"
      ? erro(r, msg)
      : fim(ctx, { ...r, avisos: [msg] }, { os_existe: false });
  }
  const info = atual.InfoCadastro ?? {};
  if (info.cFaturada === "S" || info.cCancelada === "S") {
    const msg =
      info.cFaturada === "S"
        ? "A OS já foi faturada no Omie e não pode mais ser alterada: cancele a nota no Omie e peça de novo."
        : "A OS está cancelada no Omie: não dá para alterar.";
    return ctx.modo === "gravar"
      ? erro({ metodo: "AlterarOS", leituras }, msg)
      : fim(ctx, { metodo: "AlterarOS", leituras, avisos: [msg] });
  }
  const nCodCli =
    num(envio?.dependencia?.codigos?.codigo_cliente_omie) ??
    num(envio?.cliente_omie?.codigo_cliente_omie) ??
    num(atual?.Cabecalho?.nCodCli);
  const nCodServ = num(payload?.servico?.codigo_omie);
  if (nCodServ) {
    const s = await ctx.omie.consultar("servicos/servico", "ConsultarCadastroServico", {
      nCodServ,
    });
    leituras.servico_existe = !!s && s?.info?.inativo !== "S";
  }
  const cCodDepto = await departamento(envio, ctx, avisos);
  const base = montarOS(payload, { nCodCli, cCodDepto, ...padroes(payload) });
  const param = montarAlterarOS(base, atual);
  const pendencias = pendenciasDaOS(payload, base, leituras);
  if (ctx.modo !== "gravar")
    return fim(ctx, { metodo: "AlterarOS", param, leituras, avisos: [...avisos, ...pendencias] });
  if (pendencias.length)
    return erro(
      { metodo: "AlterarOS", param, leituras },
      `Nada foi gravado no Omie. ${pendencias.join(" ")}`,
    );
  const r = await ctx.omie.chamar("servicos/os", "AlterarOS", param);
  return fim(
    ctx,
    { metodo: "AlterarOS", param, leituras, avisos, retorno: r },
    {
      nCodOS: num(atual?.Cabecalho?.nCodOS),
      cEtapa: atual?.Cabecalho?.cEtapa ?? null,
    },
  );
}

/** Lê títulos da OS faturada (uma página basta: no máximo 36 parcelas). */
async function lancamentos(ctx: Contexto, nCodOS: number | null) {
  if (!nCodOS) return null;
  return await ctx.omie.consultar("financas/pesquisartitulos", "PesquisarLancamentos", {
    nPagina: 1,
    nRegPorPagina: 100,
    nCodOS,
    cNatureza: "R",
  });
}

function codigosDaNota(leitura: any) {
  const c: Record<string, any> = {};
  if (leitura?.nf?.numero) {
    c.nf_numero = leitura.nf.numero;
    if (leitura.nf.link) c.nf_link = leitura.nf.link;
    if (leitura.nf.emitida_em) c.nf_emitida_em = leitura.nf.emitida_em;
  }
  const titulos = (leitura?.titulos ?? [])
    .filter((t: any) => t.codigo)
    .map((t: any) => ({ parcela: t.parcela, codigo: t.codigo }));
  if (titulos.length) c.titulos = titulos;
  return c;
}

async function faturarOS(envio: any, ctx: Contexto): Promise<Resultado> {
  const payload = envio?.payload ?? {};
  const nCodOS = num(payload?.omie_os_codigo);
  const chave = nCodOS ? { nCodOS } : { cCodIntOS: codigoOS(envio) };
  const leituras: Record<string, any> = {};
  const st = await ctx.omie.consultar("servicos/os", "StatusOS", { ...chave, lPdfRecibo: true });
  leituras.os_existe = !!st;
  if (ctx.modo !== "gravar") {
    // Pedido simulado fatura em simulação: não existe OS para faturar, e a leitura prova que nada foi gravado.
    const avisos = st
      ? ["Existe OS com este código no Omie: em gravação, ela seria faturada."]
      : [];
    return fim(ctx, { metodo: "FaturarOS", param: chave, leituras, avisos }, { os_existe: !!st });
  }
  const emissora = nomeEmissora(envio);
  if (!st)
    return erro(
      { metodo: "FaturarOS", param: chave, leituras },
      `Não achei a OS ${codigoOS(envio)} no Omie da ${emissora}: confira no Omie.`,
    );
  if (st.cCancelada === "S")
    return erro(
      { metodo: "FaturarOS", param: chave, leituras },
      "A OS está cancelada no Omie: não dá para faturar.",
    );
  const nCod = num(st.nCodOS) ?? nCodOS;
  if (st.cFaturada === "S") {
    // Já faturada (pela tela do Omie ou por uma tentativa anterior que caiu): só lê a nota.
    const leitura = leituraStatus(st, await lancamentos(ctx, nCod), ctx.agora().toISOString());
    return fim(
      ctx,
      { metodo: null, param: chave, leituras: { ...leituras, ja_faturada: true }, leitura },
      codigosDaNota(leitura),
    );
  }
  // Boleto não nasce vencido: o FaturarOS volta sem faturar e a OS fica presa na etapa 50 (royalties, São Luís, 15/09).
  const { lista } = parcelasDoPedido(payload);
  const hoje = hojeSP(ctx.agora());
  const vencida = lista.find((p: any) => p.vencimento && p.vencimento < hoje);
  if (vencida && payload?.pedido?.meio !== "pix") {
    return erro(
      { metodo: "FaturarOS", param: chave, leituras },
      `A parcela ${vencida.n} vence em ${dataBr(vencida.vencimento)}, antes de hoje: o Omie não fatura boleto vencido. ` +
        "Devolva o pedido para o autor corrigir o vencimento.",
    );
  }
  let r: any = null;
  try {
    r = await ctx.omie.chamar("servicos/osp", "FaturarOS", nCod ? { nCodOS: nCod } : chave);
  } catch (e) {
    if (!(e instanceof ErroOmie && e.classe === "ja_faturada")) throw e;
  }
  if (r && r.cCodStatus != null && String(r.cCodStatus) !== "0") {
    return erro(
      { metodo: "FaturarOS", param: chave, leituras, retorno: r },
      `O Omie da ${emissora} não faturou a OS: ${cortar(r.cDescStatus, 300) || `código ${r.cCodStatus}`}.`,
    );
  }
  await ctx.dormir(ESPERA_POS_FATURAR_MS);
  const st2 = await ctx.omie.consultar("servicos/os", "StatusOS", {
    nCodOS: nCod,
    lPdfRecibo: true,
  });
  const faturada = st2?.cFaturada === "S";
  const leitura = leituraStatus(
    st2 ?? {},
    faturada ? await lancamentos(ctx, nCod) : null,
    ctx.agora().toISOString(),
  );
  const avisos = faturada
    ? []
    : [
        "O Omie aceitou o faturamento e a nota ainda não apareceu; a leitura de status completa depois.",
      ];
  return fim(
    ctx,
    { metodo: "FaturarOS", param: chave, leituras, retorno: r, leitura, avisos },
    codigosDaNota(leitura),
  );
}

async function consultarStatus(envio: any, ctx: Contexto): Promise<Resultado> {
  const payload = envio?.payload ?? {};
  const nCodOS = num(payload?.omie_os_codigo);
  const chave = nCodOS ? { nCodOS } : { cCodIntOS: codigoOS(envio) };
  const st = await ctx.omie.consultar("servicos/os", "StatusOS", { ...chave, lPdfRecibo: true });
  if (!st) {
    const msg = `A OS ${codigoOS(envio)} não foi achada no Omie da ${nomeEmissora(envio)}: confira no Omie.`;
    return ctx.modo === "gravar"
      ? erro({ metodo: "StatusOS", param: chave }, msg)
      : fim(ctx, { metodo: "StatusOS", param: chave, avisos: [msg] });
  }
  const faturada = st.cFaturada === "S";
  const leitura = leituraStatus(
    st,
    faturada ? await lancamentos(ctx, num(st.nCodOS) ?? nCodOS) : null,
    ctx.agora().toISOString(),
  );
  // Leitura não escreve no Omie: aplica nos dois modos (o banco ignora pedido simulado).
  const aplicado = envio?.origem_id
    ? await ctx.statusAplicar(String(envio.origem_id), leitura)
    : null;
  return fim(ctx, {
    metodo: "StatusOS",
    param: chave,
    leitura,
    os: { faturada, cancelada: st.cCancelada === "S", etapa: st.cEtapa ?? null },
    aplicado,
  });
}

async function sincronizarServicos(envio: any, ctx: Contexto): Promise<Resultado> {
  const emissora = String(envio?.origem_id ?? emissoraId(envio));
  const catalogo: any[] = [];
  let pagina = 1;
  let total = 1;
  while (pagina <= total && pagina <= MAX_PAGINAS_CATALOGO) {
    const r = await ctx.omie.consultar("servicos/servico", "ListarCadastroServico", {
      nPagina: pagina,
      nRegPorPagina: 50,
      cExibirProdutos: "N",
    });
    if (!r) break;
    total = Number(r.nTotPaginas ?? 1) || 1;
    for (const c of Array.isArray(r.cadastros) ? r.cadastros : []) {
      const s = servicoDoOmie(c);
      if (s.codigo_omie && s.descricao) catalogo.push(s);
    }
    pagina++;
  }
  const truncado = total > MAX_PAGINAS_CATALOGO;
  if (!catalogo.length) {
    return erro(
      { metodo: "ListarCadastroServico", paginas: pagina - 1 },
      `O Omie da ${nomeEmissora(envio)} devolveu o catálogo de serviços vazio: nada mudou no portal.`,
    );
  }
  if (truncado) {
    return erro(
      { metodo: "ListarCadastroServico", paginas: pagina - 1, lidos: catalogo.length },
      `O catálogo da ${nomeEmissora(envio)} passou de ${MAX_PAGINAS_CATALOGO * 50} serviços: nada mudou no portal; avise o time do Brain.`,
    );
  }
  // Leitura não escreve no Omie: o cache do portal é atualizado nos dois modos.
  const aplicado = await ctx.servicosAplicar(emissora, catalogo);
  return fim(ctx, {
    metodo: "ListarCadastroServico",
    paginas: pagina - 1,
    lidos: catalogo.length,
    aplicado,
  });
}

const OPERACAO: Record<string, (envio: any, ctx: Contexto) => Promise<Resultado>> = {
  garantir_cliente: garantirCliente,
  incluir_os: incluirOS,
  alterar_os: alterarOS,
  faturar_os: faturarOS,
  consultar_status: consultarStatus,
  sincronizar_servicos: sincronizarServicos,
};

/** Modo que vale para o envio: só "gravar" literal grava. Gravar com a emissora já de volta em simulação = conflito. */
export function modoDoEnvio(envio: any): Modo | "conflito" {
  const modo: Modo = envio?.modo === "gravar" ? "gravar" : "simular";
  const atual = envio?.emissora?.modo_omie;
  if (modo === "gravar" && atual != null && atual !== "gravar") return "conflito";
  return modo;
}

/** Processa um envio reservado. Nunca lança: todo desfecho vira um Resultado para fat_envio_resultado. */
export async function processarEnvio(envio: any, ctx: Contexto): Promise<Resultado> {
  const op = OPERACAO[String(envio?.operacao ?? "")];
  const cabeca = {
    versao: VERSAO,
    operacao: envio?.operacao ?? null,
    modo: ctx.modo,
    codigo_integracao: codigoOS(envio) || null,
  };
  let r: Resultado;
  if (!op) {
    r = erro({}, `Operação ${String(envio?.operacao)} não é do conector do Omie.`);
  } else {
    try {
      r = await op(envio, ctx);
    } catch (e) {
      if (e instanceof ErroOmie) r = decidir(e, envio, ctx.agora());
      else if (e instanceof EscritaBloqueada) {
        r = erro(
          { barrado: e.metodo },
          "O conector tentou gravar no Omie com a emissora em simulação e foi barrado: nada foi gravado. Avise o time do Brain.",
        );
      } else {
        r = erro(
          { falha: cortar((e as Error)?.message ?? e, 300) },
          "Falha interna do conector do Omie: nada foi gravado. Avise o time do Brain.",
        );
      }
    }
  }
  // Rede de segurança: em simulação nunca sai "ok" (o banco também recusa).
  if (ctx.modo !== "gravar" && r.status === "ok") r = { ...r, status: "simulado" };
  return {
    ...r,
    resposta: semChave({ ...cabeca, ...(r.resposta ?? {}), chamadas: ctx.omie.chamadas }),
    codigos: semChave(r.codigos ?? {}),
  };
}

// ---------------------------------------------------------------------------------------------------- fila

export type Dependencias = {
  reservar: (limite: number) => Promise<any[]>;
  responder: (envio: string, r: Resultado) => Promise<any>;
  credencial: (emissora: string) => Promise<{ app_key: string; app_secret: string }>;
  statusAplicar: (pedido: string, status: any) => Promise<any>;
  servicosAplicar: (emissora: string, catalogo: any[]) => Promise<any>;
  receitaCnpj?: (cnpj: string) => Promise<any | null>;
  transporte: Transporte;
  dormir: (ms: number) => Promise<void>;
  agora?: () => Date;
  relogio?: () => number;
  orcamentoMs?: number;
  maxEnvios?: number;
  lote?: number;
  pausaMs?: number;
};

/** Erro do banco que diz que a credencial da emissora não serve (cadastro), não que o banco caiu. */
const CREDENCIAL_CADASTRO = new Set(["P0002", "55000", "22023", "22P02", "42501"]);

/**
 * Uma rodada: reserva em lotes pequenos (o que sobra no fim do tempo volta para a fila na hora), processa um envio
 * por vez e para a emissora bloqueada ou sem chave sem parar as outras (CA-12).
 */
export async function rodarFila(d: Dependencias) {
  const relogio = d.relogio ?? (() => Date.now());
  const agora = d.agora ?? (() => new Date(relogio()));
  const inicio = relogio();
  const orcamento = d.orcamentoMs ?? ORCAMENTO_MS;
  const max = d.maxEnvios ?? MAX_POR_RODADA;
  const lote = d.lote ?? LOTE;
  const emissoras = new Map<
    string,
    {
      ritmo: Ritmo;
      cred?: { app_key: string; app_secret: string };
      bloqueada_ate?: string;
      indisponivel?: string;
      sem_banco?: string;
    }
  >();
  const departamentos = new Map();
  const resumo = {
    versao: VERSAO,
    reservados: 0,
    por_status: {} as Record<string, number>,
    envios: [] as Array<Record<string, any>>,
    emissoras_paradas: [] as Array<Record<string, any>>,
    erros_banco: [] as Array<Record<string, any>>,
  };
  const estado = (id: string) => {
    let e = emissoras.get(id);
    if (!e) {
      e = { ritmo: { ultima: 0 } };
      emissoras.set(id, e);
    }
    return e;
  };

  while (resumo.reservados < max && relogio() - inicio < orcamento) {
    const lista = await d.reservar(Math.min(lote, max - resumo.reservados));
    if (!Array.isArray(lista) || !lista.length) break;
    resumo.reservados += lista.length;
    for (const envio of lista) {
      const t0 = relogio();
      const id = emissoraId(envio);
      const est = estado(id);
      let r: Resultado;
      if (relogio() - inicio >= orcamento) {
        r = {
          status: "pendente",
          resposta: { liberado: "fim do tempo da rodada" },
          erro_legivel: null,
          codigos: { tentar_em: agora().toISOString() },
        };
      } else if (est.bloqueada_ate) {
        r = {
          status: "pendente",
          resposta: { liberado: "emissora bloqueada pelo Omie nesta rodada" },
          erro_legivel: `O Omie da ${nomeEmissora(envio)} bloqueou a chave por excesso de chamadas; o envio volta sozinho.`,
          codigos: { tentar_em: est.bloqueada_ate },
        };
      } else if (est.indisponivel) {
        r = {
          status: "erro",
          resposta: { liberado: "emissora indisponível nesta rodada" },
          erro_legivel: est.indisponivel,
          codigos: { emissora_indisponivel: true },
        };
      } else if (est.sem_banco) {
        r = {
          status: "pendente",
          resposta: { liberado: "credencial não lida nesta rodada" },
          erro_legivel: est.sem_banco,
          codigos: {},
        };
      } else {
        const modo = modoDoEnvio(envio);
        if (modo === "conflito") {
          r = {
            status: "erro",
            resposta: {
              versao: VERSAO,
              operacao: envio?.operacao ?? null,
              modo: "gravar",
              conflito: true,
            },
            erro_legivel:
              `A ${nomeEmissora(envio)} voltou para simulação depois que o pedido entrou na fila: nada foi gravado no Omie. ` +
              "Reenvie para simular de novo.",
            codigos: {},
          };
        } else {
          if (!est.cred) {
            try {
              est.cred = await d.credencial(id);
              if (!est.cred?.app_key || !est.cred?.app_secret)
                throw Object.assign(new Error("credencial vazia"), { code: "22023" });
            } catch (e) {
              est.cred = undefined;
              const code = String((e as any)?.code ?? "");
              if (CREDENCIAL_CADASTRO.has(code)) {
                est.indisponivel =
                  `A chave do Omie da ${nomeEmissora(envio)} não está no cofre do Brain (ou está incompleta): ` +
                  "peça à controladoria para cadastrá-la. Depois é só reenviar.";
              } else {
                est.sem_banco = `Não consegui ler a chave do Omie da ${nomeEmissora(envio)} agora; o envio volta para a fila sozinho.`;
              }
            }
          }
          if (!est.cred) {
            r = est.indisponivel
              ? {
                  status: "erro",
                  resposta: { credencial: "indisponível" },
                  erro_legivel: est.indisponivel,
                  codigos: { emissora_indisponivel: true },
                }
              : {
                  status: "pendente",
                  resposta: { credencial: "não lida" },
                  erro_legivel: est.sem_banco ?? null,
                  codigos: {},
                };
          } else {
            const omie = criarOmie({
              transporte: d.transporte,
              credencial: est.cred,
              modo,
              dormir: d.dormir,
              relogio,
              ritmo: est.ritmo,
              pausaMs: d.pausaMs,
            });
            r = await processarEnvio(envio, {
              omie,
              modo,
              agora,
              dormir: d.dormir,
              departamentos,
              statusAplicar: d.statusAplicar,
              servicosAplicar: d.servicosAplicar,
              receitaCnpj: d.receitaCnpj,
            });
          }
        }
      }
      if (r.codigos?.bloquear_emissora_ate && !est.bloqueada_ate) {
        est.bloqueada_ate = r.codigos.bloquear_emissora_ate;
        resumo.emissoras_paradas.push({
          emissora: nomeEmissora(envio),
          motivo: "bloqueio",
          ate: est.bloqueada_ate,
        });
      }
      if (r.codigos?.emissora_indisponivel && !est.indisponivel) {
        est.indisponivel = r.erro_legivel ?? "Chave do Omie indisponível.";
        resumo.emissoras_paradas.push({ emissora: nomeEmissora(envio), motivo: "indisponivel" });
      }
      try {
        await d.responder(String(envio?.id), r);
      } catch (e) {
        // O envio fica em processamento e o banco o devolve à fila em 15 minutos (API §2.2).
        resumo.erros_banco.push({
          envio: envio?.id ?? null,
          erro: cortar((e as Error)?.message ?? e, 300),
        });
      }
      resumo.por_status[r.status] = (resumo.por_status[r.status] ?? 0) + 1;
      resumo.envios.push({
        id: envio?.id ?? null,
        operacao: envio?.operacao ?? null,
        emissora: texto(envio?.emissora?.apelido) || null,
        modo: envio?.modo ?? null,
        status: r.status,
        ms: relogio() - t0,
      });
    }
  }
  return resumo;
}

// ---------------------------------------------------------------------------------------------------- acesso

/** Comparação de tempo constante (segredo de cron e chave de serviço). */
export function iguais(a: string, b: string) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** Só a chave de serviço (Authorization: Bearer) ou o cabeçalho do cron com o segredo do Vault. */
export function autorizado(
  cabecalhos: { get(nome: string): string | null },
  servico: string | undefined,
  cron: string | null | undefined,
) {
  const auth = cabecalhos.get("authorization") ?? "";
  if (servico && iguais(auth, `Bearer ${servico}`)) return true;
  const c = cabecalhos.get("x-faturamento-cron") ?? "";
  return !!cron && cron.length >= 24 && iguais(c, cron);
}
