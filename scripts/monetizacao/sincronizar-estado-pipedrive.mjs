// Preenche ops.base_pipedrive_estado (migration 20261002160000) com o campo Estado dos negócios do Pipedrive, por
// organização. É a última fonte da UF da conta (ops.base_conta_uf), depois de Receita, cadastro, ECD e Omie.
//
// Lê os dois campos de negócio de estado pela API v2 (todos os pipes), converte para sigla e agrupa por organização.
// Sem --gravar, só mede. Com --gravar, troca o conteúdo da tabela numa transação (precisa da migration aplicada).
//
//   PIPEDRIVE_API_TOKEN=… SUPABASE_ACCESS_TOKEN=… node scripts/monetizacao/sincronizar-estado-pipedrive.mjs [--gravar]
// Os tokens vêm do ambiente e nunca são gravados nem impressos.
const K = "80f6804322de8ae85ed07654e4afdf902fe73dfa";
const K2 = "5d1b52c2c25236bff04df00f613abaf32ccd6545";
const REF = process.env.BRAIN_REF || "npknehhyyzelmrbbxvtu";
const gravar = process.argv.includes("--gravar");
const PD = process.env.PIPEDRIVE_API_TOKEN;
if (!PD || (gravar && !process.env.SUPABASE_ACCESS_TOKEN))
  throw new Error("Faltam tokens no ambiente.");

const NOMES = {
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
const SIGLAS = new Set(Object.values(NOMES));
export function sigla(rotulo) {
  if (!rotulo) return null;
  const t = String(rotulo).trim();
  if (SIGLAS.has(t.toUpperCase())) return t.toUpperCase();
  const n = t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\(.*\)\s*/, "")
    .trim();
  return NOMES[n] ?? null;
}

async function get(url) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: { "x-api-token": PD } });
    if (r.status === 429) {
      await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`Pipedrive HTTP ${r.status}`);
    return r.json();
  }
  throw new Error("Pipedrive recusou por limite de requisições.");
}

const campos = (await get("https://api.pipedrive.com/v1/dealFields?limit=500")).data;
const opcoes = (k) =>
  Object.fromEntries(
    (campos.find((f) => f.key === k)?.options ?? []).map((o) => [String(o.id), o.label]),
  );
const o1 = opcoes(K),
  o2 = opcoes(K2);
const porOrg = new Map();
const naoLidos = new Map();
let negocios = 0,
  cursor = null;
do {
  const j = await get(
    `https://api.pipedrive.com/api/v2/deals?limit=500&custom_fields=${K},${K2}${cursor ? "&cursor=" + cursor : ""}`,
  );
  for (const d of j.data ?? []) {
    const org = typeof d.org_id === "object" ? d.org_id?.id : d.org_id;
    const cf = d.custom_fields || {};
    for (const [v, op] of [
      [cf[K], o1],
      [cf[K2], o2],
    ]) {
      if (!v) continue;
      const rotulo = op[String(v)] ?? String(v);
      const s = sigla(rotulo);
      if (!s) {
        naoLidos.set(rotulo, (naoLidos.get(rotulo) ?? 0) + 1);
        continue;
      }
      if (!org) continue;
      const x = porOrg.get(org) ?? { ufs: new Set(), negocios: 0 };
      x.ufs.add(s);
      x.negocios++;
      porOrg.set(org, x);
      negocios++;
    }
  }
  cursor = j.additional_data?.next_cursor ?? null;
} while (cursor);

const lido_em = new Date().toISOString();
const linhas = [...porOrg].map(([org_id, x]) => ({
  org_id,
  ufs: [...x.ufs].sort(),
  negocios: x.negocios,
  lido_em,
}));
console.log(
  JSON.stringify({
    organizacoes: linhas.length,
    valores_lidos: negocios,
    com_mais_de_uma_uf: linhas.filter((l) => l.ufs.length > 1).length,
    rotulos_nao_lidos: Object.fromEntries(naoLidos),
  }),
);
if (!gravar) process.exit(0);

const sql = `begin;
delete from ops.base_pipedrive_estado;
insert into ops.base_pipedrive_estado (org_id, ufs, negocios, lido_em)
  select * from jsonb_populate_recordset(null::ops.base_pipedrive_estado, $j$${JSON.stringify(linhas)}$j$::jsonb);
commit;
select count(*) as gravadas from ops.base_pipedrive_estado;`;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "planning-monetizacao/1.0",
  },
  body: JSON.stringify({ query: sql }),
});
if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
console.log(JSON.stringify(await r.json()));
