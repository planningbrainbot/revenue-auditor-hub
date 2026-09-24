// Fonte SINTÉTICA do preview do Cockpit do CEO.
//
// Serve para ver a tela e exercitar as regras sem tocar o banco único: nenhum número daqui descreve
// a Planning. Os nomes se identificam ("Empresa Sintética 001", "Unidade Exemplo Norte"), nenhum
// link aponta para o CRM real, e as quantidades não copiam fotografias dos documentos.
//
// Determinística: mesmo `hoje`, mesma base. As datas andam com `hoje`, então não existe mês fixo.
import type {
  BaseMonetizacao,
  Conta,
  Metrica,
  Movimento,
  Negocio,
  Plano,
  Produto,
  Receita,
} from "../monetizacao/types";
import type { FonteCockpit } from "./indicadores.ts";
import { extrairFaturamento, montarLeituraGrupo, montarLeituraRede } from "./receita-fontes.ts";
import type { ApuracaoRede } from "./receita-fontes.ts";
import type { LeituraReceita } from "./receita.ts";
import { montarDefinicao } from "./clientes-ativos.ts";
import { montarCoortes } from "./coortes.ts";
import {
  extrairEmitidoRecebido,
  extrairIndicadores,
  extrairInadimplencia,
  extrairPorCliente,
  montarPonte,
} from "./financeiro.ts";
import { montarAquisicao } from "./aquisicao.ts";
import { lerCard, montarOnboarding } from "./operacao.ts";
import { montarCadeia } from "./cadeia.ts";

const UNIDADES = [
  ["ex-norte", "Unidade Exemplo Norte"],
  ["ex-sul", "Unidade Exemplo Sul"],
  ["ex-leste", "Unidade Exemplo Leste"],
  ["ex-oeste", "Unidade Exemplo Oeste"],
] as const;

