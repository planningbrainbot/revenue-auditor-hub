// Qui · Monetização no servidor: só o projetado × realizado, para o "Perguntar ao Brain".
//
// A tela de quinta monta o tema no navegador, com a carga inteira da Monetização (`useMonetizacao`).
// O assistente roda no servidor e não tem essa carga: aqui ele lê só os negócios e as planilhas de
// forecast (318 negócios, ~0,5 MB em 30/09/2026), com a sessão da pessoa, e usa a mesma conta da
// tela (`forecastDaCarga`). A régua de engajamento das unidades fica "não apurado" com o motivo:
// ela depende da Base de clientes inteira, que só a tela baixa.
//
// Porta antes de ler: a RLS devolve tabela VAZIA a quem não pode ler, e "0 contratos" com cara de
// dado é pior que "sem acesso". A chave é a mesma da tela (`monetizacao_can`).
import type { ContextoCoo } from "../contexto.server.ts";
import { motivoDoErro } from "../contexto.server.ts";
import { todasAsPaginas } from "@/lib/cockpit-ceo/paginar";
import type { ForecastSource, Negocio } from "@/lib/monetizacao/types";
import { forecastDaCarga } from "./monetizacao.carga.ts";
import type { DadosMonetizacao, FalhaParte } from "./monetizacao.ts";

const SO_NA_TELA: FalhaParte = {
  ok: false,
  estado: "nao_apurado",
  motivo:
    "a régua de engajamento das unidades é calculada na tela de quinta, a partir da carga da Monetização; abra Qui · Monetização",
};

export async function lerMonetizacaoNoServidor(ctx: ContextoCoo): Promise<DadosMonetizacao> {
  const { db } = ctx;
  const pode = async (chave: string) => {
    const { data, error } = await db.rpc("monetizacao_can", { _key: chave });
    if (error) throw error;
    return data === true;
  };
  try {
    const [aquario, monetizacao, todas] = await Promise.all([
      pode("view.aquario"),
      pode("view.monetizacao"),
      db.rpc("monetizacao_scope", { _ids: [] }).then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error) throw error;
        return data === true;
      }),
    ]);
    if (!aquario && !monetizacao)
      return {
        forecast: {
          ok: false,
          estado: "acesso_insuficiente",
          motivo: "Seu acesso não lê os negócios da Monetização (view.aquario ou view.monetizacao).",
        },
        base: SO_NA_TELA,
        negocios: SO_NA_TELA,
      };
    const [cards, forecasts, sync] = await Promise.all([
      todasAsPaginas((de, ate) => db.from("monetizacao_deals").select("payload").order("id").range(de, ate)),
      todasAsPaginas((de, ate) => db.from("monetizacao_forecasts").select("payload").order("id").range(de, ate)),
      db.from("monetizacao_sync").select("measured_at, error").limit(1).maybeSingle(),
    ]);
    if (sync.error) throw sync.error;
    const s = (sync.data ?? {}) as { measured_at?: string | null; error?: string | null };
    return {
      forecast: forecastDaCarga(
        (forecasts as { payload: ForecastSource }[]).map((f) => f.payload),
        (cards as { payload: Negocio }[]).map((c) => c.payload),
        s.measured_at ?? null,
        s.error ?? null,
        { todasUnidades: todas },
      ),
      base: SO_NA_TELA,
      negocios: SO_NA_TELA,
    };
  } catch (e) {
    return {
      forecast: {
        ok: false,
        estado: "fonte_indisponivel",
        motivo: motivoDoErro("Monetização", e as { code?: string; message?: string } | null),
      },
      base: SO_NA_TELA,
      negocios: SO_NA_TELA,
    };
  }
}
