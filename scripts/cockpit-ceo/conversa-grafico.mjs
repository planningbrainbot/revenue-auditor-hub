// "Perguntar ao Brain sobre este gráfico" de ponta a ponta, pela API real e com a sessão da conta
// autorizada (scripts/cockpit-ceo/_sessao.mjs): manda a pergunta com o id do gráfico, lê o SSE e
// imprime conclusão, consultas, blocos e frases descartadas. Apaga a conversa de teste ao fim.
//
// Uso: SESSAO_EMAIL=… SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=…
//      node scripts/cockpit-ceo/conversa-grafico.mjs <base> <grafico> ["pergunta"]
// Custa uma rodada do modelo (~US$ 0,02 em 25/09).
import { createClient } from "@supabase/supabase-js";
import { abrirSessao, lerSSE } from "./_sessao.mjs";

const [BASE, GRAFICO, PERGUNTA] = process.argv.slice(2);
const s = await abrirSessao(process.env.SESSAO_EMAIL);
const resp = await fetch(`${BASE}/api/cockpit-ceo/conversa`, {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: `Bearer ${s.access_token}` },
  body: JSON.stringify({
    pergunta:
      PERGUNTA ??
      "O que este gráfico mostra de mais importante, e o que devo decidir a partir dele?",
    grafico: GRAFICO,
  }),
});
if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const partes = await lerSSE(resp);
const conversa = partes.find((p) => p.type === "data-estado" && p.data?.etapa === "conversa")?.data
  ?.detalhe;
const final = partes.find((p) => p.type === "data-resposta")?.data;
console.log(
  JSON.stringify(
    {
      estado: final?.estado,
      conclusao: final?.conclusao,
      consultas: final?.consultas,
      blocos: final?.blocos?.map((b) => b.tipo + ":" + (b.titulo ?? "")),
      descartadas: final?.descartadas,
      modelo: final?.modelo,
      custoUsd: final?.custoUsd,
      latenciaMs: final?.latenciaMs,
    },
    null,
    2,
  ),
);
if (conversa) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${s.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "ops" },
  });
  await db.from("cockpit_mensagens").delete().eq("conversa_id", conversa);
  const { error } = await db.from("cockpit_conversas").delete().eq("id", conversa);
  console.log(error ? `conversa não apagada: ${error.message}` : "conversa de teste apagada");
}
