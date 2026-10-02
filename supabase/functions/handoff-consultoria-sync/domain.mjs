// Regras puras da handoff-consultoria-sync. Sem rede e sem Deno: os testes rodam no Node
// (tests/monetizacao-handoff-consultoria.test.mjs) e o ensaio local usa o mesmo código.
//
// Formatos de entrada copiados do que o Pipefy, o Pipedrive e o Financial Brain devolveram em
// 02/10/2026 (medição em monetizacao/medicoes/2026-10-02-handoff-consultoria/).

export const PIPE_ONBOARDING = "307173656";

// Campos do card de onboarding (pipe 307173656).
export const F = {
  unidade: "unidade_1",
  venda: "data_da_venda",
  kickoff: "data_da_reuni_o",
  encaminhado: "regime_tribut_rio_consultoria_tribut_ria",
  contratos: "card_s_de_contrato",
  empresas: "conecte_esse_card_na_data_base_empresas",
  faturamento: "faturamento",
};
// Campos do card de contrato (pipe 307285170) e do registro da Data Base de empresas.
export const F_CONTRATO = {
  cnpj: ["cnpj_principal_1", "cnpj_faturamento"],
  negocio: ["deal_id_1", "id_neg_cio_pipedrive"],
};
export const F_REGISTRO_NEGOCIO = "id_pipedrive_deal";
// Campos do Pipedrive (chaves de campo personalizado, conferidas em 02/10).
export const PD = {
  cnpjNegocio: "f37f5a5c865fe4f49f16233ed97a989cab34dc7d",
  faixaNegocio: "b92a608454a6648327f24c5cc3bf87a95bb7fbcd",
  cnpjOrganizacao: "ca6f964bd78a8f54fceaab3a1138cccea668ac7f",
};

/** Só dígitos; CNPJ que o Pipedrive guarda como número perde zeros à esquerda e volta com 14. */
export function cnpjOuNulo(v) {
  if (v === null || v === undefined || v === "") return null;
  let d = typeof v === "number" ? Math.round(v).toString() : String(v).replace(/\D/g, "");
  if (d.length === 12 || d.length === 13) d = d.padStart(14, "0");
  return d.length === 14 || d.length === 11 ? d : null;
}

/** "dd/mm/aaaa" (formato do Pipefy) → "aaaa-mm-dd". */
export function dataBR(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? "").trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

const semAcento = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// "Planning <Cidade>" do formulário → nome em ops.unidades. Os apelidos são os do pipe.
const APELIDOS = {
  sudeste: "rio de janeiro",
  "campo novo do parecis": "campo novo",
  "sao bernardo do campo": "sao bernardo",
};
/** Devolve { unidade, unidade_id } pelo cadastro de unidades; sem casamento, o texto limpo e id nulo. */
export function unidadeCanonica(raw, unidades) {
  const base = String(raw ?? "")
    .trim()
    .replace(/^planning\s+/i, "")
    .trim();
  if (!base) return { unidade: null, unidade_id: null };
  const chave = APELIDOS[semAcento(base)] ?? semAcento(base);
  const u = unidades.find((x) => semAcento(x.nome_da_praca) === chave);
  return u ? { unidade: u.nome_da_praca, unidade_id: u.id } : { unidade: base, unidade_id: null };
}

/** Linha do card sem a chave: o que o próprio card diz. */
export function linhaDoCard(card, unidades, agora) {
  const campos = new Map((card.fields ?? []).map((f) => [f.field.id, f]));
  const valor = (id) => {
    const v = campos.get(id)?.value;
    return v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim();
  };
  const ids = (id) => (campos.get(id)?.array_value ?? []).map(String).filter(Boolean).sort();
  const enc = valor(F.encaminhado);
  return {
    pipefy_card_id: String(card.id),
    titulo: String(card.title ?? "").trim() || `Card ${card.id}`,
    ...unidadeCanonica(valor(F.unidade), unidades),
    fase_atual: card.current_phase?.name ?? null,
    criado_em: card.created_at ?? null,
    venda_em: dataBR(valor(F.venda)),
    kickoff_em: dataBR(valor(F.kickoff)),
    encaminhado: enc === "Sim" || enc === "Não" ? enc : null,
    contrato_card_ids: ids(F.contratos),
    empresa_record_ids: ids(F.empresas),
    faturamento_card: valor(F.faturamento),
    sincronizado_em: agora,
    ausente_desde: null,
  };
}