function gerador(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const somaDias = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const tres = (n: number) => String(n).padStart(3, "0");
const mov = (date: string, actor: number): Movimento => ({
  at: date + "T13:00:00Z",
  date,
  actor_id: actor,
  source: "sintético",
});
const brl = (amount: number | null) => ({
  amount,
  currency: amount === null ? null : "BRL",
  invalid: false,
});
function receita(total: number | null): Receita {
  if (total === null)
    return {
      total: brl(null),
      partners: brl(null),
      unit: brl(null),
      sum: null,
      difference: null,
      status: "missing",
      basis: "sintético",
      unit_name: null,
    };
  const partners = Math.round(total * 0.3);
  return {
    total: brl(total),
    partners: brl(partners),
    unit: brl(total - partners),
    sum: total,
    difference: 0,
    status: "ok",
    basis: "sintético",
    unit_name: null,
  };
}

function conta(i: number): Conta {
  const [key, nome] = UNIDADES[i % UNIDADES.length];
  const perfil = i % 9;
  const retroativa = perfil <= 2;
  const c: Conta = {
    key: "sint-" + tres(i),
    name: "Empresa Sintética " + tres(i),
    units: [key],
    unit_label: nome,
    orgs: [5000 + i],
    contact: i % 3 !== 0,
    band: null,
    regime: "Lucro Presumido",
    segment: ["Indústria", "Serviços", "Comércio", "Agronegócio"][i % 4],
    old_base: retroativa,
    matrix: false,
    new_commercial: false,
    pipedrive_contract: false,
    consultoria_priority: retroativa,
    finance_candidate: false,
    finance: { status: "revisar", reason: "" },
    ecd: false,
    base_origin: retroativa
      ? {
          status: "antiga",
          reason: "Origem sintética: base antiga da unidade.",
          source: "Fonte sintética",
          commercial: false,
        }
      : {
          status: "nova",
          reason: "Origem sintética: base nova.",
          source: "Fonte sintética",
          commercial: false,
        },
  };
  if (retroativa) {
    c.band = "R$ 4,8 milhões até R$ 10 milhões";
    c.regime = i % 2 ? "Lucro Real" : "Lucro Presumido";
    c.consultoria_origin = {
      status: "retroativa",
      reason: "Origem sintética: base antiga, sem fechamento comercial.",
      checked_at: "",
      ops_ids: [],
      pipefy_ids: [],
      commercial_deal_ids: [],
      non_simples_confirmed: true,
      regime_source: "Fonte sintética",
    };
    if (perfil === 2) {
      // Também tem contrato ganho e faixa abaixo de R$ 25 mi: apta a Finance, sobreposição.
      c.pipedrive_contract = true;
      c.band = "R$ 10 milhões até R$ 25 milhões";
    }
    if (i % 18 === 0) {
      c.situacao_receita = "baixada";
      c.situacao_receita_fonte = "Fonte sintética";
    }
  } else if (perfil === 3 || perfil === 4) {
    c.pipedrive_contract = true;
    c.band = perfil === 3 ? "R$ 2 milhões até R$ 4,8 milhões" : "R$ 10 milhões até R$ 25 milhões";
  } else if (perfil === 5) {
    c.band = "R$ 50 milhões até R$ 78 milhões";
    c.regime = "Lucro Real";
    c.ecd = true;
  } else if (perfil === 6) {
    // Aprovada pela régua de Cella, mas só existe no ERP: pode ser fornecedor.
    c.band = "Entre R$ 78 milhões e R$ 300 milhões";
    c.regime = "Lucro Real";
  } else if (perfil === 7) {
    c.regime = "Simples Nacional";
    c.band = "Até R$ 500 mil";
  } else {
    c.pipedrive_contract = true;
    c.regime = null;
    c.band = "R$ 2 milhões até R$ 4,8 milhões";
  }
  return c;
}

const rotaDoPerfil = (perfil: number): Produto =>
  perfil <= 2 ? "consultoria" : perfil === 5 || perfil === 6 ? "cella" : "finance";
const vazio = (): Record<Metrica, Movimento[]> => ({
  loaded: [],
  started: [],
  scheduled: [],
  meeting: [],
  validated: [],
  signed: [],
});

function negocio(
  id: number,
  hoje: string,
  opcoes: {
    orgId: number | null;
    org: string | null;
    route: Produto | "sem_produto";
    criado: string;
    passos: Partial<Record<Metrica, string>>;
    status: "open" | "won" | "lost";
    valor: number | null;
  },
): Negocio {
  const events = vazio();
  const actor = id % 2 ? 101 : 102;
  for (const [m, d] of Object.entries(opcoes.passos) as [Metrica, string][])
    if (d <= hoje) events[m].push(mov(d, actor));
  const ganho = opcoes.status === "won" ? (opcoes.passos.signed ?? null) : null;
  return {
    id,
    title: "Negócio sintético " + tres(id),
    org: opcoes.org,
    org_id: opcoes.orgId,
    owner: actor === 101 ? "Pessoa Sintética A" : "Pessoa Sintética B",
    owner_id: actor,
    route: opcoes.route,
    status: opcoes.status,
    stage_id: opcoes.passos.validated ? 4 : opcoes.passos.started ? 2 : 1,
    stage: opcoes.passos.validated ? "Negociação" : opcoes.passos.started ? "Em contato" : "Fila",
    order: opcoes.passos.validated ? 4 : opcoes.passos.started ? 2 : 1,
    events,
    created_at: opcoes.criado,
    started_at: opcoes.passos.started ?? null,
    validated_at: opcoes.passos.validated ?? null,
    signed_on: ganho,
    won_on: ganho,
    expected_close: opcoes.status === "open" && opcoes.passos.validated ? somaDias(hoje, 20) : null,
    revenue: receita(opcoes.passos.validated ? opcoes.valor : null),
    next_activity: null,
    history_known: true,
    url: "#sintetico",
    updated_at: opcoes.criado + "T13:00:00Z",
    last_activity_date: null,
    lost_reason: opcoes.status === "lost" ? "Motivo sintético" : null,
  };
}

export function baseSintetica(hoje: string, medidoEm = hoje + "T11:00:00.000Z"): BaseMonetizacao {
  const r = gerador(20260922);
  const accounts = Array.from({ length: 72 }, (_, k) => conta(k + 1));
  const cards: Negocio[] = [];
  for (let j = 1; j <= 70; j++) {
    const idx = ((j * 7) % 72) + 1;
    const semConta = j > 62;
    const acc = accounts[idx - 1];
    const route = j % 10 === 0 ? "sem_produto" : rotaDoPerfil(idx % 9);
    const criado = somaDias(hoje, -(5 + Math.floor(r() * 110)));
    const passos: Partial<Record<Metrica, string>> = { loaded: criado };
    let status: "open" | "won" | "lost" = "open";
    if (r() < 0.8) {
      passos.started = somaDias(criado, 1 + Math.floor(r() * 4));
      if (r() < 0.6) {
        passos.scheduled = somaDias(passos.started, 2 + Math.floor(r() * 5));
        if (r() < 0.8) {
          passos.meeting = somaDias(passos.scheduled, 3 + Math.floor(r() * 3));
          if (r() < 0.6) {
            passos.validated = somaDias(passos.meeting, 1 + Math.floor(r() * 5));
            const desfecho = r();
            if (desfecho < 0.4) {
              passos.signed = somaDias(passos.validated, 5 + Math.floor(r() * 16));
              status = passos.signed <= hoje ? "won" : "open";
              if (status === "open") delete passos.signed;
            } else if (desfecho < 0.6) status = "lost";
          }
        }
      }
    }
    for (const m of Object.keys(passos) as Metrica[]) if (passos[m]! > hoje) delete passos[m];
    const valor = r() < 0.7 ? 12_000 * (1 + Math.floor(r() * 15)) : null;
    cards.push(
      negocio(j, hoje, {
        orgId: semConta ? 9000 + j : 5000 + idx,
        org: semConta ? null : acc.name,
        route,
        criado,
        passos,
        status,
        valor,
      }),
    );
  }
  // Casos fixos, para a tela sempre ter o que mostrar no mês corrente, qualquer que seja o dia.
  const fixo = (
    id: number,
    idx: number,
    route: Produto,
    passos: Partial<Record<Metrica, string>>,
    status: "open" | "won",
    valor: number | null,
  ) =>
    cards.push(
      negocio(id, hoje, {
        orgId: 5000 + idx,
        org: accounts[idx - 1].name,
        route,
        criado: somaDias(hoje, -40),
        passos,
        status,
        valor,
      }),
    );
  fixo(
    901,
    10,
    "consultoria",
    {
      started: somaDias(hoje, -30),
      meeting: somaDias(hoje, -20),
      validated: somaDias(hoje, -15),
      signed: hoje,
    },
    "won",
    96_000,
  );
  fixo(
    902,
    22,
    "finance",
    {
      started: somaDias(hoje, -25),
      meeting: somaDias(hoje, -12),
      validated: somaDias(hoje, -8),
      signed: hoje,
    },
    "won",
    60_000,
  );
  fixo(
    903,
    15,
    "cella",
    { started: somaDias(hoje, -9), meeting: somaDias(hoje, -4), validated: hoje },
    "open",
    null,
  );
  fixo(
    904,
    31,
    "finance",
    { started: somaDias(hoje, -7), meeting: somaDias(hoje, -2), validated: hoje },
    "open",
    84_000,
  );
  fixo(905, 40, "consultoria", { started: hoje }, "open", null);

  const mes = hoje.slice(0, 7);
  const mesAnterior = somaDias(mes + "-01", -1).slice(0, 7);
  const plano = (month: string, allocation: Record<Produto, number>): Plano => ({
    month,
    owner_id: 101,
    owner_name: "Pessoa Sintética A",
    capacity: 90,
    meetings_capacity: 40,
    target_contracts: 6,
    daily_target: 4,
    allocation,
    rates: { cella: null, consultoria: null, finance: null },
  });
  return {
    base_count: accounts.length,
    forecasts: [],
    reservations: [],
    accounts,
    units: UNIDADES.map(([key, name], k) => ({
      id: 900 + k,
      key,
      name,
      classification: "unidade",
      account_keys: accounts.filter((a) => a.units.includes(key)).map((a) => a.key),
    })),
    cards,
    lists: [],
    plans: [
      plano(mes, { cella: 0, consultoria: 0, finance: 0 }),
      plano(mesAnterior, { cella: 30, consultoria: 40, finance: 20 }),
    ],
    records: [],
    measured_at: medidoEm,
    catalog_at: medidoEm,
    sync_status: "ok",
    sync_error: null,
    stages: [
      { id: 1, name: "Fila", order: 1 },
      { id: 2, name: "Em contato", order: 2 },
      { id: 4, name: "Negociação", order: 4 },
    ],
    permissions: { view: true, manage: false, send: false, all_units: true },
  };
}

/** Primeiro dia de cada um dos `n` meses que terminam no mês de `hoje`. */
function mesesAte(hoje: string, n: number): string[] {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(ano, mes - (n - 1 - i), 1)).toISOString().slice(0, 10),
  );
}

