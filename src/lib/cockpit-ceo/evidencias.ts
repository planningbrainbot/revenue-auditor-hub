// Matriz de evidências para exportar: cada pergunta do registro único (perguntas.ts) com a origem,
// o pilar, a cobertura, os estados separados (dado, implementação, homologação, adoção, decisão),
// a fonte, quem responde, o papel de Growth e Ops, o que falta e o estado atual dos números e
// painéis que a respondem. Só catálogo e estados — nenhum dado de cliente, unidade ou negócio.
// CSV com ";" (Excel em português).
import { ESTADOS, formatarValor } from "./contrato.ts";
import type { Cockpit } from "./indicadores.ts";
import { COBERTURAS, EXIGENCIAS_INVESTIDOR, PERGUNTAS, PILARES } from "./perguntas.ts";
import type { IdPainel } from "./perguntas.ts";

const campo = (x: string) => (/[;"\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);

/** Estado de cada painel no cockpit montado; vazio quando o painel não foi carregado. */
export function estadosDosPaineis(c: Cockpit): Record<IdPainel, string> {
  const e = c.empresa;
  const ok = (x: unknown, aviso: string | null) =>
    x ? "disponível" : aviso ? `sem número: ${aviso}` : "";
  return {
    trajetoria: c.trajetoria
      ? "trajetória: " + c.trajetoria.map((t) => `${t.id}=${ESTADOS[t.estado]}`).join(", ")
      : "",
    ponte: e.ponte
      ? `ponte: ${e.ponte.dado.meses.length} meses, ${e.ponte.dado.meses.every((m) => m.fecha) ? "todos fecham" : "algum não fecha"}`
      : ok(null, e.ponteAviso),
    caixa: e.caixa
      ? `caixa: emitido×recebido=${e.caixa.emitidoRecebido ? "ok" : "sem"}, inadimplência=${e.caixa.inadimplencia ? "ok" : "sem"}`
      : ok(null, e.caixaAviso),
    margem: e.caixa?.indicadores ? "margem por grupo: disponível" : ok(null, e.caixaAviso),
    aquisicao: ok(e.aquisicao, e.aquisicaoAviso),
    pipeline: e.aquisicao?.pipeline ? "pipeline: disponível" : ok(null, e.aquisicaoAviso),
    onboarding: ok(e.onboarding, e.onboardingAviso),
    cadeia: e.cadeia
      ? `cadeia: ${e.cadeia.faturadas === null ? "sem o elo do faturamento" : "todos os elos"}`
      : ok(null, e.cadeiaAviso),
    "clientes-ativos": c.clientes
      ? "clientes ativos: " +
        c.clientes.definicoes.map((d) => `${d.id}=${ESTADOS[d.estado]}`).join(", ") +
        ` · penetração ganha no CRM=${ESTADOS[c.clientes.penetracaoEstado]}`
      : "",
    coortes: c.coortes ? `coortes=${ESTADOS[c.coortes.estado]}` : "",
    "rede-unidades": c.rede ? `rede por unidade=${ESTADOS[c.rede.estado]}` : "",
    "metas-unidade": e.aquisicao
      ? e.unidadesLidas
        ? "metas por unidade: disponível"
        : "metas por unidade: sem leitura"
      : ok(null, e.aquisicaoAviso),
    frescor: e.frescor.map((f) => `${f.fonte}=${f.estado}`).join(", "),
  };
}

export function matrizDeEvidencias(c: Cockpit, geradoEm: string): string {
  const paineis = estadosDosPaineis(c);
  const cabecalho = [
    "pergunta",
    "frente",
    "texto",
    "origem",
    "exigencia_mapa",
    "pilar",
    "apoios",
    "roadmap",
    "cobertura",
    "estado_dado",
    "implementacao",
    "homologacao",
    "adocao",
    "decisao_pendente",
    "resposta_atual",
    "fonte",
    "responsavel",
    "papel_growth",
    "papel_ops",
    "pendencia",
    "indicadores",
    "paineis",
    "dados",
    "gerado_em",
  ];
  const linhas = PERGUNTAS.map((p) => {
    const indicadores = p.indicadores
      .map((id) => {
        const i = c.indicadores.find((x) => x.id === id);
        if (!i) return `${id}=ausente`;
        return `${id}=${ESTADOS[i.estado]}${i.valor !== null ? ` (${formatarValor(i)})` : ""}`;
      })
      .join(" | ");
    const exigencia = p.exigencia
      ? `${p.exigencia}. ${EXIGENCIAS_INVESTIDOR.find((e) => e.id === p.exigencia)?.titulo ?? ""}`
      : "";
    return [
      p.id,
      p.frente,
      p.texto,
      p.origem,
      exigencia,
      PILARES[p.pilar].titulo,
      p.apoios.map((a) => PILARES[a].titulo).join(" | "),
      p.roadmap.join(" "),
      COBERTURAS[p.cobertura],
      p.estados.dado,
      p.estados.implementacao,
      p.estados.homologacao,
      p.estados.adocao,
      p.estados.decisao ?? "",
      p.resposta,
      p.fonte,
      p.responsavel,
      p.growth,
      p.ops,
      p.pendencia ?? "",
      indicadores,
      p.paineis
        .map((x) => paineis[x])
        .filter(Boolean)
        .join(" | "),
      c.sintetico ? "sintéticos" : "reais",
      geradoEm,
    ]
      .map(campo)
      .join(";");
  });
  return [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n";
}
