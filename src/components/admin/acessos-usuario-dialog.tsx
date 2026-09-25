import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Carregando, EstadoErro } from "@/components/planning";
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
import { buttonVariants } from "@/components/ui/button";
import {
  getAcessosDoUsuario,
  salvarAcessoNaArea,
  type AcessoPorArea,
  type NivelNaArea,
} from "@/lib/permissions.functions";
import { cn } from "@/lib/utils";

/**
 * Nível da pessoa em cada área: admin, sócio, usuário ou nada.
 *
 * É a tela do SUPER ADMIN (Fase 2 do PLANO-ADMIN-DELEGADO). Admin vê todas as
 * unidades e empresas da área; sócio vê a área inteira nas unidades dele;
 * usuário vê só as páginas marcadas e só consulta.
 *
 * Cada área salva sozinha, porque cada uma é uma chamada ao banco com as suas
 * próprias regras, e um erro numa não deve desfazer a outra.
 */
const NIVEIS: { valor: NivelNaArea; rotulo: string; ajuda: string }[] = [
  { valor: "nenhum", rotulo: "Sem acesso", ajuda: "Não entra nesta área." },
  {
    valor: "bloqueado",
    rotulo: "Bloquear esta área",
    ajuda: "A área some para esta pessoa, mesmo que o perfil dela abra. Só o super admin bloqueia.",
  },
  { valor: "usuario", rotulo: "Usuário", ajuda: "Vê só as páginas marcadas. Só consulta." },
  { valor: "socio", rotulo: "Sócio", ajuda: "Área inteira, nas unidades dele. Convida a equipe." },
  { valor: "admin", rotulo: "Admin", ajuda: "Área inteira, todas as unidades e empresas. Nomeia sócios." },
];

