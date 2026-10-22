/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Envio dos negócios da Cella para o Pipedrive da Diehl & Cella (funil 9 "Projeto Planning"). Pedido do Pedro em
// 20/10/2026; arquitetura https://claude.ai/artifact/DUNzvMEu4c6DSkewjbsmBs; de/para devolvido pela Maiara em 22/10
// (monetizacao/outputs/2026-10-20-cella-integracao/contrato-v2.md). Decisões de 22/10: 1A 2A 3B 4A 5A 6A.
//
// Regras que não se negociam:
// - A Cella nunca fica sabendo que existe outro produto no negócio. Nada de Consultoria, Finance, rota ou valor sai
//   daqui, e o motivo de perda é sempre de uma lista neutra (motivoNeutro), nunca o texto do card.
// - Negócio fechado do lado deles (ganho ou perdido) não é reaberto nem mexido.
// - Negócio que já existia no funil deles antes da integração ("existente") só recebe etapa, status e motivo.
//
// Quem entra (pipe 39, clientes da base): Cella em "Caixa · Produtos ofertados", da Reunião de proposta em diante.
// Quem entra (pipe 40, clientes novos): o produto "Diagnóstico · Teses Jurídicas" no card, da Apresentação agendada
// em diante (a Jordana já escolheu levar a tese). Perdido nunca entra na primeira vez.
// Ganho para a Cella (pipe 39): card ganho com a Cella em "Caixa · Produtos contratados". Ganho sem esse campo fica
// pendente; ganho só com outro produto vira "perdeu" para a Cella.

export const PLANNING = {
  /** Etapas do pipe 39 que a Cella vê, e o que cada uma vira no funil dela. */
  etapas39: { 291: 35, 279: 36, 278: 36, 288: 37 } as Record<number, number>,
  /** Etapas do pipe 40 (06 Apresentação agendada, 07 Apresentado, 08 Negociação). */
  etapas40: { 299: 35, 300: 36, 301: 36 } as Record<number, number>,
  reuniao39: 291,
  reuniao40: 299,
  produtoTeses: 63,
  campo: {
    contratados: "35e4390b926cf597266c53e0a7cc55b0ddc9091d",
    regime: "093e25bbb3aff5d379b996da8fcec39667c6ae4e",
    faixa: "b92a608454a6648327f24c5cc3bf87a95bb7fbcd",
    cnpjOrg: "ca6f964bd78a8f54fceaab3a1138cccea668ac7f",
    cargo: "c7494bbad30183509c108339ca088c9db53948bd",
  },
  contratadoCella: 1204,
  regime: { 352: "lucro_real", 351: "lucro_presumido", 350: "simples", 681: "simples" } as Record<
    number,
    Regime
  >,
};

export const CELLA = {
  funil: 9,
  dona: 23868473,
  etapaReuniao: 35,
  campo: {
    cnpj: "f80e891e676e151cec4819362d7240ab181fa403",
    faturamento: "ef064ffb2f049a81611abecc3425b8869ce54510",
    regime: "d27cc322ff472bd5369e47fef74fab7ab1858380",
  },
  regime: { lucro_real: 29, lucro_presumido: 30, simples: 31 } as Record<Regime, number>,
  /** "Reunião (Parceiros)" no Pipedrive deles é a Tarefa padrão renomeada: a chave continua "task". */
  tipoReuniao: "task",
};

export type Regime = "lucro_real" | "lucro_presumido" | "simples";
export type Evento = "entrou" | "atualizou" | "ganhou" | "perdeu";

/** O card da Planning, lido do espelho do Brain (ops.monetizacao_deals e ops.monetizacao_diagnostico_deals). */
export type Fonte = {
  pipe: 39 | 40;
  deal_id: number;
  nome: string;
  status: "open" | "won" | "lost";
  stage_id: number;
  /** pipe 39: Cella ofertada; pipe 40: produto Teses Jurídicas no card. */
  cella: boolean;
  lost_reason: string | null;
  /** Dia em que entrou na etapa da reunião (291 ou 299), se entrou. */
  reuniao: string | null;
  org_id: number | null;
};

export type Estado = {
  deal_id: number;
  pipe: number;
  vinculo: "criado" | "existente" | null;
  estado: "ativo" | "encerrado" | "parado_deles" | "pendente";
  cella_deal_id: number | null;
  cella_org_id?: number | null;
  cella_person_id?: number | null;
  cella_activity_id?: number | null;
  status_deles?: string | null;
  hash: string | null;
  ultimo_evento: string | null;
  simulado_hash?: string | null;
};

