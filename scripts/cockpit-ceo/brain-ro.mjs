// Leitura SOMENTE LEITURA do banco único do Planning Brain, para homologar o Cockpit do CEO.
//
// Pela Management API do Supabase com `read_only: true`: a consulta roda com o papel de leitura e
// o Postgres recusa qualquer escrita (conferido: CREATE/INSERT devolvem erro). O token vem de
// SUPABASE_ACCESS_TOKEN no ambiente; este arquivo nunca o lê de disco nem o imprime.
//
// Uso como CLI:    node scripts/cockpit-ceo/brain-ro.mjs "select 1"
// Uso como módulo: import { consultar } from "./brain-ro.mjs"
//
// As saídas deste piloto são agregadas: nenhum nome, CNPJ ou contato vai para arquivo do repositório.
import { pathToFileURL } from "node:url";

export const REF = process.env.BRAIN_REF || "npknehhyyzelmrbbxvtu";

/**
 * `transacaoSomenteLeitura`: para o que o papel de leitura não alcança (a evidência tributária de
 * `ops.base_conta_estado` chama uma função que ele não executa). Roda com o papel padrão, mas dentro
 * de `begin transaction read only`: o Postgres recusa qualquer escrita (conferido em 22/09 com um
 * INSERT em ops.areas, que falhou e não deixou linha).
 */
export async function consultar(sql, { ref = REF, transacaoSomenteLeitura = false } = {}) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN ausente no ambiente.");
  if (transacaoSomenteLeitura) sql = "begin transaction read only; " + sql;
  const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "User-Agent": "planning-cockpit-ceo-homologacao/1.0",
    },
    body: JSON.stringify({ query: sql, read_only: !transacaoSomenteLeitura }),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${texto.slice(0, 400)}`);
  return JSON.parse(texto);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sql = process.argv[2];
  if (!sql) {
    console.error('uso: node scripts/cockpit-ceo/brain-ro.mjs "select ..."');
    process.exit(2);
  }
  consultar(sql)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
