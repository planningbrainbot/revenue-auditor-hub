/* eslint-disable @typescript-eslint/no-explicit-any -- JSON da API e do banco chega sem tipo. */
// Carga diária do faturamento apurado no SPED, pela API de faturamento do Silas (smartflow-office). Lógica em
// logica.ts (testada no Node: tests/faturamento-sped.test.mjs); dados em ops.faturamento_sped_mensal e o andamento
// em ops.faturamento_sped_cargas (migration 20261022190000_faturamento_sped.sql).
//
// O cron chama a cada 10 minutos das 3h às 5h50 de Brasília. Cada chamada puxa páginas por até ~110 s e grava onde
// parou; a carga do dia (66 páginas, ~9 min de API) fecha em cerca de 7 chamadas.
//
// Como ligar (só com o "pode ativar" do Pedro):
// 1. supabase functions deploy faturamento-sped --no-verify-jwt
// 2. SPED_API_SENHA_BASE: a parte fixa da senha que o Silas mandou ao Pedro (Keychain do Mac do Pedro, serviço
//    api-faturamento-silas). A senha do dia é calculada aqui.
// 3. FATURAMENTO_SPED_ATIVO=sim e o cron faturamento-sped-diario ativo. Desligada, só roda com {"manual": true}.
// Usa MONETIZACAO_SYNC_SECRET, o mesmo das outras funções do Brain chamadas pelo cron.
import { decidirCarga, linhasDaPagina, senhaDoDia, ultimaCompetencia, type Carga } from "./logica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const BASE_SENHA = Deno.env.get("SPED_API_SENHA_BASE") || "";
const ATIVO = Deno.env.get("FATURAMENTO_SPED_ATIVO") === "sim";
const API =
  Deno.env.get("FATURAMENTO_SPED_URL") || "https://smartflow-office.planning.com.br/api_faturamento/receita";
const ORCAMENTO_MS = 110_000;