/**
 * Leituras candidatas de faturamento, SINTÉTICAS, montadas pelos mesmos construtores da carga real.
 * Mostram de propósito um mês marcado parcial pela fonte, uma unidade inaugurada sem apuração e uma
 * unidade sem data de inauguração.
 */
export function receitaSintetica(hoje: string): LeituraReceita[] {
  const meses = mesesAte(hoje, 10);
  const r = gerador(2030);
  const serie = meses.map((competencia, i) => ({
    competencia,
    receita: Math.round((3_000_000 + i * 60_000 + r() * 150_000) * 100) / 100,
    parcial: i === meses.length - 1,
  }));
  const totalCent = serie.reduce((t, x) => t + Math.round(x.receita * 100), 0);
  const antes = mesesAte(meses[0], 2)[0];
  const grupo = montarLeituraGrupo({
    acesso: true,
    faturamento: extrairFaturamento({
      definicao: "Série sintética do preview.",
      escopo: { recortes_excluidos: ["recorte-exemplo"] },
      serie,
      meses: serie.map((x) => ({
        competencia: x.competencia,
        parcial: x.parcial,
        motivo: x.parcial ? "Mês em curso (sintético)." : "Fechamento sintético.",
        sem_cobertura: false,
      })),
      meses_fora_da_cobertura: [antes],
      totais: { receita_total_escopo: totalCent / 100 },
      excluido_pelos_recortes: { receita: 120_000 },
      excluido_do_faturamento: { receita: 0 },
    }),
  });

  const unidades = [
    {
      id: 101,
      nome: "Unidade Exemplo Norte",
      tipo: "regional",
      inauguracao: "2023-01-01",
      base: 450_000,
      desde: 0,
    },
    {
      id: 102,
      nome: "Unidade Exemplo Sul",
      tipo: "regional",
      inauguracao: "2024-03-01",
      base: 380_000,
      desde: 0,
    },
    // Inaugurada no mês 5 e apurada só a partir do 6: o mês 5 fica parcial.
    {
      id: 103,
      nome: "Unidade Exemplo Leste",
      tipo: "regional",
      inauguracao: meses[5],
      base: 120_000,
      desde: 6,
    },
    // Sem data de inauguração no cadastro: conta a partir da primeira apuração.
    {
      id: 104,
      nome: "Unidade Exemplo Oeste",
      tipo: "regional",
      inauguracao: null,
      base: 60_000,
      desde: 8,
    },
  ];
  const apuracoes: ApuracaoRede[] = [];
  meses.forEach((mes, i) => {
    const corrente = i === meses.length - 1;
    for (const u of unidades) {
      if (i < u.desde) continue;
      apuracoes.push({
        unidade_id: u.id,
        mes,
        status: corrente ? "rascunho" : "confirmado",
        receita_base: corrente ? 0 : Math.round(u.base * (1 + i * 0.02 + r() * 0.05)),
        receita_base_antiga: corrente ? 0 : Math.round(u.base * 0.1),
        // Royalties e CSC fictícios: percentual fixo da base e CSC mensal fixo.
        royalties_valor: corrente ? 0 : Math.round(u.base * 0.08 * 100) / 100,
        csc_valor_fixo: corrente ? 0 : 5_000,
        csc_base_antiga_valor: corrente ? 0 : Math.round(u.base * 0.1 * 0.05 * 100) / 100,
      });
    }
  });
  const rede = montarLeituraRede({
    acesso: true,
    unidades: unidades.map(({ id, nome, tipo, inauguracao }) => ({ id, nome, tipo, inauguracao })),
    apuracoes,
  });
  return [grupo, rede].map((l) => ({ ...l, fonte: `SINTÉTICO · ${l.fonte}` }));
}

