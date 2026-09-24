import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Carregando, EstadoErro, EstadoVazio, StatusBadge } from "@/components/planning";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { usePermissions } from "@/hooks/use-permissions";
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

const msgErro = (e: unknown) => (e instanceof Error ? e.message : "erro desconhecido");

function EquipePage() {
  const areasFn = useServerFn(minhasAreasAdministradas);
  const areasQ = useQuery({ queryKey: ["equipe-areas"], queryFn: () => areasFn() });
  // A área escolhida mora na URL (N7): recarregar ou colar o link volta nela.
  const [areaSel, setAreaSel] = useFiltroNaUrl("area", "");

  const areas = areasQ.data ?? [];
  const area = areas.find((a) => a.slug === areaSel) ?? areas[0];

  return (
    <AppShell
      title="Equipes"
      pergunta="Quem está na minha área, e com qual acesso?"
      subtitle={
        <>
          {areasQ.data ? `${areas.length} ${areas.length === 1 ? "área administrada" : "áreas administradas"} · ` : ""}
          Convidar dá acesso e envia e-mail com o link de entrada. Tirar alguém da área corta o
          acesso dele a ela; quem fica sem nenhuma área perde a entrada no Ops.
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        {areasQ.isLoading ? (
          <Carregando variante="tabela" />
        ) : areasQ.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar as áreas que você administra"
            detalhe={msgErro(areasQ.error)}
            tentarNovamente={() => areasQ.refetch()}
          />
        ) : !area ? (
          <EstadoVazio
            titulo="Você não administra nenhuma área"
            descricao="Quem nomeia sócios é o admin da área, e quem nomeia admins é o super admin."
          />
        ) : (
          <>
            {areas.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Áreas que você administra">
                {areas.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    aria-pressed={a.slug === area.slug}
                    onClick={() => setAreaSel(a.slug === areas[0].slug ? "" : a.slug)}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs transition-colors duration-120 ease-planning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      a.slug === area.slug
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-foreground hover:bg-muted",
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
        <Button size="sm" onClick={() => setConvidando((v) => !v)} aria-expanded={convidando}>
          <UserPlus />
          Convidar pessoa
        </Button>
      </div>

      {convidando && <Convite area={area} onFim={() => setConvidando(false)} />}

      {q.isLoading ? (
        <Carregando variante="tabela" />
      ) : q.isError ? (
        <EstadoErro
          titulo="Não foi possível carregar a equipe"
          detalhe={msgErro(q.error)}
          tentarNovamente={() => q.refetch()}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EstadoVazio
          titulo="Ninguém na sua equipe ainda"
          descricao="Use “Convidar pessoa” para dar acesso a alguém."
        />
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
            <Checkbox
              id={`${id}-${p.key}`}
              checked={valor.includes(p.key)}
              onCheckedChange={() => onChange(valor.includes(p.key) ? valor.filter((x) => x !== p.key) : [...valor, p.key])}
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
      if (r.jaExistia) {
        setResultado(`${nome} já tinha conta e agora entra em ${area.nome}.`);
        toast.success(`${nome} já tinha conta e agora entra em ${area.nome}.`);
      } else if (r.emailEnviado) {
        setResultado(`Convite enviado para ${email}.`);
        toast.success(`Convite enviado para ${email}. A pessoa entra pelo link do e-mail.`);
      } else {
        setResultado(`Acesso criado, mas o e-mail não saiu (${r.emailErro ?? "erro desconhecido"}). Envie o link abaixo.`);
        toast.warning(`Acesso de ${nome} criado, mas o e-mail não saiu. Envie o link que aparece no formulário.`);
      }
      setLink(r.link);
      setNome("");
      setEmail("");
      setPaginas([]);
    },
    onError: (e) => toast.error(`Não foi possível convidar ${nome || "a pessoa"}: ${msgErro(e)}`),
  });

  const id = `convite-${area.slug}`;
  const falta = !nome.trim() ? "Informe o nome." : !email.includes("@") ? "Informe o e-mail." : unidades.length === 0 ? "Escolha a unidade." : paginas.length === 0 ? "Marque pelo menos uma página." : null;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-nome`} className="text-xs">
          <span className="mb-1 block font-medium">Nome</span>
          <Input
            id={`${id}-nome`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-email`} className="text-xs">
          <span className="mb-1 block font-medium">E-mail</span>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unidade</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {area.unidades.map((u) => (
            <label key={u.id} htmlFor={`${id}-un-${u.id}`} className="flex items-center gap-2 text-xs">
              <Checkbox
                id={`${id}-un-${u.id}`}
                checked={unidades.includes(u.id)}
                onCheckedChange={() => setUnidades((l) => (l.includes(u.id) ? l.filter((x) => x !== u.id) : [...l, u.id]))}
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
        <Button variant="ghost" size="sm" onClick={onFim}>
          Fechar
        </Button>
        <Button size="sm" onClick={() => mut.mutate()} disabled={!!falta || mut.isPending}>
          <Mail />
          {mut.isPending ? "Enviando…" : "Enviar convite"}
        </Button>
      </div>
    </div>
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
  const [confirmar, setConfirmar] = useState<"remover" | "nomear" | null>(null);
  // Níveis de acesso (/admin/niveis) só abre para admin do sistema; admin de área não chega lá.
  const { isAdmin } = usePermissions();

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
      toast.success(`Acesso de ${pessoa.nome} em ${area.nome} salvo.`);
      recarregar();
    },
    onError: (e) => toast.error(`Não foi possível salvar o acesso de ${pessoa.nome}: ${msgErro(e)}`),
  });
  const remover = useMutation({
    mutationFn: () => removerFn({ data: { userId: pessoa.userId, area: area.slug } }),
    onSuccess: (r) => {
      toast.success(
        r.contaDesativada
          ? `${pessoa.nome} saiu de ${area.nome}. A conta foi desativada porque não entra em mais nada.`
          : `${pessoa.nome} saiu de ${area.nome}.`,
      );
      setConfirmar(null);
      recarregar();
    },
    onError: (e) => toast.error(`Não foi possível tirar ${pessoa.nome} de ${area.nome}: ${msgErro(e)}`),
  });
  const nomear = useMutation({
    mutationFn: () => nomearFn({ data: { userId: pessoa.userId, area: area.slug } }),
    onSuccess: () => {
      toast.success(`${pessoa.nome} agora é sócio em ${area.nome}.`);
      setConfirmar(null);
      recarregar();
    },
    onError: (e) => toast.error(`Não foi possível nomear ${pessoa.nome} sócio: ${msgErro(e)}`),
  });
  const erro = (salvar.error ?? remover.error ?? nomear.error) as Error | null;
  const id = `pessoa-${pessoa.userId}`;
  const semPagina = pessoa.nivel === "usuario" && paginas.length === 0;
  // Só barra quando a pessoa tinha unidade e ficou sem: o servidor recusa lista vazia.
  const semUnidade = podeNomear && unidades.length === 0 && idsDasUnidades.length > 0;
  const motivoNomear = pessoa.unidades.length === 0 ? "Defina a unidade antes de nomear." : null;
  const motivoSalvar = semPagina ? "Escolha ao menos uma página." : semUnidade ? "Escolha ao menos uma unidade." : null;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-foreground">
            {pessoa.nome}
            {pessoa.nivel === "socio" && (
              <StatusBadge tom="neutro" icone={false} className="ml-2">
                Sócio
              </StatusBadge>
            )}
            {pessoa.pendente && (
              <StatusBadge tom="atencao" className="ml-2">
                Convite pendente
              </StatusBadge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {pessoa.email} · {pessoa.unidades.join(", ") || "sem unidade"}
            {pessoa.nivel === "usuario" && ` · ${pessoa.paginas.length} ${pessoa.paginas.length === 1 ? "página" : "páginas"}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls={`${id}-detalhe`}
        >
          {aberto ? "Fechar" : "Editar"}
        </Button>
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
                    <Checkbox
                      id={`${id}-un-${u.id}`}
                      checked={unidades.includes(u.id)}
                      onCheckedChange={() => setUnidades((l) => (l.includes(u.id) ? l.filter((x) => x !== u.id) : [...l, u.id]))}
                    />
                    {u.nome}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {erro && <p className="text-xs text-destructive">{erro.message}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmar("remover")}
              disabled={remover.isPending}
              className="mr-auto border-destructive/40 text-destructive hover:border-destructive hover:text-destructive"
            >
              {remover.isPending ? "Removendo…" : "Tirar da área"}
            </Button>
            {podeNomear && pessoa.nivel === "usuario" && (
              <>
                {motivoNomear && (
                  <span id={`${id}-motivo-nomear`} className="text-xs text-muted-foreground">
                    {motivoNomear}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmar("nomear")}
                  disabled={nomear.isPending || !!motivoNomear}
                  aria-describedby={motivoNomear ? `${id}-motivo-nomear` : undefined}
                >
                  {nomear.isPending ? "Nomeando…" : "Nomear sócio"}
                </Button>
              </>
            )}
            {(pessoa.nivel === "usuario" || podeNomear) && (
              <>
                {motivoSalvar && (
                  <span id={`${id}-motivo-salvar`} className="text-xs text-muted-foreground">
                    {motivoSalvar}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={() => salvar.mutate()}
                  disabled={salvar.isPending || !!motivoSalvar}
                  aria-describedby={motivoSalvar ? `${id}-motivo-salvar` : undefined}
                >
                  {salvar.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          {confirmar === "nomear" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Nomear {pessoa.nome} sócio de {area.nome}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pessoa.nome} deixa de ver só as {pessoa.paginas.length}{" "}
                  {pessoa.paginas.length === 1 ? "página escolhida" : "páginas escolhidas"} e passa a ver a
                  área inteira nas unidades dele ({pessoa.unidades.join(", ") || "sem unidade"}). Passa também
                  a convidar pessoas para essas unidades e a escolher o que cada uma vê. {isAdmin
                    ? "Para desfazer, só tirando da área ou em Níveis de acesso."
                    : "Para desfazer, tire da área."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={nomear.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    nomear.mutate();
                  }}
                >
                  {nomear.isPending ? "Nomeando…" : "Nomear sócio"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Tirar {pessoa.nome} de {area.nome}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pessoa.nome} perde o acesso a {area.nome}. Se não estiver em nenhuma outra área, perde
                  também a entrada no Ops; se não tiver acesso a nenhum outro produto, a conta é desativada.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={remover.isPending}
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={(e) => {
                    e.preventDefault();
                    remover.mutate();
                  }}
                >
                  {remover.isPending ? "Removendo…" : "Tirar da área"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
