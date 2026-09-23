import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { IDS_PERGUNTAS_CEO } from "./jev/contrato";
import type { IdPerguntaCeo } from "./jev/contrato";

// Encaminhamento de pergunta do CEO por Jev, no preview do piloto.
//
// A entrada é só o id de uma pergunta fictícia fixa (enum): texto livre não chega ao servidor, e
// o servidor não lê banco. Fora do piloto (sem COCKPIT_JEV_PILOTO=1, ou em produção) as duas
// funções devolvem "desativado" sem ler chave nem ledger. A chave nunca sai do servidor.
const ids = IDS_PERGUNTAS_CEO as [IdPerguntaCeo, ...IdPerguntaCeo[]];

export const rotearPerguntaCeo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ pergunta: z.enum(ids) }))
  .handler(async ({ data }) => {
    const { rotearPerguntaPiloto } = await import("./jev/piloto.server");
    return rotearPerguntaPiloto(data.pergunta);
  });

export const statusJevCockpit = createServerFn({ method: "GET" }).handler(async () => {
  const { statusPiloto } = await import("./jev/piloto.server");
  return statusPiloto();
});
