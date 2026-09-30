import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Carregando, EstadoSemAcesso, PageHeader, StatusBadge } from "@/components/planning";
import { usePermissions } from "@/hooks/use-permissions";
import { perguntarCoo } from "@/lib/cockpit-coo/perguntar.functions";
import type { RespostaCoo } from "@/lib/cockpit-coo/perguntar.functions";
import { TEMAS, ehTema } from "@/lib/cockpit-coo/contrato";
import type { Tema } from "@/lib/cockpit-coo/contrato";

// "Perguntar ao Brain" do Cockpit do COO. Três consultas fechadas (tema, OKRs, compromissos), o
// mesmo dado da tela; todo número da resposta é conferido contra o que as consultas devolveram.
// Sem histórico gravado nesta versão: a conversa vive só nesta aba.

interface BuscaPerguntar {
  tema?: Tema;
  q?: string;
}

export const Route = createFileRoute("/_authenticated/cockpit-coo_/perguntar")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput): BuscaPerguntar => ({
    tema: ehTema(s.tema) ? s.tema : undefined,
    q: typeof s.q === "string" ? s.q.slice(0, 1000) : undefined,
  }),
  head: () => ({ meta: [{ title: "Perguntar ao Brain · Cockpit do COO · Planning Brain" }] }),
  component: Pagina,
});

const SUGESTOES: Record<Tema, string[]> = {
  growth: ["Quais unidades estão mais atrasadas na meta do trimestre?", "Onde a mídia não virou contrato este mês?"],
  "financeiro-operacoes": ["Quanto tempo de caixa o grupo tem no ritmo atual?", "Quais unidades têm apuração fechada sem fatura?"],
  "cs-rh": ["Onde está o churn da rede neste mês?", "Quantas admissões tivemos no mês e em quais unidades?"],
  monetizacao: ["Em que produto a Monetização está abaixo do projetado no mês?"],
  estrategico: ["Quantas unidades estão no Pacto Trimestral?", "Quais departamentos estão atrás nos OKRs?"],
};

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <main className="mx-auto max-w-[1100px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="cockpit_coo" titulo="Perguntar ao Brain" />
        <Carregando variante="pagina" />
      </main>
    );
  if (!perms.temArea("cockpit_coo"))
    return (
      <main className="mx-auto max-w-[1100px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="cockpit_coo" titulo="Perguntar ao Brain" />
        <EstadoSemAcesso oQueFalta="a área Cockpit do COO (a administração da plataforma concede)" />
      </main>
    );
  return <Conversa />;
}

function Conversa() {
  const busca = Route.useSearch();
  const fn = useServerFn(perguntarCoo);
  const [texto, setTexto] = useState(busca.q ?? "");
  const [turnos, setTurnos] = useState<{ pergunta: string; resposta: RespostaCoo }[]>([]);
  const m = useMutation({
    mutationFn: (pergunta: string) => fn({ data: { pergunta, tema: busca.tema } }),
    onSuccess: (resposta, pergunta) => {
      setTurnos((t) => [...t, { pergunta, resposta }]);
      setTexto("");
    },
  });
  const sugestoes = busca.tema ? SUGESTOES[busca.tema] : Object.values(SUGESTOES).flat().slice(0, 4);
  return (
    <main className="mx-auto max-w-[1100px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="cockpit_coo"
        titulo="Perguntar ao Brain"
        pergunta="O que você quer saber da rede nesta semana?"
        descricao={
          busca.tema
            ? `Contexto: ${TEMAS[busca.tema].menu} · o Brain consulta os mesmos números da tela e confere cada número da resposta`
            : "O Brain consulta os mesmos números do cockpit e confere cada número da resposta"
        }
      />
      <ol className="space-y-4">
        {turnos.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[80%] rounded-xl bg-muted px-3 py-2 text-sm">{t.pergunta}</p>
            <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
              {t.resposta.estado !== "ok" && <StatusBadge tom="atencao">{t.resposta.estado === "sem_orcamento" ? "sem orçamento" : "sem resposta"}</StatusBadge>}
              <p className="whitespace-pre-line leading-relaxed">{t.resposta.texto}</p>
              {t.resposta.descartadas.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary>{t.resposta.descartadas.length} frase(s) retirada(s) por citar número sem origem nos dados</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {t.resposta.descartadas.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </details>
              )}
              {t.resposta.consultas.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Consultou:{" "}
                  {t.resposta.consultas
                    .map((c) =>
                      c.ferramenta === "ler_tema"
                        ? `${TEMAS[c.args.tema as Tema]?.menu ?? c.args.tema}`
                        : c.ferramenta === "ler_okrs"
                          ? `OKRs de ${TEMAS[c.args.tema as Tema]?.titulo ?? c.args.tema}`
                          : "compromissos",
                    )
                    .join(" · ")}
                  {t.resposta.modelo ? ` · ${t.resposta.modelo}` : ""}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) m.mutate(texto.trim());
        }}
      >
        <Label htmlFor="coo-pergunta">Sua pergunta</Label>
        <Textarea id="coo-pergunta" value={texto} maxLength={1000} rows={3} onChange={(e) => setTexto(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={m.isPending || !texto.trim()}>
            <Send className="mr-1 size-4" aria-hidden />
            {m.isPending ? "Consultando…" : "Perguntar"}
          </Button>
          {sugestoes.map((s) => (
            <Button key={s} type="button" size="sm" variant="outline" onClick={() => setTexto(s)}>
              {s}
            </Button>
          ))}
        </div>
        {m.error && <p className="text-sm text-danger">{(m.error as Error).message}</p>}
      </form>
    </main>
  );
}
