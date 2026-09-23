import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/planning";
import { Panel } from "@/components/monetizacao/common";
import { FRENTES, ORDEM_FRENTES } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import { rotearPerguntaCeo, statusJevCockpit } from "@/lib/cockpit-ceo/jev.functions";
import { IDS_PERGUNTAS_CEO, PERGUNTAS_CEO_FICTICIAS } from "@/lib/cockpit-ceo/jev/contrato";
import type { IdPerguntaCeo, RespostaJev } from "@/lib/cockpit-ceo/jev/contrato";

// Encaminhamento de pergunta do CEO por Jev, com texto fictício.
//
// O que é SUGESTÃO fica marcado como IA e nunca vira número: Jev escolhe a frente; os números da
// frente continuam vindo do cálculo do Brain. Confiança baixa não navega sozinha, e falha do
// fornecedor aparece como falha — sem resultado de reserva.

const ROTULO_OPCAO: Record<string, string> = {
  ...Object.fromEntries(ORDEM_FRENTES.map((f) => [f, FRENTES[f].titulo])),
  fora_de_escopo: "Fora do escopo do cockpit",
  insuficiente: "Pergunta vaga demais",
};
// Limiar provisório, tirado da orientação da TypeSafe (abaixo de 0,5: não agir sozinho). Não foi
// validado com casos rotulados da Planning; serve para não navegar sozinho em dúvida clara.
const CONFIANCA_MINIMA = 0.5;
const decimal = (v: number, casas = 2) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dolares = (v: number | null) =>
  v === null
    ? "não informado pelo fornecedor"
    : `US$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}`;