/**
 * Definições de cliente ativo SINTÉTICAS sobre as contas sintéticas. CNPJ fictício ("99" + número),
 * que não valida dígito verificador; alguns documentos sem conta na Base e alguns CPFs, para a tela
 * mostrar esses casos.
 */
export function clientesSinteticos(contas: Conta[]): NonNullable<FonteCockpit["clientesAtivos"]> {
  const cnpj = (i: number) => "99" + String(i).padStart(12, "0");
  const cnpjsPorConta = Object.fromEntries(contas.map((a, i) => [a.key, [cnpj(i)]]));
  const de = (f: (i: number) => boolean, extras: (string | null)[] = []) => [
    ...contas
      .map((_, i) => i)
      .filter(f)
      .map(cnpj),
    ...extras,
  ];
  const semConta = [cnpj(9001), cnpj(9002), cnpj(9003)];
  return {
    estado: "ok",
    erro: null,
    cnpjsPorConta,
    definicoes: [
      montarDefinicao(
        "contrato_omie",
        de((i) => i % 5 !== 0),
      ),
      montarDefinicao(
        "recebeu_90d",
        de((i) => i % 4 !== 1, [...semConta, "123.456.789-01"]),
      ),
      montarDefinicao(
        "qb_ativos",
        de(() => true, [...semConta, cnpj(9004), null]),
      ),
      montarDefinicao(
        "mrr_positivo",
        de((i) => i % 5 !== 0 && i % 7 !== 3),
      ),
    ].map((d) => ({ ...d, fonte: `SINTÉTICO · ${d.fonte}` })),
  };
}

