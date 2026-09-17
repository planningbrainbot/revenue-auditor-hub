import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, X } from "lucide-react";
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
  { valor: "usuario", rotulo: "Usuário", ajuda: "Vê só as páginas marcadas. Só consulta." },
  { valor: "socio", rotulo: "Sócio", ajuda: "Área inteira, nas unidades dele. Convida a equipe." },
  { valor: "admin", rotulo: "Admin", ajuda: "Área inteira, todas as unidades e empresas. Nomeia sócios." },
];

export function AcessosUsuarioDialog({
  userId,
  nome,
  onClose,
}: {
  userId: string;
  nome: string;
  onClose: () => void;
}) {
  const getFn = useServerFn(getAcessosDoUsuario);
  const q = useQuery({
    queryKey: ["acessos-usuario", userId],
    queryFn: () => getFn({ data: { userId } }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-3xl rounded-xl border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Acessos de {nome}</h2>
            <p className="text-xs text-muted-foreground">
              Área por área, o que esta pessoa faz além do perfil dela. As unidades e empresas
              ficam em "Escopo".
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {q.isLoading ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : q.isError ? (
          <div className="px-5 py-8 text-center text-sm text-destructive">
            {(q.error as Error)?.message ?? "Erro ao carregar os acessos."}
          </div>
        ) : q.data?.superAdmin ? (
          <div className="flex items-start gap-3 px-5 py-6">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
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
              <p className="mx-5 mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Sem unidade no Escopo. Para nomear como sócio, defina a unidade primeiro.
              </p>
            )}
            <ul className="divide-y">
              {[...(q.data?.areas ?? [])]
                .sort((x, y) => Number(y.pelo_papel || y.nivel !== "nenhum") - Number(x.pelo_papel || x.nivel !== "nenhum"))
                .map((a) => (
                <LinhaDaArea key={a.slug} userId={userId} area={a} />
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
    </div>
  );
}

function LinhaDaArea({ userId, area }: { userId: string; area: AcessoPorArea }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(salvarAcessoNaArea);
  const [nivel, setNivel] = useState<NivelNaArea>(area.nivel);
  const [paginas, setPaginas] = useState<string[]>(area.liberadas);
  const [aviso, setAviso] = useState<string | null>(null);

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
      setAviso(
        r.ficouSemArea
          ? "Salvo. Esta pessoa ficou sem nenhuma área: desative a conta se ela não precisa mais entrar."
          : "Salvo.",
      );
      qc.invalidateQueries({ queryKey: ["acessos-usuario", userId] });
      qc.invalidateQueries({ queryKey: ["area-admins"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
    },
    onError: () => setAviso(null),
  });

  const idBase = `acesso-${userId}-${area.slug}`;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-medium text-foreground">
            {area.nome}
            {area.pelo_papel && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                área inteira pelo perfil
              </span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground">
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
            setAviso(null);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          title={NIVEIS.find((n) => n.valor === nivel)?.ajuda}
        >
          {NIVEIS.map((n) => (
            <option key={n.valor} value={n.valor}>
              {n.valor === "nenhum" && area.pelo_papel ? "Só o perfil" : n.rotulo}
            </option>
          ))}
        </select>
        <button
          onClick={() => mut.mutate()}
          disabled={!mudou || mut.isPending}
          className="h-8 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {mut.isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        {nivel === "nenhum" && area.pelo_papel
          ? "Vê a área inteira pelo perfil. Nada a mais por delegação."
          : NIVEIS.find((n) => n.valor === nivel)?.ajuda}
      </p>

      {nivel === "usuario" && (
        <fieldset className="mt-2">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
      {aviso && <p className="mt-2 text-xs text-primary">{aviso}</p>}
    </li>
  );
}
