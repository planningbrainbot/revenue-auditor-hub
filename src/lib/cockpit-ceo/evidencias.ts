// Matriz de evidências para exportar: cada pergunta do cockpit com a cobertura declarada, a fonte,
// quem responde, o que falta e o estado atual dos números e painéis que a respondem. Só catálogo e
// estados — nenhum dado de cliente, unidade ou negócio. CSV com ";" (Excel em português).
import { ESTADOS, formatarValor } from "./contrato.ts";
import type { Cockpit } from "./indicadores.ts";
import { COBERTURAS, EXIGENCIAS_INVESTIDOR, PERGUNTAS } from "./perguntas.ts";

const campo = (x: string) => (/[;"\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);

export function matrizDeEvidencias(c: Cockpit, geradoEm: string): string {
  const paineis: Record<string, string> = {
    R1: c.trajetoria
      ? "trajetória: " + c.trajetoria.map((t) => `${t.id}=${ESTADOS[t.estado]}`).join(", ")
      : "",
    C1: c.clientes
      ? "clientes ativos: " +
        c.clientes.definicoes.map((d) => `${d.id}=${ESTADOS[d.estado]}`).join(", ")
      : "",
    C3: c.clientes ? `penetração ganha no CRM=${ESTADOS[c.clientes.penetracaoEstado]}` : "",
    T1: c.coortes ? `coortes=${ESTADOS[c.coortes.estado]}` : "",
    N3: c.rede ? `rede por unidade=${ESTADOS[c.rede.estado]}` : "",
  };
  const cabecalho = [
    "pergunta",
    "frente",
    "texto",
    "cobertura",
    "fonte",
    "responsavel",
    "pendencia",
    "exigencia_mapa",
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
      COBERTURAS[p.cobertura],
      p.fonte,
      p.responsavel,
      p.pendencia ?? "",
      exigencia,
      indicadores,
      paineis[p.id] ?? "",
      c.sintetico ? "sintéticos" : "reais",
      geradoEm,
    ]
      .map(campo)
      .join(";");
  });
  return [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n";
}
