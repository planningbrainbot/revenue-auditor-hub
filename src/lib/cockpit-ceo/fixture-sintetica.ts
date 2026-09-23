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

export function fonteSintetica(hoje: string, agora: string): FonteCockpit {
  return {
    sintetico: true,
    hoje,
    agora,
    acessoBase: true,
    acessoNegocios: true,
    // Carga "de dez minutos atrás" em relação a quem abre o preview, para não parecer parada.
    monetizacao: {
      estado: "ok",
      erro: null,
      dados: baseSintetica(hoje, new Date(Date.parse(agora) - 10 * 60_000).toISOString()),
    },
  };
}
