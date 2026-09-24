import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlanningLogo } from "@/components/planning-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { DOMINIOS_CADASTRO, pedirCadastro, unidadesParaCadastro } from "@/lib/pedidos-acesso.functions";

/**
 * Autocadastro: o colaborador pede acesso e o sócio da unidade libera em
 * /equipe. Aqui não se escolhe página nem área, só quem é e de qual unidade:
 * o que a pessoa vê é decisão de quem aprova.
 */
export const Route = createFileRoute("/cadastro")({
  ssr: false,
  head: () => ({ meta: [{ title: "Pedir acesso – Planning Brain" }] }),
  component: CadastroPage,
});

const CAMPO =
  "mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function CadastroPage() {
  const unidadesFn = useServerFn(unidadesParaCadastro);
  const pedirFn = useServerFn(pedirCadastro);
  const unidades = useQuery({ queryKey: ["cadastro-unidades"], queryFn: () => unidadesFn() });

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [observacao, setObservacao] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      pedirFn({ data: { nome, email, cargo, unidadeId: Number(unidadeId), observacao } }),
  });

  const dominios = DOMINIOS_CADASTRO.map((d) => "@" + d).join(" ou ");

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center gap-3">
          <PlanningLogo className="h-10 w-auto" />
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Pedir acesso</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              O sócio da sua unidade recebe o pedido e libera o que você vai ver.
            </p>
          </div>
        </div>

        {mut.isSuccess ? (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-foreground">
              Pedido registrado. Mandamos um e-mail para <span className="font-medium">{email}</span>{" "}
              com o link para definir sua senha.
            </p>
            <p className="text-sm text-muted-foreground">
              Depois de definir a senha, o pedido vai para o sócio da unidade. Quando ele liberar, chega
              outro e-mail. Se você já tem acesso, é só entrar pelo login.
            </p>
            <Link to="/auth" className="text-sm font-medium text-primary-text underline-offset-2 hover:underline">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!mut.isPending) mut.mutate();
            }}
            className="mt-6 space-y-4"
          >
            <div>
              <label htmlFor="cad-nome" className="block text-sm font-medium text-foreground">
                Nome completo
              </label>
              <input
                id="cad-nome"
                required
                minLength={3}
                autoComplete="name"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={CAMPO}
              />
            </div>
            <div>
              <label htmlFor="cad-email" className="block text-sm font-medium text-foreground">
                E-mail corporativo
              </label>
              <input
                id="cad-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={CAMPO}
              />
              <p className="mt-1 text-xs text-muted-foreground">Só {dominios}.</p>
            </div>
            <div>
              <label htmlFor="cad-cargo" className="block text-sm font-medium text-foreground">
                Cargo
              </label>
              <input
                id="cad-cargo"
                required
                minLength={2}
                maxLength={120}
                autoComplete="organization-title"
                placeholder="Ex.: Analista de Controladoria"
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                className={CAMPO}
              />
            </div>
            <div>
              <label htmlFor="cad-unidade" className="block text-sm font-medium text-foreground">
                Unidade
              </label>
              <select
                id="cad-unidade"
                required
                value={unidadeId}
                onChange={(e) => setUnidadeId(e.target.value)}
                className={CAMPO}
              >
                <option value="" disabled>
                  {unidades.isLoading ? "Carregando..." : "Escolha sua unidade"}
                </option>
                {(unidades.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cad-obs" className="block text-sm font-medium text-foreground">
                Mensagem para o sócio <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <textarea
                id="cad-obs"
                rows={2}
                maxLength={500}
                placeholder="Sua área, o que precisa acessar"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className={CAMPO}
              />
            </div>

            {mut.isError && <p className="text-sm text-destructive">{(mut.error as Error).message}</p>}

            <button
              type="submit"
              disabled={mut.isPending}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {mut.isPending ? "Enviando..." : "Pedir acesso"}
            </button>
            <Link
              to="/auth"
              className="block w-full text-center text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Já tenho acesso
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
