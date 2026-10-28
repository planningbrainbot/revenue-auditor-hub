import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  StatusBadge,
} from "@/components/planning";
import { MultiSelect } from "@/components/monetizacao/multi-select";
import { number } from "@/components/monetizacao/common";
import { useAuth } from "@/hooks/use-auth";
import { fmtWhatsapp } from "@/lib/telefone";
import { decidirPedido, filaPedidos } from "@/lib/clientes/pedidos.functions";
import {
  mascararCnpj,
  mudouDesdeOPedido,
  NAO_RECONHECO,
  normalizarWhatsapp,
  quando,
  resumoDoPedido,
  situacaoDoPedido,
  TIPO_PEDIDO,
  type Pedido,
  type TipoPedido,
} from "@/lib/clientes/pedidos";
import { CHAVES_PEDIDOS, usePermissoesPedido } from "./pedidos-unidade";

// Pedidos das unidades (PRD de 28/10/2026, contrato `clientes.md`, adendo de 28/10). Fila de trabalho do CS: o que as
// unidades pediram para mudar na base. Nada vai ao Pipefy antes da aprovação, exceto o card de churn (R-12), que aparece
// em "Em andamento" só para consulta.

type Aba = "abertos" | "andamento" | "decididos";
const ABAS: [Aba, string][] = [
  ["abertos", "Para decidir"],
  ["andamento", "Em andamento"],
  ["decididos", "Decididos (90 dias)"],
];
// P-03: o CS responde em até 2 dias úteis; o pedido mais velho que isso fica destacado.
const atrasado = (p: Pedido) => {
  let dias = 0;
  const d = new Date(p.criado_em);
  const hoje = new Date();
  while (d < hoje) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6 && d <= hoje) dias++;
  }
  return dias > 2;
};

