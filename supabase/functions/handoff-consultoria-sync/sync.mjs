// Orquestração da handoff-consultoria-sync, com a rede injetada (`io`): a Edge Function liga ao
// Deno e o ensaio local (scripts/monetizacao/handoff-consultoria-ensaio.mjs) liga ao Node, sem
// gravar. Toda leitura externa é só leitura: nenhuma mutation no Pipefy, nenhum PUT no Pipedrive.
//
// io = {
//   pipefy(query, variables) → { data, errors }        GraphQL do Pipefy
//   ops(caminho, init?) → JSON                          PostgREST do banco único, schema ops
//   pipedrive(caminho) → JSON                           GET na API v1 do Pipedrive
//   fin(caminho, init?) → JSON                          PostgREST do Financial Brain, schema public
// }
// Passos: 1. onboarding (Pipefy + conectores + Pipedrive); 2. CNPJ dos negócios ganhos em 2026 que o banco não
// resolve (Pipedrive); 3. PAT no Financial Brain.
import {
  categoriaDeCreditos,
  conectoresMudaram,
  F_CONTRATO,
  F_REGISTRO_NEGOCIO,
  faixaDeclarada,
  linhaDoCard,
  linhaNegocio,
  linhasPat,
  negociosSemCnpj,
  PD,
  PIPE_ONBOARDING,
  podeMarcarAusentes,
  resolverChave,
} from "./domain.mjs";

const UM_DIA = 24 * 3600 * 1000;
const LOTE_IN = 150;
const CARDS_QUERY = `query($pipeId: ID!, $after: String) {
  allCards(pipeId: $pipeId, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { id title created_at current_phase { name } fields { field { id } value array_value } } }
  }
}`;

const lotes = (xs, n) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const lista = (xs) => xs.map((x) => `"${String(x).replace(/"/g, "")}"`).join(",");

async function emParalelo(itens, n, fn) {
  const saida = [];
  for (const lote of lotes(itens, n)) saida.push(...(await Promise.all(lote.map(fn))));
  return saida;
}

async function todosOsCards(io) {
  const cards = [];
  let after = null;
  for (let pagina = 0; pagina < 100; pagina++) {
    const r = await io.pipefy(CARDS_QUERY, { pipeId: PIPE_ONBOARDING, after });
    if (r.errors?.length) throw new Error(`Pipefy: ${r.errors[0].message}`);
    const c = r.data.allCards;
    cards.push(...c.edges.map((e) => e.node));
    if (!c.pageInfo.hasNextPage) return cards;
    after = c.pageInfo.endCursor;
  }
  throw new Error("Pipefy: mais de 100 páginas no pipe de onboarding; leitura interrompida.");
}

/** Leitura paginada do PostgREST (corta em 1.000 linhas). `caminho` já traz o `order`. */
async function paginas(ler, caminho) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const parte = await ler(`${caminho}&offset=${de}&limit=1000`);
    linhas.push(...(parte ?? []));
    if (!parte || parte.length < 1000) return linhas;
    if (de > 50_000) throw new Error(`leitura de ${caminho.split("?")[0]} passou de 50 mil linhas`);
  }
}

async function porLotes(io, tabela, coluna, valores, select) {
  const out = [];
  for (const l of lotes([...new Set(valores.filter(Boolean).map(String))], LOTE_IN))
    out.push(...((await io.ops(`${tabela}?select=${select}&${coluna}=in.(${lista(l)})`)) ?? []));
  return out;
}

/** Campos de vários cards ou registros do Pipefy numa consulta só (apelidos), 20 por vez. */
async function camposPipefy(io, ids, tipo) {
  const mapa = new Map();
  for (const l of lotes(ids, 20)) {
    const corpo = l
      .map((id, i) =>
        tipo === "card"
          ? `c${i}: card(id: "${id}") { id fields { field { id } value } }`
          : `c${i}: table_record(id: "${id}") { id record_fields { field { id } value } }`,
      )
      .join("\n");
    const r = await io.pipefy(`{ ${corpo} }`);
    // Card apagado devolve erro só no apelido dele; o resto vem.
    for (const v of Object.values(r.data ?? {})) {
      if (!v) continue;
      const fs = v.fields ?? v.record_fields ?? [];
      mapa.set(String(v.id), new Map(fs.map((f) => [f.field.id, f.value])));
    }
  }
  return mapa;
}

