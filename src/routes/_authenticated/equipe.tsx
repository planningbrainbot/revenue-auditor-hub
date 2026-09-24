import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Mail, UserPlus, Users, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  convidarParaEquipe,
  definirPaginasEquipe,
  definirUnidadesEquipe,
  listEquipe,
  minhasAreasAdministradas,
  nomearSocioDaArea,
  removerDaEquipe,
  type AreaAdministrada,
  type PessoaDaEquipe,
} from "@/lib/equipe.functions";
import {
  aprovarPedidoAcesso,
  listPedidosAcesso,
  recusarPedidoAcesso,
  type PedidoDeAcesso,
} from "@/lib/pedidos-acesso.functions";
import { cn } from "@/lib/utils";

/**
 * Minha equipe: onde o admin e o sócio administram quem está abaixo deles
 * (Fase 3 do PLANO-ADMIN-DELEGADO).
 *
 * Sócio: convida colaboradores para as unidades dele e escolhe as páginas que
 * cada um vê. Usuário só consulta, então só aparecem páginas de consulta.
 * Admin: tudo isso em todas as unidades, e ainda nomeia sócios.
 *
 * A tela não decide nada: quem recusa é o banco, e a mensagem dele aparece
 * aqui como veio.
 */
export const Route = createFileRoute("/_authenticated/equipe")({
  ssr: false,
  head: () => ({ meta: [{ title: "Minha equipe – Planning" }] }),
  component: EquipePage,
});

function EquipePage() {
  const areasFn = useServerFn(minhasAreasAdministradas);
  const areasQ = useQuery({ queryKey: ["equipe-areas"], queryFn: () => areasFn() });
  const [areaSel, setAreaSel] = useState<string | null>(null);

  const areas = areasQ.data ?? [];
  const area = areas.find((a) => a.slug === areaSel) ?? areas[0];

  return (
    <AppShell title="Minha equipe" subtitle="Quem da sua equipe entra, em quais unidades e o que cada um vê.">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        {areasQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : areasQ.isError ? (
          <p className="text-sm text-destructive">{(areasQ.error as Error).message}</p>
        ) : !area ? (
          <div className="flex items-start gap-3 rounded-xl border bg-card p-5">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">Você não administra nenhuma área.</p>
              <p className="mt-1 text-muted-foreground">
                Quem nomeia sócios é o admin da área, e quem nomeia admins é o super admin.
              </p>
            </div>
          </div>
        ) : (
          <>
            {areas.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Áreas que você administra">
                {areas.map((a) => (
                  <button
                    key={a.slug}
                    role="tab"
                    aria-selected={a.slug === area.slug}
                    onClick={() => setAreaSel(a.slug)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      a.slug === area.slug
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    {a.nome}
                  </button>
                ))}
              </div>
            )}
            <Equipe key={area.slug} area={area} />
          </>
        )}
      </div>
    </AppShell>
  );
}

const ROTULO_NIVEL: Record<AreaAdministrada["nivel"], string> = {
  super_admin: "super admin",
  admin: "admin",
  socio: "sócio",
};