export type Decisao =
  | { tipo: "nada" }
  | { tipo: "pendente"; motivo: string }
  | {
      tipo: "enviar";
      evento: Evento;
      status: Fonte["status"];
      stage_id: number | null;
      lost_reason: string | null;
      encerra: boolean;
    };

const NEUTRO_PADRAO = "Cliente não seguiu com a proposta";

/** Motivo de perda que pode sair: nunca o texto do card, que às vezes cita outro produto da Planning. */
export function motivoNeutro(lostReason: string | null | undefined): string {
  const t = String(lostReason ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/contato|retorno|respond|no.?show|sumiu|esgotad|nao atend/.test(t))
    return "Sem retorno do cliente";
  if (/fit|perfil|escopo|sem oportunidade|nao (tem|ha) credito|sem credito|tese/.test(t))
    return "Sem oportunidade identificada";
  return NEUTRO_PADRAO;
}

const etapaCella = (f: Fonte): number | null =>
  (f.pipe === 39 ? PLANNING.etapas39 : PLANNING.etapas40)[f.stage_id] ?? null;

/**
 * O que fazer com um card. `contratados` só é lido no pipe 39, para card ganho com a Cella: null quando o campo está
 * vazio, senão a lista de opções marcadas.
 */
export function decidir(
  f: Fonte,
  e: Estado | null | undefined,
  contratados?: number[] | null,
): Decisao {
  if (e && (e.estado === "encerrado" || e.estado === "parado_deles")) return { tipo: "nada" };
  const conhecido = !!e && e.estado === "ativo" && !!e.cella_deal_id;
  const etapa = etapaCella(f);
  const sai = (lost_reason: string, status: Fonte["status"] = "lost"): Decisao =>
    conhecido
      ? { tipo: "enviar", evento: "perdeu", status, stage_id: null, lost_reason, encerra: true }
      : { tipo: "nada" };

  if (!f.cella) {
    // A Cella saiu do card (ou o produto Teses saiu na venda parcial): para ela, o negócio acabou.
    if (f.status === "lost") return sai(motivoNeutro(f.lost_reason));
    return sai(NEUTRO_PADRAO);
  }
  if (f.status === "lost") return sai(motivoNeutro(f.lost_reason));
  if (f.status === "won") {
    if (f.pipe === 39) {
      if (!contratados || contratados.length === 0)
        return { tipo: "pendente", motivo: 'Ganho sem "Caixa · Produtos contratados"' };
      if (!contratados.includes(PLANNING.contratadoCella)) return sai(NEUTRO_PADRAO);
    }
    return {
      tipo: "enviar",
      evento: "ganhou",
      status: "won",
      stage_id: etapa,
      lost_reason: null,
      encerra: true,
    };
  }
  if (etapa == null) {
    // Aberto antes da reunião de proposta: ainda não é da Cella. Se já foi (voltou de etapa), mantém onde está.
    return conhecido
      ? {
          tipo: "enviar",
          evento: "atualizou",
          status: "open",
          stage_id: null,
          lost_reason: null,
          encerra: false,
        }
      : { tipo: "nada" };
  }
  return {
    tipo: "enviar",
    evento: conhecido ? "atualizou" : "entrou",
    status: "open",
    stage_id: etapa,
    lost_reason: null,
    encerra: false,
  };
}

/** O que muda no negócio deles: só etapa, status e motivo. É isso que o hash compara. */
export function patchNegocio(d: Extract<Decisao, { tipo: "enviar" }>): Record<string, unknown> {
  const p: Record<string, unknown> = { status: d.status };
  if (d.stage_id != null) p.stage_id = d.stage_id;
  if (d.status === "lost") p.lost_reason = d.lost_reason ?? NEUTRO_PADRAO;
  return p;
}

/** FNV-1a de 32 bits sobre o JSON com chaves ordenadas: igual no Deno e no Node, sem crypto assíncrono. */
export function hashDe(v: unknown): string {
  const ordenar = (x: any): any =>
    Array.isArray(x)
      ? x.map(ordenar)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, ordenar(x[k])]),
          )
        : x;
  const s = JSON.stringify(ordenar(v));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------- dados do negócio novo