/**
 * Coortes SINTÉTICAS: contratos ganhos por mês nas unidades de exemplo e churns datados, com um
 * churn sem data e um lote de outra origem, para a tela mostrar esses casos.
 */
export function retencaoSintetica(hoje: string): NonNullable<FonteCockpit["retencao"]> {
  const meses = mesesAte(hoje, 12).map((m) => m.slice(0, 7));
  const r = gerador(90);
  const contratos = meses.flatMap((mes, i) =>
    Array.from({ length: 6 + (i % 4) }, (_, j) => ({
      deal: `sint-${i}-${j}`,
      ganho_em: `${mes}-${String(5 + j).padStart(2, "0")}`,
      unidade: UNIDADES[j % UNIDADES.length][1] as string,
      origem: "inside_sales",
    })),
  );
  contratos.push({
    deal: "sint-lote",
    ganho_em: `${meses[10]}-01`,
    unidade: UNIDADES[0][1],
    origem: "socios",
  });
  const churns = contratos
    .filter((c) => c.origem === "inside_sales" && r() < 0.12)
    .map((c, i) => {
      const saida = new Date(`${c.ganho_em}T12:00:00Z`);
      saida.setUTCDate(saida.getUTCDate() + 30 + Math.floor(r() * 150));
      return { deal: c.deal, data_churn: i === 0 ? null : saida.toISOString().slice(0, 10) };
    });
  const coortes = montarCoortes({
    contratos,
    churns,
    regionais: UNIDADES.map(([, nome]) => nome),
    hoje,
  });
  return {
    estado: "ok",
    erro: null,
    resposta: {
      estado: "ok",
      coortes: { ...coortes, avisos: ["Coortes SINTÉTICAS do preview.", ...coortes.avisos] },
      lidoEm: `${hoje}T11:00:00.000Z`,
    },
  };
}

export function fonteSintetica(hoje: string, agora: string): FonteCockpit {
  // Carga "de dez minutos atrás" em relação a quem abre o preview, para não parecer parada.
  const dados = baseSintetica(hoje, new Date(Date.parse(agora) - 10 * 60_000).toISOString());
  const leituras = receitaSintetica(hoje);
  const empresa = empresaSintetica(hoje, agora, leituras);
  return {
    sintetico: true,
    hoje,
    agora,
    acessoBase: true,
    acessoNegocios: true,
    monetizacao: { estado: "ok", erro: null, dados },
    receita: {
      estado: "ok",
      erro: null,
      leituras,
      ponte: empresa.ponte,
      frescorFinanceiro: empresa.frescorFinanceiro,
    },
    caixa: empresa.caixa,
    aquisicao: empresa.aquisicao,
    operacao: empresa.operacao,
    clientesAtivos: clientesSinteticos(dados.accounts),
    retencao: retencaoSintetica(hoje),
  };
}

// ── Empresa inteira (23/09): ponte, caixa, aquisição e operação, SINTÉTICAS ──────
// Montadas a partir de payloads crus sintéticos pelos MESMOS extratores e montadores da carga real,
// para o preview exercitar o código de produção. Nomes de cliente são "Cliente Sintético NNN" e
// nunca chegam à tela (a ponte agrega no montador).

