import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { z } from "zod";

// "Perguntar ao Brain": uma rodada da conversa por requisição, em Server-Sent Events.
//
// Antes de abrir o stream: sessão (Bearer), corpo validado e área `cockpit_ceo` conferida no
// servidor. Quem não passa recebe 401/403 em JSON e nada é lido. Dentro do stream seguem os
// estados (classificando, consultando…), as consultas feitas e a resposta final já conferida.
// Cancelar no navegador fecha a requisição; o sinal chega ao modelo e às consultas.
const Corpo = z
  .object({
    conversaId: z.string().uuid().nullable().optional(),
    pergunta: z.string().trim().min(1).max(2000),
  })
  .strict();

const json = (status: number, erro: string) =>
  new Response(JSON.stringify({ erro }), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/cockpit-ceo/conversa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { contextoDaRequisicao, SemSessao } =
          await import("@/lib/cockpit-ceo/conversa/sessao.server");
        const { conferirAcesso, SemAreaCockpit } =
          await import("@/lib/cockpit-ceo/conversa/carga.server");
        const { rodadaNoServidor } = await import("@/lib/cockpit-ceo/conversa/servidor.server");
        let ctx;
        try {
          ctx = await contextoDaRequisicao(request);
          await conferirAcesso(ctx);
        } catch (e) {
          if (e instanceof SemSessao) return json(401, "Entre novamente para perguntar.");
          if (e instanceof SemAreaCockpit) return json(403, e.message);
          return json(500, "Não foi possível conferir seu acesso.");
        }
        let corpo: z.infer<typeof Corpo>;
        try {
          const lido = Corpo.safeParse(await request.json());
          if (!lido.success) return json(400, "Pergunta inválida.");
          corpo = lido.data;
        } catch {
          return json(400, "Pergunta inválida.");
        }
        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            writer.write({ type: "start" });
            await rodadaNoServidor(
              ctx,
              { conversaId: corpo.conversaId ?? null, pergunta: corpo.pergunta },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (parte) => writer.write(parte as any),
              request.signal,
            );
            writer.write({ type: "finish" });
          },
          onError: (e) => {
            console.error("[cockpit-ceo conversa]", e);
            return e instanceof Error && /Conversa não encontrada/.test(e.message)
              ? "Conversa não encontrada."
              : "A conversa falhou. Nenhum número foi mostrado.";
          },
        });
        return createUIMessageStreamResponse({ stream });
      },
    },
  },
});