const UF: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export function ufDe(estado: unknown): string | null {
  const t = String(estado ?? "").trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return UF[semAcento(t.replace(/^(state of|estado d[eo])\s+/i, ""))] ?? null;
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const texto = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const primeiro = (lista: unknown): string | null => {
  if (!Array.isArray(lista)) return texto(lista);
  const p = lista.find((x: any) => x?.primary) ?? lista[0];
  return texto(p?.value ?? p);
};

export type Detalhe = {
  empresa: {
    nome: string;
    cnpj: string | null;
    cidade: string | null;
    uf: string | null;
    regime: Regime | null;
    faixa: string | null;
  };
  contato: {
    nome: string;
    cargo: string | null;
    email: string | null;
    telefone: string | null;
  } | null;
};

/** Monta empresa e contato a partir do negócio, da organização e da pessoa do Pipedrive da Planning (API v1). */
export function detalheDe(
  deal: any,
  org: any,
  pessoa: any,
  rotuloFaixa: (id: number) => string | null,
): Detalhe {
  const cnpj = soDigitos(org?.[PLANNING.campo.cnpjOrg]);
  const regimeId = Number(deal?.[PLANNING.campo.regime]);
  const faixaId = Number(deal?.[PLANNING.campo.faixa]);
  const faixa = faixaId ? rotuloFaixa(faixaId) : null;
  return {
    empresa: {
      nome: String(org?.name ?? deal?.org_name ?? deal?.title ?? "").trim(),
      cnpj:
        cnpj.length === 14
          ? cnpj
          : cnpj.length > 0 && cnpj.length < 14
            ? cnpj.padStart(14, "0")
            : null,
      cidade: texto(org?.address_locality),
      uf: ufDe(org?.address_admin_area_level_1),
      regime: PLANNING.regime[regimeId] ?? null,
      faixa: faixa && !/sem movimenta/i.test(faixa) ? faixa.replace(/^\[ANTIGO\]\s*/i, "") : null,
    },
    contato: pessoa?.name
      ? {
          nome: String(pessoa.name).trim(),
          cargo: texto(pessoa[PLANNING.campo.cargo]),
          email: primeiro(pessoa.email),
          telefone: soDigitos(primeiro(pessoa.phone)) || null,
        }
      : null,
  };
}

/** Corpo da organização no Pipedrive deles. Campo vazio não vai, para não apagar o que eles já têm. */
export function corpoOrganizacao(det: Detalhe): Record<string, unknown> {
  const e = det.empresa;
  const c: Record<string, unknown> = { name: e.nome, owner_id: CELLA.dona };
  const endereco = [e.cidade, e.uf].filter(Boolean).join(" - ");
  if (endereco) c.address = endereco;
  if (e.cnpj) c[CELLA.campo.cnpj] = e.cnpj;
  if (e.faixa) c[CELLA.campo.faturamento] = e.faixa;
  if (e.regime) c[CELLA.campo.regime] = String(CELLA.regime[e.regime]);
  return c;
}

export function corpoPessoa(det: Detalhe, orgId: number | null): Record<string, unknown> | null {
  const p = det.contato;
  if (!p) return null;
  const c: Record<string, unknown> = { name: p.nome, owner_id: CELLA.dona };
  if (orgId) c.org_id = orgId;
  if (p.cargo) c.job_title = p.cargo;
  if (p.email) c.email = [{ value: p.email, primary: true, label: "work" }];
  if (p.telefone) c.phone = [{ value: p.telefone, primary: true, label: "work" }];
  return c;
}

export function corpoNegocio(
  f: Fonte,
  det: Detalhe,
  d: Extract<Decisao, { tipo: "enviar" }>,
  ids: { org_id: number | null; person_id: number | null },
): Record<string, unknown> {
  const c: Record<string, unknown> = {
    title: det.empresa.nome || f.nome,
    pipeline_id: CELLA.funil,
    stage_id: d.stage_id ?? CELLA.etapaReuniao,
    user_id: CELLA.dona,
    origin_id: String(f.deal_id),
    ...patchNegocio(d),
  };
  if (ids.org_id) c.org_id = ids.org_id;
  if (ids.person_id) c.person_id = ids.person_id;
  return c;
}

/** A reunião vira atividade "Reunião (Parceiros)"; feita quando o card já passou da etapa da reunião. */
export function corpoReuniao(
  f: Fonte,
  d: Extract<Decisao, { tipo: "enviar" }>,
  ids: { deal_id: number; org_id: number | null; person_id: number | null },
  hoje: string,
): Record<string, unknown> {
  const c: Record<string, unknown> = {
    subject: "Reunião de proposta",
    type: CELLA.tipoReuniao,
    due_date: f.reuniao ?? hoje,
    deal_id: ids.deal_id,
    user_id: CELLA.dona,
    done: d.status !== "open" || (d.stage_id != null && d.stage_id !== CELLA.etapaReuniao) ? 1 : 0,
  };
  if (ids.org_id) c.org_id = ids.org_id;
  if (ids.person_id) c.person_id = ids.person_id;
  return c;
}

// ---------------------------------------------------------------------------- rodada

export type Planning = {
  /** "Caixa · Produtos contratados" do card (pipe 39), lido na hora porque não está no espelho. */
  contratados: (dealId: number) => Promise<number[] | null>;
  /** Negócio, organização e pessoa, só quando é preciso criar o negócio do lado deles. */
  detalhe: (dealId: number) => Promise<Detalhe>;
};

export type Cella = {
  negocio: (id: number) => Promise<{ status: string; stage_id: number } | null>;
  atualizarNegocio: (id: number, patch: Record<string, unknown>) => Promise<void>;
  acharOrganizacao: (cnpj: string | null, nome: string) => Promise<number | null>;
  criarOrganizacao: (corpo: Record<string, unknown>) => Promise<number>;
  acharPessoa: (email: string | null) => Promise<number | null>;
  criarPessoa: (corpo: Record<string, unknown>) => Promise<number>;
  criarNegocio: (corpo: Record<string, unknown>) => Promise<number>;
  criarAtividade: (corpo: Record<string, unknown>) => Promise<number>;
};

export type Store = {
  salvar: (e: Estado & Record<string, unknown>) => Promise<void>;
  log: (l: Record<string, unknown>) => Promise<void>;
};

export type Resumo = {
  ativo: boolean;
  lidos: number;
  com_cella: number;
  enviados: Record<Evento, number>;
  simulados: Record<Evento, number>;
  criados: number;
  pendentes: number[];
  parados_deles: number[];
  erros: { deal_id: number; erro: string }[];
};

const zeroEventos = (): Record<Evento, number> => ({
  entrou: 0,
  atualizou: 0,
  ganhou: 0,
  perdeu: 0,
});

export async function rodarCella(o: {
  fontes: Fonte[];
  estados: Map<number, Estado>;
  planning: Planning;
  cella: Cella;
  store: Store;
  ativo: boolean;
  agora: Date;
}): Promise<Resumo> {
  const r: Resumo = {
    ativo: o.ativo,
    lidos: o.fontes.length,
    com_cella: o.fontes.filter((f) => f.cella).length,
    enviados: zeroEventos(),
    simulados: zeroEventos(),
    criados: 0,
    pendentes: [],
    parados_deles: [],
    erros: [],
  };
  const hoje = o.agora.toISOString().slice(0, 10);
  const agoraIso = o.agora.toISOString();

  for (const f of o.fontes) {
    const e = o.estados.get(f.deal_id) ?? null;
    try {
      const precisaContratados =
        f.pipe === 39 &&
        f.cella &&
        f.status === "won" &&
        e?.estado !== "encerrado" &&
        e?.estado !== "parado_deles";
      const contratados = precisaContratados ? await o.planning.contratados(f.deal_id) : null;
      const d = decidir(f, e, contratados);
      if (d.tipo === "nada") continue;

      if (d.tipo === "pendente") {
        r.pendentes.push(f.deal_id);
        if (e?.estado !== "pendente" && !e?.cella_deal_id)
          await o.store.salvar({
            ...(e ?? novoEstado(f)),
            estado: "pendente",
            erro: d.motivo,
            atualizado_em: agoraIso,
          });
        continue;
      }

      const patch = patchNegocio(d);
      const criar = !e?.cella_deal_id;
      const hash = hashDe({ evento: d.evento === "entrou" ? "atualizou" : d.evento, patch });
      if (!criar && e!.hash === hash) continue;

      if (!o.ativo) {
        if (e?.simulado_hash === hash) continue;
        r.simulados[d.evento]++;
        const envio = criar ? { detalhe: await o.planning.detalhe(f.deal_id), patch } : { patch };
        await o.store.log({
          deal_id: f.deal_id,
          evento: d.evento,
          acao: criar ? "criar" : "atualizar",
          simulado: true,
          envio,
        });
        await o.store.salvar({
          ...(e ?? novoEstado(f)),
          simulado_hash: hash,
          simulado: { evento: d.evento, acao: criar ? "criar" : "atualizar", envio, em: agoraIso },
          atualizado_em: agoraIso,
        });
        continue;
      }

      if (criar) {
        const det = await o.planning.detalhe(f.deal_id);
        const orgId =
          (await o.cella.acharOrganizacao(det.empresa.cnpj, det.empresa.nome)) ??
          (await o.cella.criarOrganizacao(corpoOrganizacao(det)));
        const corpoP = corpoPessoa(det, orgId);
        const personId = corpoP
          ? ((await o.cella.acharPessoa(det.contato?.email ?? null)) ??
            (await o.cella.criarPessoa(corpoP)))
          : null;
        const dealId = await o.cella.criarNegocio(
          corpoNegocio(f, det, d, { org_id: orgId, person_id: personId }),
        );
        const atividade = await o.cella
          .criarAtividade(
            corpoReuniao(f, d, { deal_id: dealId, org_id: orgId, person_id: personId }, hoje),
          )
          .catch(() => null);
        r.criados++;
        r.enviados[d.evento]++;
        await o.store.log({
          deal_id: f.deal_id,
          evento: d.evento,
          acao: "criar",
          simulado: false,
          envio: { detalhe: det, patch },
          resposta: { deal: dealId, org: orgId, person: personId, activity: atividade },
        });
        await o.store.salvar({
          ...(e ?? novoEstado(f)),
          vinculo: "criado",
          estado: d.encerra ? "encerrado" : "ativo",
          cella_deal_id: dealId,
          cella_org_id: orgId,
          cella_person_id: personId,
          cella_activity_id: atividade,
          status_deles: d.status,
          hash,
          ultimo_evento: d.evento,
          enviado_em: agoraIso,
          erro: null,
          atualizado_em: agoraIso,
        });
        continue;
      }

      // Negócio que já existe do lado deles: confere antes se eles não fecharam.
      const deles = await o.cella.negocio(e!.cella_deal_id!);
      if (!deles || deles.status !== "open") {
        r.parados_deles.push(f.deal_id);
        await o.store.salvar({
          ...e!,
          estado: "parado_deles",
          status_deles: deles?.status ?? "excluido",
          atualizado_em: agoraIso,
        });
        continue;
      }
      // Já está igual do lado deles: só guarda o hash, sem mexer no negócio deles.
      const igual =
        deles.status === patch.status &&
        (patch.stage_id == null || deles.stage_id === patch.stage_id);
      if (!igual) {
        await o.cella.atualizarNegocio(e!.cella_deal_id!, patch);
        r.enviados[d.evento]++;
        await o.store.log({
          deal_id: f.deal_id,
          evento: d.evento,
          acao: "atualizar",
          simulado: false,
          envio: { patch },
        });
      }
      await o.store.salvar({
        ...e!,
        estado: d.encerra ? "encerrado" : "ativo",
        status_deles: d.status,
        hash,
        ultimo_evento: d.evento,
        enviado_em: agoraIso,
        erro: null,
        atualizado_em: agoraIso,
      });
    } catch (err) {
      const erro = String((err as Error).message ?? err).slice(0, 300);
      r.erros.push({ deal_id: f.deal_id, erro });
      await o.store
        .salvar({ ...(e ?? novoEstado(f)), erro, atualizado_em: agoraIso })
        .catch(() => {});
    }
  }
  return r;
}

const novoEstado = (f: Fonte): Estado => ({
  deal_id: f.deal_id,
  pipe: f.pipe,
  vinculo: null,
  estado: "ativo",
  cella_deal_id: null,
  hash: null,
  ultimo_evento: null,
});

// ---------------------------------------------------------------------------- leitura do espelho

/** Card do pipe 39 a partir de ops.monetizacao_deals.payload. */
export function fonte39(p: any): Fonte {
  const reuniao = (Array.isArray(p?.moves) ? p.moves : []).find(
    (m: any) => Number(m?.stage_id) === PLANNING.reuniao39,
  );
  return {
    pipe: 39,
    deal_id: Number(p.id),
    nome: String(p.org ?? p.title ?? "").trim(),
    status: p.status,
    stage_id: Number(p.stage_id),
    cella: Array.isArray(p.offered) && p.offered.includes("cella"),
    lost_reason: p.lost_reason ?? null,
    reuniao: reuniao ? String(reuniao.date ?? reuniao.at ?? "").slice(0, 10) || null : null,
    org_id: Number(p.org_id) || null,
  };
}

/** Card do pipe 40 a partir de ops.monetizacao_diagnostico_deals.payload. */
export function fonte40(p: any): Fonte {
  const reuniao = (Array.isArray(p?.moves) ? p.moves : []).find(
    (m: any) => Number(m?.stage_id) === PLANNING.reuniao40,
  );
  return {
    pipe: 40,
    deal_id: Number(p.id),
    nome: String(p.org ?? p.title ?? "").trim(),
    status: p.status,
    stage_id: Number(p.stage_id),
    cella: (Array.isArray(p.produtos) ? p.produtos : []).some(
      (x: any) => Number(x?.product_id) === PLANNING.produtoTeses,
    ),
    lost_reason: p.lost_reason ?? null,
    reuniao: reuniao ? String(reuniao.at ?? "").slice(0, 10) || null : null,
    org_id: Number(p.org_id) || null,
  };
}
