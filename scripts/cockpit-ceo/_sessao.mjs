// Sessão de teste de UMA conta, aberta por link mágico com a chave de serviço e usada só na memória
// deste processo. Autorizada pelo Pedro em 24/09/2026 para a conta dele (pedro.luca@), para testar
// a conversa do cockpit de ponta a ponta. Nada disto grava token em arquivo ou imprime segredo.
//
// Ambiente: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e SUPABASE_SERVICE_ROLE_KEY (só no processo).
import { createClient } from "@supabase/supabase-js";

export async function abrirSessao(email) {
  const url = process.env.SUPABASE_URL;
  const publica = process.env.SUPABASE_PUBLISHABLE_KEY;
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publica || !servico)
    throw new Error("Faltam SUPABASE_URL/PUBLISHABLE_KEY/SERVICE_ROLE_KEY.");
  const admin = createClient(url, servico, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const anon = createClient(url, publica, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const v = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (v.error || !v.data.session) throw new Error(`verifyOtp: ${v.error?.message}`);
  return v.data.session;
}

/** Lê um SSE do AI SDK e devolve as partes (data-*) na ordem, com o tempo de cada uma. */
export async function lerSSE(resp, aoParte = () => {}) {
  const partes = [];
  const t0 = Date.now();
  const leitor = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const bloco = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const linha of bloco.split("\n")) {
        if (!linha.startsWith("data: ")) continue;
        const corpo = linha.slice(6);
        if (corpo === "[DONE]") continue;
        const p = JSON.parse(corpo);
        p._ms = Date.now() - t0;
        partes.push(p);
        aoParte(p);
      }
    }
  }
  return partes;
}