/** Os conectores mudaram desde a última resolução? Então a chave precisa ser refeita. */
export function conectoresMudaram(linha, anterior) {
  if (!anterior) return true;
  const igual = (a, b) => (a ?? []).join(",") === (b ?? []).join(",");
  return (
    !igual(linha.contrato_card_ids, anterior.contrato_card_ids) ||
    !igual(linha.empresa_record_ids, anterior.empresa_record_ids)
  );
}

/**
 * Resolve o CNPJ e o negócio do Pipedrive na ordem de confiança. `fontes` traz o que já foi lido:
 *   contratos: Map(card de contrato → { cnpj, pipedrive_deal_id, empresa_id }) de ops.contratos_documentos
 *   contratoPorNegocio: Map(negócio → cnpj) de ops.contratos
 *   registros: Map(registro da Data Base → { cnpj, empresa_id }) de ops.empresas.pipefy_record_id
 *   empresas: Map(empresa_id → cnpj) de ops.empresas
 *   pipefyContrato: Map(card de contrato → { cnpj, negocio }) lido do Pipefy (só quando o banco não basta)
 *   pipefyRegistro: Map(registro → negocio) lido do Pipefy
 *   negocios: Map(negócio → { cnpj, org_cnpj, faixa_id }) lido do Pipedrive
 */
export function resolverChave(linha, fontes) {
  const ctr = linha.contrato_card_ids.map((id) => fontes.contratos.get(id)).filter(Boolean);
  const reg = linha.empresa_record_ids.map((id) => fontes.registros.get(id)).filter(Boolean);
  const pfc = linha.contrato_card_ids.map((id) => fontes.pipefyContrato?.get(id)).filter(Boolean);
  const pfr = linha.empresa_record_ids.map((id) => fontes.pipefyRegistro?.get(id)).filter(Boolean);
  const negocio =
    ctr.map((c) => c.pipedrive_deal_id).find(Boolean) ??
    pfc.map((c) => c.negocio).find(Boolean) ??
    pfr.find(Boolean) ??
    null;
  const neg = negocio ? fontes.negocios?.get(String(negocio)) : null;
  const tentativas = [
    ["contrato", ctr.map((c) => c.cnpj)],
    [
      "contrato_negocio",
      ctr.map((c) => fontes.contratoPorNegocio.get(String(c.pipedrive_deal_id))),
    ],
    ["empresa", reg.map((r) => r.cnpj)],
    ["empresa_id", [...ctr, ...reg].map((x) => fontes.empresas.get(String(x.empresa_id)))],
    ["contrato_pipefy", pfc.map((c) => c.cnpj)],
    ["negocio_pipedrive", [neg?.cnpj]],
    ["organizacao_pipedrive", [neg?.org_cnpj]],
  ];
  for (const [fonte, valores] of tentativas) {
    const cnpj = valores.map(cnpjOuNulo).find(Boolean);
    if (cnpj)
      return { cnpj, cnpj_fonte: fonte, pipedrive_deal_id: negocio ? String(negocio) : null };
  }
  return { cnpj: null, cnpj_fonte: null, pipedrive_deal_id: negocio ? String(negocio) : null };
}

/**
 * Faixa declarada: a opção do campo "Faturamento anual" do negócio; sem ela, o mesmo rótulo
 * escrito no campo "Faturamento" do card de onboarding. `opcoes` = options do dealField, na ordem.
 */
export function faixaDeclarada(faixaId, faturamentoCard, opcoes) {
  const porId = opcoes.findIndex((o) => String(o.id) === String(faixaId ?? ""));
  if (porId >= 0)
    return {
      faixa: opcoes[porId].label,
      faixa_id: Number(opcoes[porId].id),
      faixa_ordem: porId,
      faixa_fonte: "pipedrive_negocio",
    };
  const txt = semAcento(faturamentoCard);
  const porRotulo = txt ? opcoes.findIndex((o) => semAcento(o.label) === txt) : -1;
  if (porRotulo >= 0)
    return {
      faixa: opcoes[porRotulo].label,
      faixa_id: Number(opcoes[porRotulo].id),
      faixa_ordem: porRotulo,
      faixa_fonte: "onboarding",
    };
  return { faixa: null, faixa_id: null, faixa_ordem: null, faixa_fonte: null };
}