/** Payload no formato de `fn_faturamento_mensal` sem limite, fechando com a série do grupo. */
function faturamentoPorClienteSintetico(serie: { mes: string; valor: number }[]) {
  const r = gerador(4242);
  const n = 60;
  const clientes = Array.from({ length: n }, (_, i) => ({
    nome: `Cliente Sintético ${tres(i)}`,
    base: 20_000 + r() * 60_000,
    entra: i < 40 ? 0 : Math.floor(r() * serie.length),
    sai: i % 9 === 4 ? Math.floor(serie.length / 2 + r() * (serie.length / 2)) : serie.length,
  }));
  const linhas = clientes.map((c) => ({
    cliente: c.nome,
    meses: [] as { competencia: string; receita: number | null }[],
  }));
  const serieOut = serie.map((s, m) => {
    let soma = 0;
    clientes.forEach((c, i) => {
      if (i === 0) return;
      const ativo = m >= c.entra && m < c.sai && !(i % 11 === 3 && m % 4 === 2);
      const v = ativo ? Math.round(c.base * (1 + (r() - 0.45) * 0.3) * 100) / 100 : null;
      linhas[i].meses.push({ competencia: `${s.mes}-01`, receita: v });
      if (v !== null) soma += Math.round(v * 100);
    });
    // O maior cliente absorve o resíduo: as linhas fecham com a série do grupo, em centavos.
    const resto = (Math.round(s.valor * 100) - soma) / 100;
    linhas[0].meses.push({ competencia: `${s.mes}-01`, receita: resto });
    return { competencia: `${s.mes}-01`, receita: s.valor, receita_com_cliente: s.valor };
  });
  return { linhas, serie: serieOut, sem_cliente: { por_mes: [] }, truncado: { aplicado: false } };
}