export async function sincronizar(
  io,
  {
    agora = new Date().toISOString(),
    trigger = "manual",
    gravar = true,
    limiteRemoto = 300,
    limiteNegocios = 150,
  } = {},
) {
  const resumo = { trigger };
  // ── 1. Onboarding ──────────────────────────────────────────────────────────────────────────────
  const [unidades, cards, anterioresLista] = await Promise.all([
    io.ops("unidades?select=id,nome_da_praca&order=id"),
    todosOsCards(io),
    io.ops(
      "handoff_consultoria_onboarding?select=pipefy_card_id,cnpj,cnpj_fonte,pipedrive_deal_id,faixa,faixa_id,faixa_ordem,faixa_fonte,chave_tentada_em,contrato_card_ids,empresa_record_ids&order=pipefy_card_id",
    ),
  ]);
  const anteriores = new Map((anterioresLista ?? []).map((a) => [a.pipefy_card_id, a]));
  const linhas = cards.map((c) => linhaDoCard(c, unidades ?? [], agora));

  // Fontes do banco (baratas): contrato, empresa da Data Base, negócio.
  const ctrIds = linhas.flatMap((l) => l.contrato_card_ids);
  const regIds = linhas.flatMap((l) => l.empresa_record_ids);
  const [docs, regs] = await Promise.all([
    porLotes(
      io,
      "contratos_documentos",
      "pipefy_card_id",
      ctrIds,
      "pipefy_card_id,cnpj,pipedrive_deal_id,empresa_id",
    ),
    porLotes(io, "empresas", "pipefy_record_id", regIds, "pipefy_record_id,id,cnpj"),
  ]);
  const contratos = new Map(docs.map((d) => [String(d.pipefy_card_id), d]));
  const registros = new Map(
    regs.map((r) => [String(r.pipefy_record_id), { cnpj: r.cnpj, empresa_id: r.id }]),
  );
  const negociosDoc = docs.map((d) => d.pipedrive_deal_id).filter(Boolean);
  const empIds = [...docs.map((d) => d.empresa_id), ...regs.map((r) => r.id)].filter(Boolean);
  const [ctrNeg, emps] = await Promise.all([
    porLotes(io, "contratos", "pipedrive_deal_id", negociosDoc, "pipedrive_deal_id,cnpj"),
    porLotes(io, "empresas", "id", empIds, "id,cnpj"),
  ]);
  const fontes = {
    contratos,
    registros,
    contratoPorNegocio: new Map(
      ctrNeg.filter((c) => c.cnpj).map((c) => [String(c.pipedrive_deal_id), c.cnpj]),
    ),
    empresas: new Map(emps.filter((e) => e.cnpj).map((e) => [String(e.id), e.cnpj])),
    pipefyContrato: new Map(),
    pipefyRegistro: new Map(),
    negocios: new Map(),
  };

  // Quem precisa de leitura fora do banco: sem CNPJ ou sem faixa, e não tentado nas últimas 24 h
  // (ou com conectores novos). O resto reaproveita a resolução anterior.
  const resolvidas = linhas.map((l) => ({
    l,
    r: resolverChave(l, fontes),
    a: anteriores.get(l.pipefy_card_id),
  }));
  const tentarFora = resolvidas
    .filter(({ l, r, a }) => {
      const reaproveita = a && !conectoresMudaram(l, a);
      const falta = !(r.cnpj || (reaproveita && a.cnpj)) || !(reaproveita && a.faixa);
      const recente =
        reaproveita &&
        a.chave_tentada_em &&
        Date.parse(agora) - Date.parse(a.chave_tentada_em) < UM_DIA;
      return falta && !recente;
    })
    .slice(0, limiteRemoto);
  resumo.tentados_fora = tentarFora.length;

  if (tentarFora.length) {
    // Card de contrato no Pipefy quando o banco não deu CNPJ nem negócio; registro quando falta negócio.
    const ctrFora = tentarFora.flatMap(({ l, r }) =>
      r.cnpj && r.pipedrive_deal_id
        ? []
        : l.contrato_card_ids.filter(
            (id) => !contratos.get(id)?.cnpj || !contratos.get(id)?.pipedrive_deal_id,
          ),
    );
    const regFora = tentarFora.flatMap(({ l, r }) =>
      r.pipedrive_deal_id ? [] : l.empresa_record_ids,
    );
    const [cf, rf] = await Promise.all([
      camposPipefy(io, [...new Set(ctrFora)], "card"),
      camposPipefy(io, [...new Set(regFora)], "registro"),
    ]);
    for (const [id, campos] of cf)
      fontes.pipefyContrato.set(id, {
        cnpj: F_CONTRATO.cnpj.map((k) => campos.get(k)).find(Boolean) ?? null,
        negocio: F_CONTRATO.negocio.map((k) => campos.get(k)).find(Boolean) ?? null,
      });
    for (const [id, campos] of rf)
      if (campos.get(F_REGISTRO_NEGOCIO))
        fontes.pipefyRegistro.set(id, campos.get(F_REGISTRO_NEGOCIO));
    // Negócio no Pipedrive: CNPJ do negócio, organização e faixa declarada.
    const negs = [
      ...new Set(
        tentarFora.map(({ l }) => resolverChave(l, fontes).pipedrive_deal_id).filter(Boolean),
      ),
    ];
    await emParalelo(negs, 4, async (id) => {
      const d = (await io.pipedrive(`deals/${id}`))?.data;
      if (!d) return;
      const orgId = typeof d.org_id === "object" && d.org_id ? d.org_id.value : d.org_id;
      fontes.negocios.set(String(id), {
        cnpj: d[PD.cnpjNegocio] ?? null,
        org_id: orgId ?? null,
        org_cnpj: null,
        faixa_id: d[PD.faixaNegocio] ?? null,
      });
    });
    const semCnpj = [...fontes.negocios.values()].filter((n) => !n.cnpj && n.org_id);
    await emParalelo(semCnpj, 4, async (n) => {
      const o = (await io.pipedrive(`organizations/${n.org_id}`))?.data;
      if (o) n.org_cnpj = o[PD.cnpjOrganizacao] ?? null;
    });
    resumo.lidos_fora = {
      contratos_pipefy: cf.size,
      registros_pipefy: rf.size,
      negocios_pipedrive: fontes.negocios.size,
    };
  }

  const opcoesFaixa =
    (await io.pipedrive("dealFields?limit=500"))?.data?.find((f) => f.key === PD.faixaNegocio)
      ?.options ?? [];
  const tentadas = new Set(tentarFora.map(({ l }) => l.pipefy_card_id));
  const finais = linhas.map((l) => {
    const a = anteriores.get(l.pipefy_card_id);
    const reaproveita = a && !conectoresMudaram(l, a);
    const r = resolverChave(l, fontes);
    const chave = r.cnpj
      ? r
      : reaproveita && a.cnpj
        ? {
            cnpj: a.cnpj,
            cnpj_fonte: a.cnpj_fonte,
            pipedrive_deal_id: a.pipedrive_deal_id ?? r.pipedrive_deal_id,
          }
        : r;
    const neg = chave.pipedrive_deal_id
      ? fontes.negocios.get(String(chave.pipedrive_deal_id))
      : null;
    // Negócio relido nesta rodada manda; sem releitura, vale a faixa anterior; o texto do card é o último recurso.
    const faixa = neg
      ? faixaDeclarada(neg.faixa_id, l.faturamento_card, opcoesFaixa)
      : reaproveita && a.faixa
        ? {
            faixa: a.faixa,
            faixa_id: a.faixa_id,
            faixa_ordem: a.faixa_ordem,
            faixa_fonte: a.faixa_fonte,
          }
        : faixaDeclarada(null, l.faturamento_card, opcoesFaixa);
    const { faturamento_card: _, ...resto } = l;
    return {
      ...resto,
      ...chave,
      ...faixa,
      chave_tentada_em: tentadas.has(l.pipefy_card_id)
        ? agora
        : reaproveita
          ? a.chave_tentada_em
          : null,
    };
  });
  const porFonte = {};
  for (const f of finais)
    if (f.cnpj_fonte) porFonte[f.cnpj_fonte] = (porFonte[f.cnpj_fonte] ?? 0) + 1;
  Object.assign(resumo, {
    cards: finais.length,
    com_cnpj: finais.filter((f) => f.cnpj).length,
    com_faixa: finais.filter((f) => f.faixa).length,
    encaminhados: finais.filter((f) => f.encaminhado === "Sim").length,
    cnpj_por_fonte: porFonte,
  });

  if (gravar) {
    for (const l of lotes(finais, 200))
      await io.ops("handoff_consultoria_onboarding?on_conflict=pipefy_card_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(l),
      });
    const decisao = podeMarcarAusentes(finais.length, anteriores.size);
    if (decisao.pode) {
      const marcados = await io.ops(
        `handoff_consultoria_onboarding?ausente_desde=is.null&sincronizado_em=lt.${encodeURIComponent(agora)}&select=pipefy_card_id`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ausente_desde: agora }),
        },
      );
      resumo.ausentes_marcados = marcados?.length ?? 0;
    } else resumo.ausencia_recusada = decisao.motivo;
  }

  // ── 2. Negócios ganhos em 2026 sem CNPJ no banco: lê o Pipedrive (tela Cruzamento Consultoria) ──
  // O RPC ops.cruzamento_consultoria_painel() resolve o CNPJ pelo banco; esta tabela cobre só o resto.
  try {
    const ganhos = await paginas(
      io.ops,
      "contratos?select=pipedrive_deal_id,cnpj,empresa_id&ganho_em=gte.2026-01-01&pipedrive_deal_id=not.is.null&order=id",
    );
    const deals = [...new Set(ganhos.map((g) => String(g.pipedrive_deal_id)))];
    const docsN = await porLotes(
      io,
      "contratos_documentos",
      "pipedrive_deal_id",
      deals,
      "pipedrive_deal_id,cnpj,empresa_id",
    );
    const empsN = await porLotes(
      io,
      "empresas",
      "id",
      [...ganhos.map((g) => g.empresa_id), ...docsN.map((d) => d.empresa_id)],
      "id,cnpj",
    );
    const anterioresN = await io.ops(
      "handoff_consultoria_negocios?select=pipedrive_deal_id,cnpj,tentado_em&order=pipedrive_deal_id",
    );
    const faltam = negociosSemCnpj({
      ganhos,
      docs: docsN,
      empresas: empsN,
      onboarding: finais,
      anteriores: anterioresN,
      agora,
    });
    const lerAgora = faltam.slice(0, limiteNegocios);
    const lidas = await emParalelo(lerAgora, 4, async (deal) => {
      const d = (await io.pipedrive(`deals/${deal}`))?.data ?? null;
      const orgId = typeof d?.org_id === "object" && d?.org_id ? d.org_id.value : d?.org_id;
      const o =
        orgId && !d?.[PD.cnpjNegocio]
          ? ((await io.pipedrive(`organizations/${orgId}`))?.data ?? null)
          : null;
      return linhaNegocio(deal, d, o, agora);
    });
    resumo.negocios = {
      ganhos_2026: deals.length,
      sem_cnpj_no_banco: faltam.length,
      lidos_no_pipedrive: lidas.length,
      resolvidos_agora: lidas.filter((l) => l.cnpj).length,
    };
    if (gravar && lidas.length)
      await io.ops("handoff_consultoria_negocios?on_conflict=pipedrive_deal_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(lidas),
      });
  } catch (e) {
    resumo.erro_negocios = String(e?.message ?? e).slice(0, 300);
  }

  // ── 3. PAT no Financial Brain ──────────────────────────────────────────────────────────────────
  let pat = { linhas: [], sem_cnpj: [] };
  try {
    const hoje = agora.slice(0, 10);
    const fimDoMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    const empresas = await io.fin("empresas?select=id&grupo_apuracao=eq.PAT");
    const ids = (empresas ?? []).map((e) => e.id);
    if (!ids.length) throw new Error("grupo PAT sem empresas no Financial Brain");
    const rpc = (args) =>
      io.fin("rpc/fn_faturamento_mensal", {
        method: "POST",
        body: JSON.stringify({
          p_grupos: ["PAT"],
          p_comp_de: "2025-01-01",
          p_comp_ate: fimDoMes,
          ...args,
        }),
      });
    const fat = await rpc({});
    const categoria = categoriaDeCreditos(fat?.categorias);
    const [cred, contrapartes, recebidos, frescor] = await Promise.all([
      categoria ? rpc({ p_categorias: [categoria] }) : Promise.resolve({ linhas: [] }),
      paginas(
        io.fin,
        `omie_contraparte?select=empresa_id,codigo,razao_social,nome_fantasia,nome_norm,fantasia_norm,doc_digitos,cnpj_cpf&empresa_id=in.(${lista(ids)})&order=empresa_id,codigo`,
      ),
      paginas(
        io.fin,
        `v_lancamentos?select=id,cliente,data_caixa,titulo_valor_pago&empresa_id=in.(${lista(ids)})&estrutura_dre=like.1.1*&titulo_status=eq.RECEBIDO&data_caixa=gte.2025-01-01&order=id`,
      ),
      io.fin(
        "sync_log?select=finalizado_em&fonte=like.lancamentos_shadow:*&status=eq.sucesso&order=finalizado_em.desc&limit=1",
      ),
    ]);
    pat = linhasPat({
      faturado: fat?.linhas,
      creditos: cred?.linhas,
      recebidos,
      contrapartes,
      agora,
    });
    resumo.pat = {
      linhas: pat.linhas.length,
      cnpjs: new Set(pat.linhas.map((l) => l.cnpj)).size,
      nomes_sem_cnpj: pat.sem_cnpj.length,
      categoria_creditos: categoria,
    };
    resumo.financeiro_carregado_em = frescor?.[0]?.finalizado_em ?? null;
    if (gravar && pat.linhas.length) {
      for (const l of lotes(pat.linhas, 500))
        await io.ops("handoff_consultoria_pat?on_conflict=cnpj,mes", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(l),
        });
      await io.ops(`handoff_consultoria_pat?sincronizado_em=lt.${encodeURIComponent(agora)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    }
  } catch (e) {
    // O Financeiro fora não apaga o que já estava espelhado: a tela mostra a última leitura.
    resumo.erro_pat = String(e?.message ?? e).slice(0, 300);
  }
  resumo.status = resumo.erro_pat || resumo.erro_negocios ? "parcial" : "sucesso";
  return { resumo, onboarding: finais, pat: pat.linhas };
}