function Equipe({ area }: { area: AreaAdministrada }) {
  const listFn = useServerFn(listEquipe);
  const q = useQuery({
    queryKey: ["equipe", area.slug],
    queryFn: () => listFn({ data: { area: area.slug } }),
  });
  const [convidando, setConvidando] = useState(false);
  const podeNomear = area.nivel !== "socio";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{area.nome}</h2>
          <p className="text-xs text-muted-foreground">
            Você é {ROTULO_NIVEL[area.nivel]} nesta área
            {area.nivel === "socio" ? ` · ${area.unidades.map((u) => u.nome).join(", ")}` : " · todas as unidades"}.
          </p>
        </div>
        <button
          onClick={() => setConvidando((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Convidar pessoa
        </button>
      </div>

      <Pedidos area={area} />

      {convidando && <Convite area={area} onFim={() => setConvidando(false)} />}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando a equipe...</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ninguém na sua equipe ainda. Use "Convidar pessoa" para dar acesso a alguém.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {(q.data ?? []).map((p) => (
            <Pessoa key={p.userId} pessoa={p} area={area} podeNomear={podeNomear} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SeletorPaginas({
  id,
  area,
  valor,
  onChange,
}: {
  id: string;
  area: AreaAdministrada;
  valor: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Páginas que vê (só consulta)
      </legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {area.paginas.map((p) => (
          <label key={p.key} htmlFor={`${id}-${p.key}`} className="flex items-center gap-2 text-xs">
            <input
              id={`${id}-${p.key}`}
              type="checkbox"
              checked={valor.includes(p.key)}
              onChange={() => onChange(valor.includes(p.key) ? valor.filter((x) => x !== p.key) : [...valor, p.key])}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            <span className="truncate">{p.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Convite({ area, onFim }: { area: AreaAdministrada; onFim: () => void }) {
  const qc = useQueryClient();
  const convidarFn = useServerFn(convidarParaEquipe);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [unidades, setUnidades] = useState<number[]>(area.unidades.length === 1 ? [area.unidades[0].id] : []);
  const [paginas, setPaginas] = useState<string[]>([]);
  const [resultado, setResultado] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => convidarFn({ data: { area: area.slug, nome, email, unidades, paginas } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["equipe", area.slug] });
      if (r.jaExistia) setResultado(`${nome} já tinha conta e agora entra em ${area.nome}.`);
      else if (r.emailEnviado) setResultado(`Convite enviado para ${email}.`);
      else setResultado(`Acesso criado, mas o e-mail não saiu (${r.emailErro ?? "erro desconhecido"}). Envie o link abaixo.`);
      setLink(r.link);
      setNome("");
      setEmail("");
      setPaginas([]);
    },
  });

  const id = `convite-${area.slug}`;
  const falta = !nome.trim() ? "Informe o nome." : !email.includes("@") ? "Informe o e-mail." : unidades.length === 0 ? "Escolha a unidade." : paginas.length === 0 ? "Marque pelo menos uma página." : null;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-nome`} className="text-xs">
          <span className="mb-1 block font-medium">Nome</span>
          <input
            id={`${id}-nome`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label htmlFor={`${id}-email`} className="text-xs">
          <span className="mb-1 block font-medium">E-mail</span>
          <input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unidade</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {area.unidades.map((u) => (
            <label key={u.id} htmlFor={`${id}-un-${u.id}`} className="flex items-center gap-2 text-xs">
              <input
                id={`${id}-un-${u.id}`}
                type="checkbox"
                checked={unidades.includes(u.id)}
                onChange={() => setUnidades((l) => (l.includes(u.id) ? l.filter((x) => x !== u.id) : [...l, u.id]))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              {u.nome}
            </label>
          ))}
        </div>
      </fieldset>

      <SeletorPaginas id={id} area={area} valor={paginas} onChange={setPaginas} />

      {mut.isError && <p className="text-xs text-destructive">{(mut.error as Error).message}</p>}
      {resultado && <p className="text-xs text-primary-text">{resultado}</p>}
      {link && (
        <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">{link}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        {falta && <span className="mr-auto text-xs text-muted-foreground">{falta}</span>}
        <button onClick={onFim} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent">
          Fechar
        </button>
        <button
          onClick={() => mut.mutate()}
          disabled={!!falta || mut.isPending}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Mail className="h-3.5 w-3.5" />
          {mut.isPending ? "Enviando..." : "Enviar convite"}
        </button>
      </div>
    </div>
  );
}

/**
 * Pedidos de quem se cadastrou em /cadastro, das unidades desta área que eu
 * alcanço. Só aparecem depois que a pessoa definiu a senha (o banco esconde os
 * outros). Aprovar é o mesmo que convidar: mesma função, mesma não escalada.
 */
function Pedidos({ area }: { area: AreaAdministrada }) {
  const listFn = useServerFn(listPedidosAcesso);
  const q = useQuery({ queryKey: ["pedidos-acesso"], queryFn: () => listFn() });
  const minhas = new Set(area.unidades.map((u) => u.id));
  const pedidos = (q.data ?? []).filter((p) => minhas.has(p.unidadeId));
  if (!pedidos.length) return null;

  return (
    <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {pedidos.length === 1 ? "1 pedido de acesso" : `${pedidos.length} pedidos de acesso`}
      </h3>
      <ul className="divide-y rounded-lg border bg-card">
        {pedidos.map((p) => (
          <Pedido key={p.id} pedido={p} area={area} />
        ))}
      </ul>
    </div>
  );
}

function Pedido({ pedido, area }: { pedido: PedidoDeAcesso; area: AreaAdministrada }) {
  const qc = useQueryClient();
  const aprovarFn = useServerFn(aprovarPedidoAcesso);
  const recusarFn = useServerFn(recusarPedidoAcesso);
  const [aberto, setAberto] = useState<"aprovar" | "recusar" | null>(null);
  const [paginas, setPaginas] = useState<string[]>([]);
  const [motivo, setMotivo] = useState("");

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["pedidos-acesso"] });
    qc.invalidateQueries({ queryKey: ["equipe", area.slug] });
  };
  const aprovar = useMutation({
    mutationFn: () =>
      aprovarFn({ data: { pedidoId: pedido.id, area: area.slug, unidades: [pedido.unidadeId], paginas } }),
    onSuccess: recarregar,
  });
  const recusar = useMutation({
    mutationFn: () => recusarFn({ data: { pedidoId: pedido.id, motivo } }),
    onSuccess: recarregar,
  });
  const erro = (aprovar.error ?? recusar.error) as Error | null;
  const id = `pedido-${pedido.id}`;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-foreground">
            {pedido.nome} <span className="font-normal text-muted-foreground">· {pedido.cargo}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {pedido.email} · {pedido.unidade} · pediu em {new Date(pedido.criadoEm).toLocaleDateString("pt-BR")}
          </p>
          {pedido.observacao && <p className="mt-1 text-xs italic text-muted-foreground">"{pedido.observacao}"</p>}
        </div>
        <button
          onClick={() => setAberto(aberto === "recusar" ? null : "recusar")}
          aria-expanded={aberto === "recusar"}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
          Recusar
        </button>
        <button
          onClick={() => setAberto(aberto === "aprovar" ? null : "aprovar")}
          aria-expanded={aberto === "aprovar"}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          <Check className="h-3.5 w-3.5" />
          Liberar acesso
        </button>
      </div>

      {aberto === "aprovar" && (
        <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Entra em {area.nome}, na unidade {pedido.unidade}. Escolha o que {pedido.nome.split(" ")[0]} vê.
          </p>
          <SeletorPaginas id={id} area={area} valor={paginas} onChange={setPaginas} />
          {erro && <p className="text-xs text-destructive">{erro.message}</p>}
          <div className="flex justify-end">
            <button
              onClick={() => aprovar.mutate()}
              disabled={paginas.length === 0 || aprovar.isPending}
              className="rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {aprovar.isPending ? "Liberando..." : "Liberar e avisar por e-mail"}
            </button>
          </div>
        </div>
      )}

      {aberto === "recusar" && (
        <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
          <label htmlFor={`${id}-motivo`} className="block text-xs">
            <span className="mb-1 block font-medium">Motivo (vai no e-mail para a pessoa, opcional)</span>
            <input
              id={`${id}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          {erro && <p className="text-xs text-destructive">{erro.message}</p>}
          <div className="flex justify-end">
            <button
              onClick={() => recusar.mutate()}
              disabled={recusar.isPending}
              className="rounded-full border border-destructive/40 px-4 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              {recusar.isPending ? "Recusando..." : "Recusar pedido"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Pessoa({ pessoa, area, podeNomear }: { pessoa: PessoaDaEquipe; area: AreaAdministrada; podeNomear: boolean }) {
  const qc = useQueryClient();
  const paginasFn = useServerFn(definirPaginasEquipe);
  const removerFn = useServerFn(removerDaEquipe);
  const nomearFn = useServerFn(nomearSocioDaArea);
  const unidadesFn = useServerFn(definirUnidadesEquipe);
  const [aberto, setAberto] = useState(false);
  const [paginas, setPaginas] = useState(pessoa.paginas);
  const [unidades, setUnidades] = useState<number[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  const idsDasUnidades = useMemo(
    () => area.unidades.filter((u) => pessoa.unidades.includes(u.nome)).map((u) => u.id),
    [area.unidades, pessoa.unidades],
  );
  useEffect(() => {
    setPaginas(pessoa.paginas);
    setUnidades(idsDasUnidades);
  }, [pessoa.paginas, idsDasUnidades]);

  const recarregar = () => qc.invalidateQueries({ queryKey: ["equipe", area.slug] });
  const salvar = useMutation({
    mutationFn: async () => {
      // Sócio vê a área inteira: não tem páginas para escolher.
      if (pessoa.nivel === "usuario") {
        await paginasFn({ data: { userId: pessoa.userId, area: area.slug, paginas } });
      }
      const mudouUnidade =
        podeNomear &&
        (unidades.length !== idsDasUnidades.length || unidades.some((u) => !idsDasUnidades.includes(u)));
      if (mudouUnidade) await unidadesFn({ data: { userId: pessoa.userId, unidades } });
    },
    onSuccess: () => {
      setAviso("Salvo.");
      recarregar();
    },
  });
  const remover = useMutation({
    mutationFn: () => removerFn({ data: { userId: pessoa.userId, area: area.slug } }),
    onSuccess: (r) => {
      setAviso(r.contaDesativada ? "Removida. A conta foi desativada porque não entra em mais nada." : "Removida da área.");
      recarregar();
    },
  });
  const nomear = useMutation({
    mutationFn: () => nomearFn({ data: { userId: pessoa.userId, area: area.slug } }),
    onSuccess: () => {
      setAviso(`${pessoa.nome} agora é sócio nesta área.`);
      recarregar();
    },
  });
  const erro = (salvar.error ?? remover.error ?? nomear.error) as Error | null;
  const id = `pessoa-${pessoa.userId}`;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-foreground">
            {pessoa.nome}
            {pessoa.nivel === "socio" && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase text-primary-text">
                sócio
              </span>
            )}
            {pessoa.pendente && (
              <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold uppercase text-warning">
                convite pendente
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {pessoa.email} · {pessoa.unidades.join(", ") || "sem unidade"}
            {pessoa.nivel === "usuario" && ` · ${pessoa.paginas.length} ${pessoa.paginas.length === 1 ? "página" : "páginas"}`}
          </p>
        </div>
        <button
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls={`${id}-detalhe`}
          className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
        >
          {aberto ? "Fechar" : "Editar"}
        </button>
      </div>

      {aberto && (
        <div id={`${id}-detalhe`} className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
          {pessoa.nivel === "socio" ? (
            <p className="text-xs text-muted-foreground">Sócio vê a área inteira nas unidades dele.</p>
          ) : (
            <SeletorPaginas id={id} area={area} valor={paginas} onChange={setPaginas} />
          )}

          {podeNomear && (
            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unidades</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {area.unidades.map((u) => (
                  <label key={u.id} htmlFor={`${id}-un-${u.id}`} className="flex items-center gap-2 text-xs">
                    <input
                      id={`${id}-un-${u.id}`}
                      type="checkbox"
                      checked={unidades.includes(u.id)}
                      onChange={() => setUnidades((l) => (l.includes(u.id) ? l.filter((x) => x !== u.id) : [...l, u.id]))}
                      className="h-3.5 w-3.5 rounded border-input accent-primary"
                    />
                    {u.nome}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {erro && <p className="text-xs text-destructive">{erro.message}</p>}
          {aviso && <p className="text-xs text-primary-text">{aviso}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => {
                if (window.confirm(`Tirar ${pessoa.nome} de ${area.nome}?`)) remover.mutate();
              }}
              disabled={remover.isPending}
              className="mr-auto rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              {remover.isPending ? "Removendo..." : "Tirar da área"}
            </button>
            {podeNomear && pessoa.nivel === "usuario" && (
              <button
                onClick={() => nomear.mutate()}
                disabled={nomear.isPending}
                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-40"
              >
                {nomear.isPending ? "Nomeando..." : "Nomear sócio"}
              </button>
            )}
            {(pessoa.nivel === "usuario" || podeNomear) && (
              <button
                onClick={() => salvar.mutate()}
                disabled={salvar.isPending || (pessoa.nivel === "usuario" && paginas.length === 0)}
                className="rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {salvar.isPending ? "Salvando..." : "Salvar"}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