// O servidor da API manda só o certificado final, emitido pela intermediária YR1 da Let's Encrypt, cuja raiz ("Root
// YR", de 2025) o ambiente da função ainda não traz. Enquanto o servidor não mandar a cadeia completa, as chamadas à
// API confiam nesta intermediária pública (http://yr1.i.lencr.org/, válida até 02/09/2028). Só vale para a API do Silas.
const LETS_ENCRYPT_YR1 = `-----BEGIN CERTIFICATE-----
MIIE2zCCAsOgAwIBAgIRAKICU/FfJpHAXcHOE7m8yk4wDQYJKoZIhvcNAQELBQAw
LjELMAkGA1UEBhMCVVMxDTALBgNVBAoTBElTUkcxEDAOBgNVBAMTB1Jvb3QgWVIw
HhcNMjUwOTAzMDAwMDAwWhcNMjgwOTAyMjM1OTU5WjAzMQswCQYDVQQGEwJVUzEW
MBQGA1UEChMNTGV0J3MgRW5jcnlwdDEMMAoGA1UEAxMDWVIxMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoVi8X2xCYgMXvJxNPKp/oF13UMgmPABB07VC
LNDtoXmt9luEZNJSBV10VyT1Pz6LD8Zq1d2gc43WNl1AdRrj4sEnazbOiz0nPpmG
Bp2hui49oZtDIY6wdKeZAi5BbNU20CH6RSBBMLSQ9cXrH8dxdv4PAJ45ssGML68U
SE3BsjC2a6cAN9L5CgXVIQi5tfNiTPoFZZ3S0OlXqLmmtdV95udWAb5b6e/F49Di
CsH0Y00Ag72BVIb1hzynmKe+X0mERBTtsb3BwmpV9ipeBjMLoR/D9cHxHQCWoi5l
TmXwY015J5rGelz1nZjJuxc2kioaX29XJBnhMkP531rSdG5uMwIDAQABo4HuMIHr
MA4GA1UdDwEB/wQEAwIBhjATBgNVHSUEDDAKBggrBgEFBQcDATASBgNVHRMBAf8E
CDAGAQH/AgEAMB0GA1UdDgQWBBQfLzW+RhSCzUCxrnksVXj699Ro+zAfBgNVHSME
GDAWgBTe51tg0CJtQCh9Pw0B/qS1UrRRlDAyBggrBgEFBQcBAQQmMCQwIgYIKwYB
BQUHMAKGFmh0dHA6Ly95ci5pLmxlbmNyLm9yZy8wEwYDVR0gBAwwCjAIBgZngQwB
AgEwJwYDVR0fBCAwHjAcoBqgGIYWaHR0cDovL3lyLmMubGVuY3Iub3JnLzANBgkq
hkiG9w0BAQsFAAOCAgEA0+zvMq3kHig1ddTmmm+RibTr9/RpX7k4buanMMRqbV/y
IvP82zAHN3mvaw+cASuVsdpd0ikjhr4hnhJQLQOzOp2ccKrsdGOAgo0vddeISFAq
EWEV4lmUM3vFF796up+bSgmJ1u6RupDCMxDgF8M3eLvGuj6L0lu3zkQ0KuQLnKxL
tB0oQqn1Idg5CuuGpMvQzk29Pa3D/qHurc0EIM9SxukQuJqq63lxsYyRQFU8yMBO
hq1w5LbfaWNRrz1uklOfI/pYkAb2E2MTZrAMQkBIE2S8Jt1F8gRc96o/xOsrgvSk
a84AisX6xq1lz1Z7jGvrnXc4TMcjxZTjiTaihcYI1JIXZiLtEMSCa5l3cu8YWd6z
dLRQlqRdclVjuQfNHawRJ6GWlkK0QJosivTKwdBw3KxEtzGo8yMHERbsy57gP1UX
HOMcmZYQC0gtyR3SxfenIM/MxC3Ia2Ypab/kQ/CTnlIn2KQ5JUC6NYrGCbhFN9bp
5lKJStEwCUnLpntcrXk5XVDCNv/5RyWpRThkGOV7GetKkQ0qAY8hCzWK6oqnAhDZ
cjlYVdWfqOw3DIOX6EDNBgAqHarRVxyF9QZdOaXSyPJ0ueD2BYJEBgaCGQ8rAaU/
Qc123V5LTXDZW4CcsPBDyhy4v+c8hClAyw/IkJlfBqxB9D+/wvIMHgECZ4ptP6o=
-----END CERTIFICATE-----`;
const clienteApi = (Deno as any).createHttpClient
  ? (Deno as any).createHttpClient({ caCerts: [LETS_ENCRYPT_YR1] })
  : undefined;

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<any> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: init.method || (init.body === undefined ? "GET" : "POST"),
    headers: {
      apikey: ADMIN,
      Authorization: `Bearer ${ADMIN}`,
      "Content-Type": "application/json",
      "Accept-Profile": "ops",
      "Content-Profile": "ops",
      Prefer: init.prefer || "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`ops.${path.split("?")[0]}: ${json?.message || res.status}`);
  return json;
}