export function PedidosDasUnidades({
  aba,
  aoMudarAba,
}: {
  aba: Aba;
  aoMudarAba: (a: Aba) => void;
}) {
  const { user } = useAuth();
  const perms = usePermissoesPedido();
  const fn = useServerFn(filaPedidos);
  const q = useQuery({
    queryKey: [...CHAVES_PEDIDOS, "fila", user?.id, aba],
    queryFn: () => fn({ data: { situacao: aba } }),
    enabled: !!user && !!perms.data?.decidir,
    refetchInterval: 60_000,
  });
  const abertos = useQuery({
    queryKey: [...CHAVES_PEDIDOS, "fila", user?.id, "abertos"],
    queryFn: () => fn({ data: { situacao: "abertos" } }),
    enabled: !!user && !!perms.data?.decidir,
  });
  const [tipos, setTipos] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [analisar, setAnalisar] = useState<Pedido | null>(null);
  const lista = useMemo(
    () =>
      (q.data ?? []).filter(
        (p) =>
          (!tipos.length || tipos.includes(p.tipo)) &&
          (!unidades.length || unidades.includes(String(p.unidade_nome ?? ""))),
      ),
    [q.data, tipos, unidades],
  );
  const opcoesUnidade = [...new Set((q.data ?? []).map((p) => p.unidade_nome ?? ""))]
    .filter(Boolean)
    .sort();
  const header = (
    <PageHeader
      titulo="Pedidos das unidades"
      pergunta="O que as unidades pediram para mudar na base, e o que falta decidir?"
      descricao="Nada muda no Pipefy antes da aprovação, exceto o card de churn, que já nasce em Contatar ASAP. Responder em até 2 dias úteis."
      procedencia={{
        fonte: "Pedidos das unidades (ops.base_pedidos), gravados no Pipefy depois da aprovação",
      }}
    />
  );
  if (perms.isLoading)
    return (
      <main className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
        {header}
        <Carregando variante="tabela" />
      </main>
    );
  if (!perms.data?.decidir)
    return (
      <main className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
        {header}
        <EstadoSemAcesso oQueFalta="manage.base_pedidos, com o papel CS, diretor ou admin" />
      </main>
    );
  const abertosLista = abertos.data ?? [];
  return (
    <main className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
      {header}
      <KpiGrade colunas={3}>
        <KpiCard rotulo="Para decidir" valor={abertos.data ? number(abertosLista.length) : "…"} />
        <KpiCard
          rotulo="De contato"
          valor={
            abertos.data
              ? number(abertosLista.filter((p) => p.tipo.startsWith("contato_")).length)
              : "…"
          }
          nota="Prioridade: alimentam o NPS"
        />
        <KpiCard
          rotulo="Mais de 2 dias úteis"
          valor={abertos.data ? number(abertosLista.filter(atrasado).length) : "…"}
          tom={abertosLista.some(atrasado) ? "atencao" : undefined}
          nota="Prazo de resposta do CS"
        />
      </KpiGrade>
      <nav aria-label="Situação dos pedidos" className="flex gap-1 overflow-x-auto border-b">
        {ABAS.map(([k, rotulo]) => (
          <button
            key={k}
            type="button"
            aria-current={aba === k ? "page" : undefined}
            onClick={() => aoMudarAba(k)}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${aba === k ? "border-primary font-semibold text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {rotulo}
            {k === "abertos" && abertos.data ? ` (${abertosLista.length})` : ""}
          </button>
        ))}
      </nav>
      <BarraFiltros>
        <div className="w-56">
          <MultiSelect
            label="Tipo"
            placeholder="Todos os tipos"
            value={tipos}
            onChange={setTipos}
            options={(Object.keys(TIPO_PEDIDO) as TipoPedido[]).map((t) => ({
              value: t,
              label: TIPO_PEDIDO[t],
            }))}
          />
        </div>
        <div className="w-56">
          <MultiSelect
            label="Unidade"
            placeholder="Todas as unidades"
            value={unidades}
            onChange={setUnidades}
            options={opcoesUnidade.map((u) => ({ value: u, label: u }))}
          />
        </div>
      </BarraFiltros>
      {q.isLoading ? (
        <Carregando variante="tabela" />
      ) : q.error ? (
        <EstadoErro detalhe={(q.error as Error).message} tentarNovamente={() => void q.refetch()} />
      ) : !lista.length ? (
        <EstadoVazio
          titulo={
            aba === "abertos" ? "Nenhum pedido para decidir. Fila em dia." : "Nenhum pedido aqui"
          }
          total={q.data?.length || undefined}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Unidade</th>
                  <th className="px-4 py-3">O que muda</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const s = situacaoDoPedido(p);
                  return (
                    <tr key={p.id} className="border-t align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{TIPO_PEDIDO[p.tipo]}</div>
                        <div className="text-xs text-muted-foreground">
                          {quando(p.criado_em)}
                          {p.autor ? ` · ${p.autor}` : ""}
                        </div>
                        {p.situacao === "aberto" && p.tipo !== "churn" && atrasado(p) && (
                          <StatusBadge tom="atencao" className="mt-1">
                            Mais de 2 dias úteis
                          </StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">{p.conta_nome}</td>
                      <td className="px-4 py-3">{p.unidade_nome}</td>
                      <td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">
                        {resumoDoPedido(p)}
                        {mudouDesdeOPedido(p) && (
                          <StatusBadge tom="atencao" className="mt-1">
                            Mudou desde o pedido
                          </StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge>
                        {(p.motivo_recusa || (p.situacao === "erro" && p.erro)) && (
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                            {p.motivo_recusa ?? p.erro}
                          </p>
                        )}
                        {p.decisor && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.decisor} · {quando(p.decidido_em)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.tipo === "churn" ? (
                          p.pipefy_ref ? (
                            <a
                              className="text-sm text-primary-text underline"
                              href={`https://app.pipefy.com/open-cards/${p.pipefy_ref}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir a tratativa
                            </a>
                          ) : null
                        ) : p.situacao === "aberto" ? (
                          <Button size="sm" onClick={() => setAnalisar(p)}>
                            Analisar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <DialogDecidir pedido={analisar} fechar={() => setAnalisar(null)} />
    </main>
  );
}

function Valor({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "")
    return <span className="text-muted-foreground">vazio</span>;
  if (typeof v === "boolean") return <>{v ? "sim" : "não"}</>;
  return <>{String(v)}</>;
}

function DialogDecidir({ pedido, fechar }: { pedido: Pedido | null; fechar: () => void }) {
  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
        {pedido && <FormDecidir key={pedido.id} p={pedido} fechar={fechar} />}
      </DialogContent>
    </Dialog>
  );
}

function FormDecidir({ p, fechar }: { p: Pedido; fechar: () => void }) {
  const qc = useQueryClient();
  const fn = useServerFn(decidirPedido);
  const x = p.proposto;
  const contato = p.tipo === "contato_incluir" || p.tipo === "contato_editar";
  const [nome, setNome] = useState<string>(x.nome ?? "");
  const [wpp, setWpp] = useState<string>(fmtWhatsapp(x.whatsapp) ?? "");
  const [email, setEmail] = useState<string>(x.email ?? "");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const decidir = async (aprovar: boolean) => {
    setErro(null);
    if (!aprovar && motivo.trim().length < 10)
      return setErro("Escreva o motivo da recusa (10 letras ou mais). A unidade vê este texto.");
    let corrigido: Record<string, unknown> | null = null;
    if (aprovar && contato) {
      const w = normalizarWhatsapp(wpp);
      if ("erro" in w) return setErro(w.erro);
      if (
        nome.trim() !== x.nome ||
        w.valor !== x.whatsapp ||
        (email.trim() || null) !== (x.email ?? null)
      )
        corrigido = { nome: nome.trim(), whatsapp: w.valor, email: email.trim() };
    }
    setOcupado(true);
    try {
      await fn({ data: { id: p.id, aprovar, motivo: aprovar ? null : motivo.trim(), corrigido } });
      toast.success(
        aprovar
          ? "Aprovado. O envio grava no Pipefy em até um minuto."
          : "Pedido recusado. A unidade vê o motivo.",
      );
      void qc.invalidateQueries({ queryKey: CHAVES_PEDIDOS });
      fechar();
    } catch (e) {
      setErro((e as Error).message);
      void qc.invalidateQueries({ queryKey: CHAVES_PEDIDOS });
    } finally {
      setOcupado(false);
    }
  };
  const antes = p.foto?.contato ?? null;
  const agora = p.agora ?? null;
  const linhas: [string, string][] = [
    ["nome", "Nome"],
    ["cargo", "Cargo"],
    ["whatsapp", "WhatsApp"],
    ["email", "E-mail"],
    ["contato_nps", "Contato do NPS"],
  ];
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{TIPO_PEDIDO[p.tipo]}</DialogTitle>
        <DialogDescription>
          {p.conta_nome} · {p.unidade_nome} · pedido em {quando(p.criado_em)}
          {p.autor ? ` por ${p.autor}` : ""}
        </DialogDescription>
      </DialogHeader>
      {p.tipo.startsWith("contato_") && (
        <>
          {mudouDesdeOPedido(p) && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              O contato mudou na base desde o pedido: confira as três colunas antes de decidir.
            </p>
          )}
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 pr-3" />
                <th className="py-1 pr-3">Antes (no pedido)</th>
                {antes && <th className="py-1 pr-3">Agora</th>}
                <th className="py-1">Pedido</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(([k, rotulo]) => {
                const fmt = (v: unknown) =>
                  k === "whatsapp" && typeof v === "string" ? fmtWhatsapp(v) : v;
                const proposto =
                  p.tipo === "contato_desativar" || p.tipo === "contato_nps"
                    ? k === "contato_nps"
                      ? p.tipo === "contato_nps"
                      : antes?.[k]
                    : x[k];
                return (
                  <tr key={k} className="border-t">
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{rotulo}</td>
                    <td className="py-1.5 pr-3">{antes ? <Valor v={fmt(antes[k])} /> : "novo"}</td>
                    {antes && (
                      <td className="py-1.5 pr-3">
                        <Valor v={fmt(agora?.[k])} />
                      </td>
                    )}
                    <td className="py-1.5 font-medium">
                      <Valor v={fmt(proposto)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {p.tipo === "contato_desativar" && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              Desativar: {x.motivo}. O registro fica no Stakeholder com "Situação do contato:
              Inativo".
            </p>
          )}
          {p.tipo === "contato_incluir" && (
            <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
              Aprovar procura no Stakeholder um registro deste cliente com o mesmo WhatsApp: se
              achar, atualiza; se não, cria um registro ligado ao cliente.
            </p>
          )}
          {x.contato_nps && (
            <p className="text-xs text-muted-foreground">
              Vira o contato do NPS: os outros contatos deste cliente ficam "Não".
            </p>
          )}
          {contato && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Corrigir antes de aprovar
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="cs-nome">Nome</Label>
                  <Input id="cs-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cs-wpp">WhatsApp</Label>
                  <Input id="cs-wpp" value={wpp} onChange={(e) => setWpp(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cs-email">E-mail</Label>
                  <Input id="cs-email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
            </details>
          )}
        </>
      )}
      {p.tipo === "nao_reconheco" && (
        <>
          <p>
            <strong>
              {x.motivo === "outra_unidade"
                ? `É cliente de ${x.unidade_nome}`
                : x.motivo === "mesma_empresa"
                  ? `Mesma empresa que ${x.conta_nome}`
                  : NAO_RECONHECO.nunca}
            </strong>
          </p>
          {x.obs && <p className="text-sm text-muted-foreground">{x.obs}</p>}
          <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
            {x.motivo === "outra_unidade"
              ? `Aprovar troca a unidade do cliente para ${x.unidade_nome} na base Empresas do Pipefy. Apuração já fechada não muda.`
              : x.motivo === "mesma_empresa"
                ? "Aprovar só registra: juntar as duas linhas segue o fluxo de dedup da matriz."
                : 'Aprovar marca "Situação do cadastro: Não é cliente" em Empresas, e a conta sai da Base.'}
          </p>
        </>
      )}
      {p.tipo === "cliente_incluir" && (
        <>
          <p>
            {x.razao_social}
            {x.nome_fantasia ? ` (${x.nome_fantasia})` : ""} · CNPJ {mascararCnpj(x.cnpj)}
            {x.cidade ? ` · ${x.cidade}/${x.uf}` : ""}
            {x.desde ? ` · cliente desde ${String(x.desde).split("-").reverse().join("/")}` : ""}
          </p>
          {x.situacao_receita && (
            <p className="text-sm text-muted-foreground">
              Situação na Receita: {x.situacao_receita}
            </p>
          )}
          {!!p.filhos?.length && (
            <div className="text-sm">
              <p className="font-medium">Contatos incluídos ({p.filhos.length})</p>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {p.filhos.map((f) => (
                  <li key={f.id}>
                    {f.proposto.nome} · {fmtWhatsapp(f.proposto.whatsapp)}
                    {f.proposto.contato_nps ? " · contato do NPS" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
            Confira no Omie e na Central de Contratos. Aprovar cria o registro em Empresas com a
            fonte "Declarado pela unidade" (ou só vincula, se o CNPJ já existir) e os contatos
            acima.
          </p>
        </>
      )}
      <div className="space-y-1">
        <Label htmlFor="cs-motivo">Motivo da recusa</Label>
        <Textarea
          id="cs-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Obrigatório para recusar. A unidade vê este texto."
        />
      </div>
      {erro && (
        <p className="text-sm text-danger" role="alert">
          {erro}
        </p>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          className="text-danger"
          disabled={ocupado}
          onClick={() => void decidir(false)}
        >
          Recusar
        </Button>
        <Button disabled={ocupado} onClick={() => void decidir(true)}>
          Aprovar e gravar
        </Button>
      </DialogFooter>
    </div>
  );
}
