// Carga de um tema do Cockpit do COO no servidor: lê as fontes do tema e devolve a leitura montada
// (números, alertas e gráficos), já no recorte de unidade pedido.
//
// A montagem acontece no servidor, e não no navegador, porque algumas fontes são lidas com
// credencial de servidor (Financial Brain): o navegador recebe só o agregado. A Monetização é a
// exceção: é montada no navegador a partir da carga que a tela da Monetização já baixa.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { abrirContextoCoo } from "./contexto.server.ts";
import { lerBaseCoo } from "./base.functions.ts";
import { lerCompromisso } from "./compromissos.ts";
import { ehTema } from "./contrato.ts";
import type { LeituraTema, Tema } from "./contrato.ts";
import { filtroValido } from "./unidades.ts";
import { lerGrowth } from "./temas/growth.server.ts";
import { montarGrowth } from "./temas/growth.ts";
import { lerFinanceiroOperacoes } from "./temas/financeiro-operacoes.server.ts";
import { montarFinanceiroOperacoes } from "./temas/financeiro-operacoes.ts";
import { lerCsRh } from "./temas/cs-rh.server.ts";
import { montarCsRh } from "./temas/cs-rh.ts";
import { lerEstrategico } from "./temas/estrategico.server.ts";
import { montarEstrategico } from "./temas/estrategico.ts";

export type TemaNoServidor = Exclude<Tema, "monetizacao">;

export const carregarTemaCoo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tema: string; unidade?: string }) => {
    if (!ehTema(input?.tema) || input.tema === "monetizacao") throw new Error("Tema inválido.");
    return { tema: input.tema as TemaNoServidor, unidade: String(input.unidade ?? "") };
  })
  .handler(async ({ data, context }): Promise<LeituraTema> => {
    const ctx = await abrirContextoCoo(context);
    const filtro = filtroValido(ctx.unidades, data.unidade) ? data.unidade : "";
    const avisoFiltro = filtro === data.unidade ? [] : ["A unidade pedida não existe no cadastro: mostrando todas."];
    let leitura: LeituraTema;
    switch (data.tema) {
      case "growth":
        leitura = montarGrowth(await lerGrowth(ctx), ctx.unidades, filtro, ctx.hoje);
        break;
      case "financeiro-operacoes":
        leitura = montarFinanceiroOperacoes(await lerFinanceiroOperacoes(ctx), ctx.unidades, filtro, ctx.hoje);
        break;
      case "cs-rh":
        leitura = montarCsRh(await lerCsRh(ctx), ctx.unidades, filtro, ctx.hoje);
        break;
      case "estrategico": {
        const [dados, base] = await Promise.all([lerEstrategico(ctx), lerBaseCoo(ctx)]);
        const agora = new Date().toISOString();
        const compromissos = base.compromissos.ok
          ? base.compromissos.dado.linhas.map((l) => lerCompromisso(l, base.compromissos.ok ? base.compromissos.dado.eventos : [], agora))
          : [];
        leitura = montarEstrategico(
          dados,
          {
            okrs: base.okrs.ok ? base.okrs.dado : [],
            compromissos,
            clickupConectado: base.clickup.conectado,
            // Falha de carga não pode parecer "vazio": o motivo segue até o número.
            okrsMotivo: base.okrs.ok ? undefined : base.okrs.motivo,
            compromissosMotivo: base.compromissos.ok ? undefined : base.compromissos.motivo,
          },
          ctx.unidades,
          filtro,
          ctx.hoje,
        );
        break;
      }
    }
    return { ...leitura, avisos: [...avisoFiltro, ...leitura.avisos] };
  });
