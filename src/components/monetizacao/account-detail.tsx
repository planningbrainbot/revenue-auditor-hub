import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { detalheAquario } from "@/lib/monetizacao/functions";
import { negociosDaConta, oferta } from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { Conta, Negocio } from "@/lib/monetizacao/types";
import { date, Notice, Panel } from "./common";

export function AccountDetail({
  account,
  cards,
  close,
}: {
  account: Conta | null;
  cards: Negocio[];
  close: () => void;
}) {
  const fn = useServerFn(detalheAquario);
  const q = useQuery({
    queryKey: ["aquario-detail", account?.key],
    queryFn: () => fn({ data: { key: account!.key } }),
    enabled: !!account,
    staleTime: 60_000,
  });
  const fieldNames: Record<string, string> = {
    segmento: "Segmento",
    regime: "Regime tributário",
    faixa: "Faturamento anual",
    origem_da_base: "Origem",
    unidade: "Unidade",
    uf: "UF",
  };
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{account?.name}</DialogTitle>
          <DialogDescription>
            {account?.unit_label || "Unidade a confirmar"} ·{" "}
            {q.data?.cnpjs?.join(" · ") || "CNPJ a confirmar"}
          </DialogDescription>
        </DialogHeader>
        {account && (
          <div className="space-y-4">
            <Panel title="Oportunidades desta empresa">
              <div className="space-y-3">
                {PRODUTOS.map((p) => {
                  const result = oferta(account, p);
                  return (
                    <div key={p}>
                      <strong className="text-sm">{NOMES[p]}</strong>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {result.status === "elegivel"
                          ? "Perfil aderente"
                          : result.status === "revisar"
                            ? "Confirmar dados"
                            : "Fora do perfil"}
                      </span>
                      <p className="text-xs text-muted-foreground">{result.reason}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>
            <Panel title="Cadastro e procedência">
              {q.isPending ? (
                <p className="text-sm">Carregando detalhes…</p>
              ) : q.error ? (
                <Notice>{q.error.message}</Notice>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  {Object.entries(q.data?.fields || {}).map(([key, f]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{fieldNames[key] || key}</dt>
                      <dd className="text-sm font-medium">{f.value || "Não informado"}</dd>
                      <dd className="text-xs text-muted-foreground">
                        {f.source || "Sem fonte"} · {date(f.at)}
                      </dd>
                      {f.conflict && (
                        <details className="mt-1 text-xs text-amber-600">
                          <summary>Fontes divergem</summary>
                          {f.alternatives?.map((a, i) => (
                            <p key={i}>
                              {a.value} · {a.source}
                            </p>
                          ))}
                        </details>
                      )}
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
            <Panel title="Contatos">
              {q.data?.contacts_restricted ? (
                <Notice>Seu perfil de acesso não permite consultar contatos.</Notice>
              ) : q.data?.contacts.length ? (
                <ul className="space-y-2 text-sm">
                  {q.data.contacts.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.value}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.type} · {c.source}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Contato a obter com o sócio. Isso não exclui a conta da avaliação para
                  Consultoria.
                </p>
              )}
            </Panel>
            <Panel title="No Pipedrive">
              {negociosDaConta(account, cards).length ? (
                <ul className="space-y-2">
                  {negociosDaConta(account, cards).map((c) => (
                    <li key={c.id} className="flex flex-wrap justify-between gap-1 text-sm">
                      <a
                        className="text-primary underline"
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.title}
                      </a>
                      <span className="text-xs text-muted-foreground">
                        {NOMES[c.route]} · {c.stage} · {c.owner}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem oportunidade vinculada no pipe de Monetização.
                </p>
              )}
            </Panel>
            <p className="text-xs text-muted-foreground">
              ECD:{" "}
              {q.data?.ecd_summary?.available
                ? `resumo disponível${q.data.ecd_summary.exercise ? " · exercício " + q.data.ecd_summary.exercise : ""}`
                : "sem resumo vinculado"}
              . Cadastro apurado em {date(q.data?.updated_at)}.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