export function JevRoteador({ irParaFrente }: { irParaFrente: (f: Frente) => void }) {
  const [pergunta, setPergunta] = useState<IdPerguntaCeo>(IDS_PERGUNTAS_CEO[0]);
  const rotear = useServerFn(rotearPerguntaCeo);
  const status = useServerFn(statusJevCockpit);
  const st = useQuery({ queryKey: ["cockpit-jev-status"], queryFn: () => status(), staleTime: 0 });
  const m = useMutation({
    mutationFn: (p: IdPerguntaCeo) => rotear({ data: { pergunta: p } }),
    onSettled: () => void st.refetch(),
    retry: false,
  });
  const r = m.data;
  const frente =
    r?.estado === "ok" ? (r.respostas.frente as Extract<RespostaJev, { type: "choice" }>) : null;
  const pedeDado =
    r?.estado === "ok" ? (r.respostas.pede_dado as Extract<RespostaJev, { type: "noul" }>) : null;
  const escolhaEhFrente = !!frente && (ORDEM_FRENTES as string[]).includes(frente.choice);
  const confiancaBaixa = frente?.confidence != null && frente.confidence < CONFIANCA_MINIMA;
  const orcamento = st.data?.orcamento;

  return (
    <Panel
      title="Pergunte ao cockpit"
      action={
        <StatusBadge tom="info" icone={Sparkles}>
          Jev real · texto fictício · sugestão de IA
        </StatusBadge>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-muted-foreground">
              Escolha uma pergunta fictícia. Texto livre não é enviado neste piloto.
            </legend>
            {IDS_PERGUNTAS_CEO.map((id) => (
              <label key={id} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="pergunta-ceo"
                  className="mt-1"
                  checked={pergunta === id}
                  onChange={() => {
                    // A sugestão anterior é de outra pergunta: não fica na tela ao lado desta.
                    setPergunta(id);
                    m.reset();
                  }}
                />
                <span>{PERGUNTAS_CEO_FICTICIAS[id]}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => m.mutate(pergunta)}
              disabled={m.isPending || !st.data?.ativo || orcamento?.bloqueado}
            >
              {m.isPending ? "Consultando Jev…" : "Encaminhar com Jev"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {st.isError
                ? "Não foi possível conferir o estado do piloto no servidor."
                : !st.data
                  ? "Conferindo o piloto…"
                  : !st.data.ativo
                    ? "Jev desligado neste servidor."
                    : `${orcamento?.tentativas ?? 0} de 10 requisições usadas · custo informado US$ ${decimal(orcamento?.custoConhecidoUsd ?? 0, 6)}${orcamento?.custoDesconhecido ? " · há chamada sem custo informado" : ""} · chave ${st.data.chaveCadastrada ? "cadastrada" : "NÃO cadastrada"}`}
            </span>
          </div>
          {orcamento?.bloqueado && <p className="text-xs text-warning">{orcamento.motivo}</p>}
        </div>

        <div className="space-y-2 text-xs" aria-live="polite">
          {!r && !m.error && (
            <p className="text-muted-foreground">
              Jev escolhe a frente mais provável e diz se a pergunta pede dado verificável. Ele não
              calcula número, não decide regra e não autoriza ação.
            </p>
          )}
          {m.error && <p className="text-danger">Falha ao chamar o servidor: {m.error.message}</p>}
          {r && r.estado !== "ok" && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
              <p className="font-medium">Sem classificação ({r.codigo}).</p>
              <p className="text-muted-foreground">{r.mensagem}</p>
              <p className="mt-1 text-muted-foreground">
                Nenhum resultado simulado foi posto no lugar. O cockpit segue funcionando.
              </p>
            </div>
          )}
          {r?.estado === "ok" && frente && pedeDado && (
            <div className="space-y-2">
              <div className="rounded-lg border border-info/30 bg-info-soft p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-info">
                  Sugestão de IA · não é dado verificado
                </p>
                {m.variables && (
                  <p className="mt-1 text-muted-foreground">
                    Pergunta encaminhada: {PERGUNTAS_CEO_FICTICIAS[m.variables]}
                  </p>
                )}
                <p className="mt-1 text-sm font-medium">
                  Frente sugerida: {ROTULO_OPCAO[frente.choice] ?? frente.choice}
                </p>
                <p className="text-muted-foreground">
                  Confiança{" "}
                  {frente.confidence === null ? "não informada" : decimal(frente.confidence)}
                  {" · "}resume a distribuição abaixo; não é a probabilidade de estar certo.
                </p>
                {frente.probabilities && (
                  <ul className="mt-2 space-y-1">
                    {Object.entries(frente.probabilities)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 3)
                      .map(([k, p]) => (
                        <li key={k} className="grid grid-cols-[140px_1fr_40px] items-center gap-2">
                          <span className="truncate">{ROTULO_OPCAO[k] ?? k}</span>
                          <span className="h-1.5 rounded bg-muted">
                            <span
                              className="block h-1.5 rounded bg-chart-3"
                              style={{ width: `${Math.round(p * 100)}%` }}
                            />
                          </span>
                          <span className="text-right tabular-nums">{decimal(p)}</span>
                        </li>
                      ))}
                  </ul>
                )}
                <p className="mt-2">
                  Pede dado verificável:{" "}
                  {pedeDado.noul >= 0.5 ? "provavelmente sim" : "provavelmente não"}{" "}
                  <span className="text-muted-foreground">
                    (noul {decimal(pedeDado.noul)}; noul não tem campo de confiança)
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {escolhaEhFrente ? (
                  <Button
                    size="sm"
                    variant={confiancaBaixa ? "outline" : "default"}
                    onClick={() => irParaFrente(frente.choice as Frente)}
                  >
                    Abrir {FRENTES[frente.choice as Frente].titulo}
                  </Button>
                ) : (
                  <span className="text-muted-foreground">
                    Nenhuma frente sugerida: nada a abrir.
                  </span>
                )}
                {confiancaBaixa && (
                  <span className="text-warning">
                    Confiança baixa: confira a frente você mesmo (limiar provisório, não validado).
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                Os números da frente vêm do cálculo do Brain sobre a fonte da tela, não do Jev.
              </p>
              <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-0.5 rounded-lg border p-2 text-xs">
                <dt className="text-muted-foreground">Modelo</dt>
                <dd>
                  {r.modeloRetornado}{" "}
                  <span className="text-muted-foreground">(pedido: {r.modeloSolicitado})</span>
                </dd>
                <dt className="text-muted-foreground">Duração medida</dt>
                <dd>{r.latenciaMs.toLocaleString("pt-BR")} ms</dd>
                <dt className="text-muted-foreground">Custo informado</dt>
                <dd>{dolares(r.custoUsd)}</dd>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd>
                  {r.tokens.entrada ?? "—"} entrada · {r.tokens.saida ?? "—"} saída
                </dd>
                <dt className="text-muted-foreground">Chamada</dt>
                <dd className="truncate">
                  {r.idChamada} · {r.taxonomia}
                </dd>
              </dl>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
