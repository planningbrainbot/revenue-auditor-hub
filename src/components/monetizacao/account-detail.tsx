import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
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
import { ofertaRecon } from "@/lib/monetizacao/recon";
import type { Conta, Negocio } from "@/lib/monetizacao/types";
import { date, money, Notice, Panel } from "./common";

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
  const { user } = useAuth();
  const perms = usePermissions();
  const q = useQuery({
    queryKey: [
      "aquario-detail",
      user?.id,
      perms.can("view.contatos"),
      JSON.stringify(perms.escopo),
      account?.key,
    ],
    queryFn: () => fn({ data: { key: account!.key } }),
    enabled: !!account && !!user && !perms.loading,
    staleTime: 60_000,
  });
  const fieldNames: Record<string, string> = {
    cnpj: "CNPJ",
    pipedrive_id: "Vínculo Pipedrive",
    origem_venda: "Origem da venda",
    razao_social: "Razão social",
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
            {(account?.base?.cnpjs || q.data?.cnpjs)?.join(" · ") || "CNPJ a confirmar"}
          </DialogDescription>
        </DialogHeader>
        {account && (
          <div className="space-y-4">
            {account.base && (
              <Panel title="Cadastro e origem">
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <strong>Origem no Pipefy</strong>
                    <p>{account.base.declared_origin.join(" / ") || "Não declarada"}</p>
                  </div>
                  <div>
                    <strong>Cadastros vinculados</strong>
                    <p>
                      {account.base.empresa_ids.length} registros de empresa ·{" "}
                      {account.base.contact_count} pessoas · {account.base.omie_records} cadastros
                      Omie
                    </p>
                  </div>
                  <div>
                    <strong>Omie</strong>
                    <p>{account.base.omie_units.join(" / ") || "Sem vínculo identificado"}</p>
                  </div>
                  <div>
                    <strong>Última leitura do Pipefy</strong>
                    <p>{date(account.base.synced_at)}</p>
                  </div>
                </div>
                {!!account.base.pending_fields?.length && (
                  <Notice>
                    Campos a reconciliar com o Pipefy:{" "}
                    {account.base.pending_fields.map((k) => fieldNames[k] || k).join(", ")}. A
                    informação anterior foi preservada até a correção da fonte.
                  </Notice>
                )}
                {account.base.needs_source_correction && (
                  <Notice>
                    A regra determina{" "}
                    {account.base.origin === "antiga" ? "Base Antiga" : "Base Nova"}. O Pipefy ainda
                    precisa receber essa correção; a divergência permanece visível até a
                    confirmação.
                  </Notice>
                )}
                {!!account.base.origin_evidence?.contracts.length && (
                  <div className="mt-3 rounded-lg border p-3 text-xs">
                    <strong>Vigência inicial no Omie</strong>
                    <p className="mt-1 text-muted-foreground">
                      Primeira vigência por CNPJ. Renovações preservam a origem do relacionamento.
                    </p>
                    {account.base.origin_evidence.contracts.map((c) => (
                      <p key={c.cnpj} className="mt-2">
                        {c.cnpj} · {c.first_start.split("-").reverse().join("/")} · consultado em{" "}
                        {date(c.checked_at)}
                      </p>
                    ))}
                    <p className="mt-2 text-muted-foreground">{account.base.origin_reason}</p>
                  </div>
                )}
                {!!account.base.tax_evidence?.sources.length && (
                  <div className="mt-3 rounded-lg border p-3 text-xs">
                    <strong>Conferência do Simples</strong>
                    <p className="mt-1">
                      {account.base.tax_evidence.conflict
                        ? "Fontes divergem: revisar antes de prospectar."
                        : account.base.tax_evidence.non_simples === true
                          ? "Fora do Simples confirmado para os CNPJs da conta."
                          : account.base.tax_evidence.non_simples === false
                            ? "Optante pelo Simples."
                            : "Cobertura incompleta: regime a confirmar."}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {account.base.tax_evidence.sources.join(" / ")} ·{" "}
                      {date(account.base.tax_evidence.checked_at)}
                    </p>
                  </div>
                )}
                {account.base.validated_at && (
                  <p className="mt-3 text-xs">
                    Validado com {account.base.responsible} em {date(account.base.validated_at)}.
                  </p>
                )}
              </Panel>
            )}
            <Panel title="Oportunidades desta empresa">
              <div className="space-y-3">
                {account.base_origin && (
                  <div className="rounded border p-2 text-xs">
                    <strong>Origem da carteira</strong>
                    <p className="mt-1">{account.base_origin.reason}</p>
                    <p className="mt-1 text-muted-foreground">
                      Fonte: {account.base_origin.source}
                    </p>
                  </div>
                )}
                <div>
                  <strong className="text-sm">Recon</strong>
                  <p className="text-xs text-muted-foreground">{ofertaRecon(account).reason}</p>
                  {account.recon && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Contratos conferidos em {date(account.recon.checked_at)} ·{" "}
                      {account.recon.products.join(" · ") || "Serviços a confirmar"}
                      {account.recon.revenue_label && (
                        <p className="mt-2">Faturamento Recon: {account.recon.revenue_label}</p>
                      )}
                      {account.recon.revenue_sources?.map((source) => (
                        <p className="mt-1" key={source}>
                          {source}
                        </p>
                      ))}
                      {!!account.recon.identity_note_ids?.length && (
                        <p className="mt-1">
                          Identificação conferida nas notas CRM:{" "}
                          {account.recon.identity_note_ids.join(", ")}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {account.consultoria_origin && (
                  <div className="rounded border p-2 text-xs">
                    <strong>Origem para Consultoria</strong>
                    <p className="mt-1 text-muted-foreground">
                      {account.consultoria_origin.reason}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Conferido em {date(account.consultoria_origin.checked_at)} ·{" "}
                      {account.consultoria_origin.regime_source || "Regime ainda não confirmado"}
                    </p>
                  </div>
                )}
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
            {account.driva && (
              <Panel title="Dados Driva">
                <p className="mb-3 text-xs text-muted-foreground">
                  {account.driva.source} · consulta em {date(account.driva.queried_at)} ·{" "}
                  {account.driva.cnpjs_found} de {account.driva.cnpjs_total} CNPJs encontrados.
                  Faturamentos são estimativas do fornecedor; não substituem a receita declarada.
                </p>
                {account.driva.status === "missing_cnpj" ? (
                  <Notice>Falta CNPJ para consultar esta conta.</Notice>
                ) : q.isPending ? (
                  <p className="text-sm">Carregando evidências…</p>
                ) : q.error ? (
                  <Notice>{q.error.message}</Notice>
                ) : (
                  <div className="space-y-3">
                    {q.data?.driva?.records.map((r) => (
                      <div key={r.cnpj} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">CNPJ {r.cnpj}</p>
                        {r.status !== "enriched" && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                            {r.status === "invalid_cnpj"
                              ? "CNPJ inválido no cadastro"
                              : r.status === "not_found"
                                ? "Não encontrado na Driva"
                                : r.status === "conflict"
                                  ? "Dados divergentes · confirmar antes de qualificar"
                                  : "Consulta pendente"}
                          </p>
                        )}
                        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <dt className="text-xs text-muted-foreground">Regime tributário</dt>
                            <dd>
                              {r.regime ||
                                (r.non_simples === true
                                  ? "Fora do Simples · regime específico não informado"
                                  : "Não confirmado")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Simples / MEI</dt>
                            <dd>
                              {r.simples === true
                                ? "Optante do Simples"
                                : r.simples === false
                                  ? "Não optante do Simples"
                                  : "Simples não informado"}{" "}
                              ·{" "}
                              {r.mei === true
                                ? "MEI"
                                : r.mei === false
                                  ? "Não MEI"
                                  : "MEI não informado"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              Faturamento estimado · estabelecimento
                            </dt>
                            <dd>
                              {r.revenue_estimate ? money(r.revenue_estimate) : "Não informado"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              Faturamento estimado · grupo Driva
                            </dt>
                            <dd>
                              {r.group_revenue_band || "Faixa não informada"}
                              {r.group_revenue_estimate
                                ? ` · ${money(r.group_revenue_estimate)}`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Atividade / CNAE</dt>
                            <dd>{r.cnae || r.segment || "Não informado"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Situação cadastral</dt>
                            <dd>{r.registration_status || "Não informada"}</dd>
                          </div>
                        </dl>
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          Consulta: {date(r.queried_at)}. Referência dos dados:{" "}
                          {r.source_updated_at
                            ? date(r.source_updated_at)
                            : "não informada pelo fornecedor"}
                          .
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
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
              {account.base?.ecd.length
                ? account.base.ecd.map((e) => `${e.cnpj} · ${e.year} · ${e.source}`).join("; ")
                : "sem metadado confirmado por CNPJ e exercício"}
              . Cadastro apurado em {date(q.data?.updated_at)}.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