async function pagina(senha: string, n: number): Promise<{ empresas: any[]; ultima: boolean }> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "planning-brain/faturamento-sped" },
    body: JSON.stringify({ senha, pagina: n }),
    signal: AbortSignal.timeout(30000),
    ...(clienteApi ? { client: clienteApi } : {}),
  } as RequestInit);
  if (res.status === 401) throw new Error("API de faturamento recusou a senha do dia");
  if (!res.ok) throw new Error(`API de faturamento: HTTP ${res.status} na página ${n}`);
  const d = await res.json();
  return { empresas: Array.isArray(d?.empresas) ? d.empresas : [], ultima: d?.ultima_pagina === true };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método inválido" }, 405);
  if (!SEGREDO || req.headers.get("x-monetizacao-sync") !== SEGREDO) return json({ error: "Sem acesso" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "rodar") return json({ error: "Ação inválida" }, 400);
  const manual = body.manual === true;
  if (!ATIVO && !manual) return json({ status: "desligada" });
  if (!BASE_SENHA) return json({ status: "erro", error: "SPED_API_SENHA_BASE não configurada" }, 500);
  const maxPaginas = Number.isInteger(body.max_paginas) && body.max_paginas > 0 ? body.max_paginas : Infinity;
  const inicio = Date.now();
  let carga: Carga | null = null;
  try {
    const [ultima] = (await rest("faturamento_sped_cargas?select=*&order=id.desc&limit=1")) || [];
    const d = decidirCarga(ultima ?? null, new Date());
    if (d.acao === "feita") return json({ status: "ja_feita", carga_id: ultima.id });
    if (d.acao === "nova") {
      if (d.interromper)
        await rest(`faturamento_sped_cargas?id=eq.${d.interromper}`, {
          method: "PATCH",
          body: { status: "interrompida", terminada_em: new Date().toISOString() },
          prefer: "return=minimal",
        });
      [carga] = await rest("faturamento_sped_cargas", { body: { status: "rodando", proxima_pagina: 1, manual } });
    } else {
      carga = ultima;
      await rest(`faturamento_sped_cargas?id=eq.${carga!.id}`, {
        method: "PATCH",
        body: { status: "rodando", erro: null },
        prefer: "return=minimal",
      });
    }
    const senha = senhaDoDia(BASE_SENHA, new Date());
    let n = d.pagina;
    let feitas = 0;
    let fim = false;
    const acum = (await rest(`faturamento_sped_cargas?id=eq.${carga!.id}&select=paginas,empresas,meses`))[0];
    while (!fim && feitas < maxPaginas && Date.now() - inicio < ORCAMENTO_MS) {
      const p = await pagina(senha, n);
      const linhas = linhasDaPagina(p.empresas, carga!.id, ultimaCompetencia(new Date()));
      for (let i = 0; i < linhas.length; i += 1000)
        await rest("faturamento_sped_mensal?on_conflict=cnpj,competencia", {
          body: linhas.slice(i, i + 1000).map((l) => ({ ...l, atualizado_em: new Date().toISOString() })),
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      acum.paginas += 1;
      acum.empresas += p.empresas.length;
      acum.meses += linhas.length;
      fim = p.ultima;
      n += 1;
      feitas += 1;
      await rest(`faturamento_sped_cargas?id=eq.${carga!.id}`, {
        method: "PATCH",
        body: { proxima_pagina: n, ...acum },
        prefer: "return=minimal",
      });
    }
    if (!fim) return json({ status: "parcial", carga_id: carga!.id, proxima_pagina: n, ...acum });
    // Mês que estava "aguardando" e não veio nesta carga já passou do prazo: a linha antiga sai.
    await rest(`faturamento_sped_mensal?status=eq.aguardando_entrega&carga_id=neq.${carga!.id}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    const terminada = new Date();
    await rest(`faturamento_sped_cargas?id=eq.${carga!.id}`, {
      method: "PATCH",
      body: { status: "ok", terminada_em: terminada.toISOString() },
      prefer: "return=minimal",
    });
    const iniciada = (await rest(`faturamento_sped_cargas?id=eq.${carga!.id}&select=iniciada_em`))[0].iniciada_em;
    await rest("sync_log", {
      body: {
        fonte: "faturamento-sped",
        executado_em: terminada.toISOString(),
        duracao_segundos: Math.round((terminada.getTime() - new Date(iniciada).getTime()) / 1000),
        total_registros: acum.meses,
        detalhes: { carga_id: carga!.id, paginas: acum.paginas, empresas: acum.empresas, manual },
        status: "ok",
      },
      prefer: "return=minimal",
    });
    return json({ status: "ok", carga_id: carga!.id, ...acum });
  } catch (e) {
    const mensagem = (e as Error).message;
    if (carga)
      await rest(`faturamento_sped_cargas?id=eq.${carga.id}`, {
        method: "PATCH",
        body: { status: "erro", erro: mensagem.slice(0, 500) },
        prefer: "return=minimal",
      }).catch(() => {});
    return json({ status: "erro", error: mensagem }, 500);
  }
});