export function empresaSintetica(
  hoje: string,
  agora: string,
  receita: LeituraReceita[],
): Pick<FonteCockpit, "caixa" | "aquisicao" | "operacao"> & {
  ponte: ReturnType<typeof montarPonte>;
  frescorFinanceiro: { carregadoEm: string; cobreAte: string };
} {
  const grupo = receita.find((l) => l.id === "grupo");
  const serie = (grupo?.linhas ?? []).map((l) => ({ mes: l.mes, valor: l.valor }));
  const parciais = new Set(grupo?.parciaisFonte ?? []);
  const mesHoje = hoje.slice(0, 7);
  const fechados = serie.map((s) => s.mes).filter((m) => m < mesHoje && !parciais.has(m));
  const ponte = montarPonte(extrairPorCliente(faturamentoPorClienteSintetico(serie)), fechados);
  // Três dias sem carga: o preview mostra de propósito a ameaça de fonte parada.
  const carregadoEm = new Date(Date.parse(agora) - 3 * 86_400_000).toISOString();
  const ultimoFechado = fechados.at(-1) ?? mesHoje;
  const lidoEm = new Date(Date.parse(agora) - 5 * 60_000).toISOString();

  const r = gerador(99);
  const mesesCx = fechados.slice(-8);
  const caixa: NonNullable<FonteCockpit["caixa"]> = {
    estado: "ok",
    erro: null,
    resposta: {
      lidoEm,
      janela: { de: `${ultimoFechado.slice(0, 4)}-01`, ate: ultimoFechado },
      emitidoRecebido: {
        estado: "ok",
        dado: extrairEmitidoRecebido({
          definicao: "Série sintética do preview.",
          snapshot_ref: `${mesesCx.at(-3) ?? ultimoFechado}-01`,
          serie: mesesCx.map((m, i) => {
            const emitido = serie.find((s) => s.mes === m)?.valor ?? 0;
            const distancia = mesesCx.length - 3 - i;
            const aberto = distancia < -1 ? 0 : emitido * (0.02 + (distancia <= 1 ? 0.1 : 0));
            return {
              competencia: `${m}-01`,
              reconhecido: emitido,
              em_aberto: aberto,
              recebido: emitido - aberto,
              pct_recebido: emitido ? (emitido - aberto) / emitido : null,
              meses_ate_a_foto: distancia,
              alerta: distancia < 2 ? "Mês perto ou depois da foto de títulos (sintético)." : null,
            };
          }),
        }),
      },
      inadimplencia: {
        estado: "ok",
        dado: extrairInadimplencia({
          hoje,
          sincronizado_em: new Date(Date.parse(agora) - 4 * 86_400_000).toISOString(),
          totais: { em_aberto: 4_800_000, previsto_atrasado: 1_900_000, titulos_atrasados: 312 },
          faixas_de_atraso: [
            { faixa: "1 a 30 dias", valor: 700_000, titulos: 120 },
            { faixa: "31 a 60 dias", valor: 400_000, titulos: 70 },
            { faixa: "61 a 90 dias", valor: 300_000, titulos: 52 },
            { faixa: "Mais de 90 dias", valor: 500_000, titulos: 70 },
          ],
          cobertura: { sem_sync: ["EMPRESA EXEMPLO"] },
          por_cliente: [{ cliente: "Cliente Sintético 001", valor: 1 }],
        }),
      },
      indicadores: {
        estado: "ok",
        dado: extrairIndicadores({
          escopo: {
            comp_de: `${ultimoFechado.slice(0, 4)}-01-01`,
            comp_ate: `${ultimoFechado}-01`,
          },
          receita_bruta: { valor: 24_000_000 },
          lucro_bruto: { valor: 10_500_000, rotulo: "(=) LUCRO BRUTO OU MARGEM DE CONTRIBUIÇÃO" },
          margem_pct: 0.4375,
          por_empresa: [
            {
              grupo_apuracao: "GRUPO A",
              receita_bruta: 11_000_000,
              lucro_bruto: 5_800_000,
              resultado: 1_900_000,
              cnpj: "00.000.000/0001-00",
            },
            {
              grupo_apuracao: "GRUPO A",
              receita_bruta: 3_000_000,
              lucro_bruto: 1_200_000,
              resultado: 300_000,
            },
            {
              grupo_apuracao: "GRUPO B",
              receita_bruta: 6_000_000,
              lucro_bruto: 2_400_000,
              resultado: 700_000,
            },
            {
              grupo_apuracao: "GRUPO C",
              receita_bruta: 4_000_000,
              lucro_bruto: 1_100_000,
              resultado: -200_000,
            },
          ],
          caixa_livre: {
            valor: 1_250_000,
            mes_referencia: `${ultimoFechado}-01`,
            sem_dado: false,
            defasado: false,
            definicao: "Caixa livre = saldo bancário (sintético).",
            cobertura: { empresas_sem_saldo: ["EMPRESA EXEMPLO"] },
          },
        }),
      },
    },
  };

  const mesesAq = mesesAte(hoje, 7).map((d) => d.slice(0, 7));
  const aquisicao: NonNullable<FonteCockpit["aquisicao"]> = {
    estado: "ok",
    erro: null,
    resposta: {
      estado: "ok",
      lidoEm,
      unidadesLidas: true,
      atualizadoEm: new Date(Date.parse(agora) - 2 * 3_600_000).toISOString(),
      dado: montarAquisicao(
        {
          serie: mesesAq.map((mes, i) => ({
            mes,
            investimento: 120_000 + i * 12_000,
            leads: 900 + i * 60,
            mql: 300 + i * 30,
            vendas: 14 + i * 3 - (i === 4 ? 6 : 0),
            mrr: (14 + i * 3 - (i === 4 ? 6 : 0)) * 5_000,
          })),
          metas: mesesAq.slice(-4).flatMap((mes, i) => [
            { mes, papel: "funil", metrica: "new_mrr_mes", alvo: 150_000 + i * 15_000 },
            { mes, papel: "funil", metrica: "vendas_mes", alvo: 30 + i * 3 },
            { mes, papel: "funil", metrica: "investimento_mes", alvo: 180_000 },
            { mes, papel: "funil", metrica: "mql_mes", alvo: 500 },
          ]),
          mesCorrente: [
            {
              porte: "consolidado",
              mes: mesHoje,
              mrr_real: 120_000,
              mrr_meta: 195_000,
              mrr_forecast_ritmo: 170_000,
              mrr_forecast_pipeline: 185_000,
              vendas_real: 24,
              vendas_meta: 39,
              win_rate_rr: 0.22,
              ciclo_mediana_dias: 18,
            },
          ],
          abertos: Array.from({ length: 40 }, (_, i) => ({
            deal_id: i,
            mrr: 3_000 + (i % 7) * 900,
            expected_close_date:
              i % 5 === 0 ? null : i % 7 === 0 ? somaDias(hoje, -20) : somaDias(hoje, (i % 4) * 25),
          })),
          distMetas: UNIDADES.map((u, i) => ({
            unidade: u[1],
            quarter: `${hoje.slice(0, 4)}-T${Math.floor((Number(hoje.slice(5, 7)) - 1) / 3) + 1}`,
            meta: 60_000 + i * 10_000,
            vendido: 40_000 + i * 18_000,
          })),
        },
        hoje,
      ),
    },
  };

  const fases = ["Nova Onboarding", "Pré Kickoff", "Setup técnico", "Check-out Onboarding"];
  const cardsCrus = Array.from({ length: 70 }, (_, i) => {
    const idade = Math.floor(r() * 90);
    const terminal = i % 6 === 0 ? "Concluído" : i % 13 === 0 ? "Churn no Onboarding" : null;
    const fase = terminal ?? fases[i % fases.length];
    const entrou = new Date(Date.parse(agora) - idade * 86_400_000).toISOString();
    return {
      fase_atual: fase,
      fase_atual_ordem: terminal ? (terminal === "Concluído" ? 8 : 999) : (i % fases.length) + 4,
      entrou_fase_atual_em: entrou,
      criado_em: new Date(Date.parse(entrou) - 10 * 86_400_000).toISOString(),
      concluido: !!terminal,
      empresa_id: i % 8 === 0 ? null : 1000 + i,
      fases_history: terminal === "Concluído" ? [{ fase: "Concluído", entrou_em: entrou }] : [],
    };
  });
  const cards = cardsCrus.map(lerCard);
  const ganhos = new Map<number, string>(
    cardsCrus
      .filter((c) => c.empresa_id !== null && c.empresa_id % 3 !== 0)
      .map((c) => [c.empresa_id as number, somaDias(c.criado_em.slice(0, 10), -7)]),
  );
  const onboarding = montarOnboarding(
    cards,
    new Map([...ganhos.entries()].map(([id, g]) => [id, [g]])),
    agora,
    { de: `${mesHoje}-01`, ate: hoje },
  );
  const cadeia = montarCadeia({
    vendas: [...ganhos.entries()].map(([empresaId, ganhoEm], i) => ({
      empresaId,
      cnpj: i % 10 === 0 ? null : `99${String(empresaId).padStart(12, "0")}`,
      ganhoEm,
      dealId: String(empresaId),
    })),
    onboarding: new Map(
      cards
        .filter((c) => c.empresaId !== null)
        .map((c) => [c.empresaId as number, { concluido: c.fase === "Concluído" }]),
    ),
    nomesPorCnpj: new Map(
      [...ganhos.keys()]
        .filter((id) => id % 4 !== 1)
        .map((id) => [`99${String(id).padStart(12, "0")}`, new Set([`cliente sintetico ${id}`])]),
    ),
    documentosPorNome: new Map(
      [...ganhos.keys()].map((id) => [`cliente sintetico ${id}`, id % 9 === 2 ? 2 : 1]),
    ),
    mesesFaturadosPorNome: new Map(
      [...ganhos.entries()]
        .filter(([id]) => id % 5 !== 3)
        .map(([id, g]) => [`cliente sintetico ${id}`, new Set([g.slice(0, 7)])]),
    ),
    churnEmpresas: new Set([...ganhos.keys()].filter((id) => id % 17 === 0)),
    churnNegocios: new Set(),
    faturamentoLido: true,
    // Metade dos clientes de unidade já com título, alguns pagos.
    titulosUnidadePorCnpj: new Map(
      [...ganhos.entries()]
        .filter(([id]) => id % 2 === 0)
        .map(([id, g]) => [
          `99${String(id).padStart(12, "0")}`,
          [{ vencimento: somaDias(g, 30), pago: id % 4 === 0 }],
        ]),
    ),
    unidadesLidas: true,
  });
  const operacao: NonNullable<FonteCockpit["operacao"]> = {
    estado: "ok",
    erro: null,
    resposta: {
      lidoEm,
      onboarding: {
        estado: "ok",
        dado: onboarding,
        atualizadoEm: new Date(Date.parse(agora) - 20 * 60_000).toISOString(),
      },
      cadeia: { estado: "ok", dado: cadeia, faturamento: null },
    },
  };
  return {
    ponte,
    frescorFinanceiro: { carregadoEm, cobreAte: somaDias(carregadoEm.slice(0, 10), -2) },
    caixa,
    aquisicao,
    operacao,
  };
}