export function AcessosUsuarioDialog({
  userId,
  nome,
  porta,
  onClose,
}: {
  userId: string;
  nome: string;
  /**
   * A porta do Ops (`public.produto_acesso`), quando quem abre o diálogo pode
   * mexer nela. Fica aqui, e não numa janela própria, porque tudo que é do
   * Ops mora num lugar só: primeiro se a pessoa entra, depois o que ela faz
   * em cada área.
   */
  porta?: {
    tem: boolean;
    salvando: boolean;
    erro?: string | null;
    onDefinir: (conceder: boolean) => void;
  };
  onClose: () => void;
}) {
  const getFn = useServerFn(getAcessosDoUsuario);
  const q = useQuery({
    queryKey: ["acessos-usuario", userId],
    queryFn: () => getFn({ data: { userId } }),
  });
  const [revogarPorta, setRevogarPorta] = useState(false);

  // Se nenhuma outra área fica visível, tirar ou bloquear esta deixa a pessoa
  // sem área nenhuma. Visível segue `ops.acesso_do_usuario`: pelo perfil e não
  // bloqueada, ou por delegação (usuário, sócio, admin). O aviso sai antes de
  // salvar, com o que o diálogo já carregou.
  // Conta só áreas ATIVAS: `getAcessosDoUsuario` lista só `areas.ativa`. Uma
  // delegação numa área desativada não aparece aqui; é por isso que, raramente,
  // o banco pode discordar do aviso (o toast depois de salvar usa a resposta dele).
  const visivel = (a: AcessoPorArea) =>
    a.nivel === "usuario" ||
    a.nivel === "socio" ||
    a.nivel === "admin" ||
    (a.pelo_papel && a.nivel !== "bloqueado");
  const semOutraArea = (slug: string) =>
    (q.data?.areas ?? []).every((a) => a.slug === slug || !visivel(a));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-3xl rounded-xl border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Acessos de {nome}</h2>
            <p className="text-xs text-muted-foreground">
              Área por área, o que esta pessoa faz além do perfil dela. As unidades que ela vê
              ficam em "Recorte", na ficha.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {porta?.erro && (
          <p className="mx-5 mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {porta.erro}
          </p>
        )}

        {porta && (
          <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <p className="text-xs font-semibold text-foreground">
                {porta.tem ? "Entra no Ops" : "Não entra no Ops"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {porta.tem
                  ? "Fechar a porta não apaga nada do que está abaixo: reabrir devolve a pessoa como estava."
                  : "Sem a porta, nada do que estiver marcado abaixo tem efeito."}
              </p>
            </div>
            <button
              onClick={() => {
                if (porta.tem) setRevogarPorta(true);
                else porta.onDefinir(true);
              }}
              disabled={porta.salvando}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50",
                porta.tem
                  ? "border border-destructive/40 text-destructive hover:bg-destructive/10"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {porta.salvando ? "Salvando..." : porta.tem ? "Revogar acesso" : "Conceder acesso"}
            </button>
          </div>
        )}

        {q.isLoading ? (
          <Carregando variante="tabela" linhas={4} className="px-5 py-4" />
        ) : q.isError ? (
          <EstadoErro
            className="mx-5 my-4"
            titulo="Não foi possível carregar os acessos"
            detalhe={(q.error as Error)?.message}
            tentarNovamente={() => q.refetch()}
          />
        ) : q.data?.superAdmin ? (
          <div className="flex items-start gap-3 px-5 py-6">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-text" />
            <p className="text-sm text-foreground">
              Esta pessoa é <strong>super admin</strong> e tem acesso total. Isso vem do perfil
              Super admin, e não se altera por aqui.
            </p>
          </div>
        ) : (
          <>
            <div className="mx-5 mt-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-foreground">
              {(q.data?.papeis ?? []).length > 0 ? (
                <>
                  Perfil: <strong>{q.data?.papeis.join(", ")}</strong>. Ele já abre as áreas marcadas
                  com "pelo perfil". O que você escolher abaixo soma a isso.
                </>
              ) : (
                <>Sem perfil. Esta pessoa só entra no que for liberado abaixo.</>
              )}
            </div>
            {!q.data?.temUnidade && (
              <p className="mx-5 mt-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                Sem unidade no recorte. Para nomear como sócio, defina as unidades primeiro, em
                "Recorte" na ficha.
              </p>
            )}
            <ul className="divide-y">
              {[...(q.data?.areas ?? [])]
                .sort((x, y) => Number(y.pelo_papel || y.nivel !== "nenhum") - Number(x.pelo_papel || x.nivel !== "nenhum"))
                .map((a) => (
                <LinhaDaArea
                  key={a.slug}
                  userId={userId}
                  nome={nome}
                  area={a}
                  unicaArea={semOutraArea(a.slug)}
                />
              ))}
            </ul>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          >
            Fechar
          </button>
        </div>
      </div>

      {porta && (
        <AlertDialog open={revogarPorta} onOpenChange={setRevogarPorta}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revogar o Ops de {nome}?</AlertDialogTitle>
              <AlertDialogDescription>
                {nome} deixa de entrar no Ops no próximo carregamento. Nada do que está marcado
                nas áreas se apaga: conceder de novo devolve a pessoa como estava. Growth e
                Financeiro não mudam.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={() => porta.onDefinir(false)}
              >
                Revogar acesso
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function LinhaDaArea({
  userId,
  nome,
  area,
  unicaArea,
}: {
  userId: string;
  nome: string;
  area: AcessoPorArea;
  /** Nenhuma outra área fica visível: tirar ou bloquear esta deixa a pessoa sem área. */
  unicaArea: boolean;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(salvarAcessoNaArea);
  const [nivel, setNivel] = useState<NivelNaArea>(area.nivel);
  const [paginas, setPaginas] = useState<string[]>(area.liberadas);

  useEffect(() => {
    setNivel(area.nivel);
    setPaginas(area.liberadas);
  }, [area.nivel, area.liberadas]);

  const mudou =
    nivel !== area.nivel ||
    (nivel === "usuario" &&
      (paginas.length !== area.liberadas.length || paginas.some((p) => !area.liberadas.includes(p))));

  const mut = useMutation({
    mutationFn: () => saveFn({ data: { userId, area: area.slug, nivel, paginas } }),
    onSuccess: (r) => {
      const rotulo = NIVEIS.find((n) => n.valor === nivel)?.rotulo ?? nivel;
      const efeito =
        nivel === "nenhum" && area.nivel === "bloqueado"
          ? // "Sem acesso" numa área bloqueada só tira o bloqueio (salvarAcessoNaArea).
            `${area.nome} deixa de estar bloqueada para ${nome}${area.pelo_papel ? ", e volta a abrir pelo perfil" : ""}.`
          : nivel === "nenhum"
          ? `${nome} sai de ${area.nome}${area.pelo_papel ? " (fica o que o perfil abre)" : ""}.`
          : nivel === "bloqueado"
            ? `${area.nome} some para ${nome}, mesmo com o perfil abrindo.`
            : `${nome} passa a ${rotulo.toLowerCase()} em ${area.nome}.`;
      if (r.ficouSemArea)
        toast.warning(`${efeito} Ficou sem nenhuma área. Para desligá-la de tudo, use Desativar na ficha.`);
      else toast.success(`${efeito} Vale no próximo carregamento.`);
      qc.invalidateQueries({ queryKey: ["acessos-usuario", userId] });
      qc.invalidateQueries({ queryKey: ["area-admins"] });
      qc.invalidateQueries({ queryKey: ["ficha-pessoa", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar o acesso."),
  });

  const idBase = `acesso-${userId}-${area.slug}`;
  const visivelAntes =
    area.nivel === "usuario" ||
    area.nivel === "socio" ||
    area.nivel === "admin" ||
    (area.pelo_papel && area.nivel !== "bloqueado");

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-medium text-foreground">
            {area.nome}
            {area.nivel === "bloqueado" ? (
              <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold uppercase text-destructive">
                bloqueada
              </span>
            ) : (
              area.pelo_papel && (
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase text-primary-text">
                  área inteira pelo perfil
                </span>
              )
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {area.escopo === "unidade" ? "Recorte por unidade" : area.escopo === "empresa" ? "Recorte por empresa" : "Sem recorte"}
          </p>
        </div>
        <label htmlFor={`${idBase}-nivel`} className="sr-only">
          Nível em {area.nome}
        </label>
        <select
          id={`${idBase}-nivel`}
          value={nivel}
          onChange={(e) => {
            setNivel(e.target.value as NivelNaArea);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          title={NIVEIS.find((n) => n.valor === nivel)?.ajuda}
        >
          {NIVEIS
            // Bloquear só faz sentido onde o perfil abre a área (ou já está bloqueada).
            .filter((n) => n.valor !== "bloqueado" || area.pelo_papel || area.nivel === "bloqueado")
            .map((n) => (
              <option key={n.valor} value={n.valor}>
                {n.valor === "nenhum" && area.pelo_papel ? "Só o perfil" : n.rotulo}
              </option>
            ))}
        </select>
        <button
          onClick={() => mut.mutate()}
          disabled={!mudou || mut.isPending}
          aria-describedby={!mudou ? `${idBase}-motivo` : undefined}
          className="h-8 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {mut.isPending ? "Salvando..." : "Salvar"}
        </button>
        <span id={`${idBase}-motivo`} className="sr-only">
          Nada mudou nesta área.
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {nivel === "nenhum" && area.pelo_papel
          ? "Vê a área inteira pelo perfil. Nada a mais por delegação."
          : NIVEIS.find((n) => n.valor === nivel)?.ajuda}
      </p>

      {nivel === "usuario" && (
        <fieldset className="mt-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Páginas que vê
          </legend>
          {area.paginas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Esta área não tem páginas de consulta.</p>
          ) : (
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {area.paginas.map((p) => (
                <label key={p.key} htmlFor={`${idBase}-${p.key}`} className="flex items-center gap-2 text-xs">
                  <input
                    id={`${idBase}-${p.key}`}
                    type="checkbox"
                    checked={paginas.includes(p.key)}
                    onChange={() =>
                      setPaginas((l) => (l.includes(p.key) ? l.filter((x) => x !== p.key) : [...l, p.key]))
                    }
                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                  />
                  <span className={cn("truncate", area.negadas.includes(p.key) && "line-through opacity-60")}>
                    {p.label}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {mut.isError && (
        <p className="mt-2 text-xs text-destructive">{(mut.error as Error)?.message ?? "Erro ao salvar."}</p>
      )}
      {unicaArea &&
        mudou &&
        visivelAntes &&
        !(nivel === "usuario" || nivel === "socio" || nivel === "admin" || (area.pelo_papel && nivel !== "bloqueado")) && (
        <p aria-live="polite" className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Salvar deixa {nome} sem nenhuma área: ela entra e não vê nada. Se não precisa mais entrar,
          exclua a conta em Usuários.
        </p>
      )}
    </li>
  );
}