/** Nome do cliente no Omie, só letras e dígitos, sem acento, maiúsculo. */
export function nomeNormal(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Nome do Omie → CNPJs do cadastro (omie_contraparte da PAT). Um nome pode valer mais de um CNPJ. */
export function mapaDeContrapartes(contrapartes) {
  const mapa = new Map();
  for (const c of contrapartes) {
    const doc = cnpjOuNulo(c.doc_digitos ?? c.cnpj_cpf);
    if (!doc) continue;
    for (const n of [c.nome_norm, c.fantasia_norm, c.razao_social, c.nome_fantasia]) {
      const k = nomeNormal(n);
      if (!k) continue;
      if (!mapa.has(k)) mapa.set(k, new Set());
      mapa.get(k).add(doc);
    }
  }
  return mapa;
}

/**
 * Linhas de ops.handoff_consultoria_pat a partir das três leituras do Financial Brain:
 *   faturado: `linhas` de fn_faturamento_mensal (todas as categorias), por competência
 *   creditos: `linhas` da mesma função filtrada na categoria de créditos tributários
 *   recebidos: [{ cliente, data_caixa, titulo_valor_pago }] de v_lancamentos, títulos recebidos
 * Nome sem CNPJ no cadastro fica fora e é contado em `sem_cnpj`.
 */
export function linhasPat({ faturado, creditos, recebidos, contrapartes, agora }) {
  const mapa = mapaDeContrapartes(contrapartes);
  const acc = new Map();
  const semCnpj = new Set();
  const somar = (nome, mes, campo, v) => {
    const docs = mapa.get(nomeNormal(nome));
    if (!docs?.size) {
      semCnpj.add(nome);
      return;
    }
    for (const cnpj of docs) {
      const k = `${cnpj}|${mes}`;
      const l = acc.get(k) ?? {
        cnpj,
        mes,
        nomes: new Set(),
        faturado: 0,
        creditos: 0,
        recebido: 0,
      };
      l.nomes.add(nome);
      l[campo] += Number(v) || 0;
      acc.set(k, l);
    }
  };
  for (const [campo, linhas] of [
    ["faturado", faturado],
    ["creditos", creditos],
  ])
    for (const l of linhas ?? [])
      for (const m of l.meses ?? [])
        if (m.receita !== null && m.receita !== undefined)
          somar(l.cliente, m.competencia.slice(0, 7) + "-01", campo, m.receita);
  for (const r of recebidos ?? [])
    if (r.data_caixa)
      somar(r.cliente, r.data_caixa.slice(0, 7) + "-01", "recebido", r.titulo_valor_pago);
  const linhas = [...acc.values()].map((l) => ({
    cnpj: l.cnpj,
    mes: l.mes,
    cliente_omie: [...l.nomes].sort().join(" · "),
    faturado: Math.round(l.faturado * 100) / 100,
    creditos: Math.round(l.creditos * 100) / 100,
    recebido: Math.round(l.recebido * 100) / 100,
    sincronizado_em: agora,
  }));
  return { linhas, sem_cnpj: [...semCnpj].sort() };
}

/** Categoria de créditos tributários como o de/para a escreve (hoje "Creditos triburários"). */
export function categoriaDeCreditos(categorias) {
  return (
    (categorias?.itens ?? [])
      .map((i) => i.categoria)
      .find((c) => /cr[eé]ditos?\s+tri/i.test(c ?? "")) ?? null
  );
}

/** Leitura vazia ou que perde mais da metade não marca ninguém como ausente. */
export function podeMarcarAusentes(lidos, presentes) {
  if (!lidos) return { pode: false, motivo: "leitura vazia" };
  if (presentes && lidos < presentes / 2)
    return { pode: false, motivo: `leu ${lidos} de ${presentes}` };
  return { pode: true, motivo: null };
}
