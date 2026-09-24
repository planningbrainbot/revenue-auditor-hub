import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search } from "lucide-react";
import {
  adminCreateUser,
  adminAccessEmailStatus,
  adminDefinirPortaOps,
  adminDeleteUser,
  adminEnviarRedefinicaoSenha,
  adminGerarSenhaProvisoria,
  adminGrantGrowthAccess,
  adminListGrowthAccess,
  adminListUsers,
  adminRevokeGrowthAccess,
  adminUpdateUser,
} from "@/lib/admin-users.functions";
import { getAcessosDoUsuario, getSocioUnidadeByEmail } from "@/lib/permissions.functions";
import { listRoles } from "@/lib/roles.functions";
import { generatePassword } from "@/lib/password-utils";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
} from "@/components/planning";
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
import { Input } from "@/components/ui/input";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { EscopoUsuarioDialog } from "@/components/admin/escopo-usuario-dialog";
import { AcessosUsuarioDialog } from "@/components/admin/acessos-usuario-dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  ssr: false,
  head: () => ({ meta: [{ title: "Usuários – Planning Brain" }] }),
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { id: string } }).user;
    if (!user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/" });
  },
  component: UsersPage,
});

type Role = string;

// Papel e produto são CATEGORIA, não status. Pintados com as cores de status,
// "auditor" parecia erro, "sócio" parecia sucesso e sócio e sócio regional
// ficavam iguais. A palavra já diz qual é; a pílula é neutra para todos.
const ROLE_PILL = "border border-input text-foreground";
const CUSTOM_ROLE_PILL = "bg-muted text-foreground";

// Papéis e departamentos do Growth — espelham os CHECK de public.membros lá.
const GROWTH_PAPEIS = ["admin", "gestao", "operacional"] as const;
const GROWTH_DEPARTAMENTOS = ["comercial", "diretoria", "marketing", "backoffice", "parcerias"] as const;

/**
 * Os três produtos da plataforma, na ordem de `public.produtos`.
 *
 * A porta de todos eles é a mesma tabela (`public.produto_acesso`); o que
 * muda é onde se administra o que a pessoa vê DENTRO de cada um: no Ops são
 * as áreas ("Acessos") e o escopo; no Growth, papel e departamento; no
 * Financeiro, as unidades, que moram na página dedicada porque o recorte é
 * por empresa e não cabe numa linha de tabela.
 */
const PRODUTOS = [
  { slug: "ops", rotulo: "Ops" },
  { slug: "growth", rotulo: "Growth" },
  { slug: "financeiro", rotulo: "Financeiro" },
] as const;

const PRODUTO_PILL_OFF =
  "border border-dashed border-border text-muted-foreground hover:border-solid hover:bg-accent";

/** "A, B e C": a lista das áreas no texto do efeito. */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * O que muda nas áreas quando o papel troca, na mesma regra do servidor
 * (`ops.acesso_do_usuario`, migration 20260917220000): áreas do papel menos as
 * bloqueadas para a pessoa (o super admin não sofre bloqueio), mais as que ela
 * tem por delegação (`area_admins`, `usuario_areas` liberada). O papel `admin`
 * entra como qualquer outro, pelas áreas que `role_areas` dá a ele.
 *
 * Entra o que o cliente já carrega: áreas por papel (`listRoles`, por nome) e
 * os acessos da pessoa (`getAcessosDoUsuario`, o mesmo do diálogo de acessos).
 * Sem os dois, a tela não afirma efeito nenhum.
 */
type EfeitoPapel = { passa: string[]; deixa: string[] };

const NIVEIS_DELEGADOS = new Set(["usuario", "socio", "admin"]);

function efeitoDaTroca(
  roles: { key: string; areas: string[] }[],
  acessos: { areas: { nome: string; pelo_papel: boolean; nivel: string }[] },
  de: string,
  para: string,
): EfeitoPapel {
  const doPapel = (k: string) => new Set(k ? roles.find((r) => r.key === k)?.areas ?? [] : []);
  const antes = doPapel(de);
  const depois = doPapel(para);
  const ve = (a: { nome: string; nivel: string }, papel: Set<string>, superAdmin: boolean) =>
    NIVEIS_DELEGADOS.has(a.nivel) || (papel.has(a.nome) && (superAdmin || a.nivel !== "bloqueado"));
  const passa: string[] = [];
  const deixa: string[] = [];
  for (const a of acessos.areas) {
    const via = ve(a, antes, de === "admin");
    const vera = ve(a, depois, para === "admin");
    if (!via && vera) passa.push(a.nome);
    if (via && !vera) deixa.push(a.nome);
  }
  return { passa, deixa };
}

function textoDoEfeito(e: EfeitoPapel): string {
  const partes: string[] = [];
  if (e.passa.length) partes.push(`Passa a ver ${listar(e.passa)}.`);
  if (e.deixa.length) partes.push(`Deixa de ver ${listar(e.deixa)}.`);
  return partes.length ? partes.join(" ") : "As áreas que ela vê continuam as mesmas.";
}

type GrowthAlvo = {
  email: string;
  nome: string;
  papel: string;
  departamento: string;
  jaTemAcesso: boolean;
};

function UsersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = usePermissions();
  const qc = useQueryClient();

  const listFn = useServerFn(adminListUsers);
  const emailStatusFn = useServerFn(adminAccessEmailStatus);
  const createFn = useServerFn(adminCreateUser);
  const resetFn = useServerFn(adminEnviarRedefinicaoSenha);
  const senhaProvisoriaFn = useServerFn(adminGerarSenhaProvisoria);
  const deleteFn = useServerFn(adminDeleteUser);
  const updateFn = useServerFn(adminUpdateUser);
  const lookupFn = useServerFn(getSocioUnidadeByEmail);
  const rolesFn = useServerFn(listRoles);
  const growthListFn = useServerFn(adminListGrowthAccess);
  const growthGrantFn = useServerFn(adminGrantGrowthAccess);
  const growthRevokeFn = useServerFn(adminRevokeGrowthAccess);
  const portaOpsFn = useServerFn(adminDefinirPortaOps);
  const acessosFn = useServerFn(getAcessosDoUsuario);

  useEffect(() => {
    if (!roleLoading && !isAdmin) navigate({ to: "/" });
  }, [roleLoading, isAdmin, navigate]);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const emailStatus = useQuery({
    queryKey: ["admin-access-email-status"],
    queryFn: () => emailStatusFn(),
    enabled: isAdmin,
  });

  const rolesQuery = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => rolesFn(),
    enabled: isAdmin,
  });
  const roles = rolesQuery.data ?? [];

  const unidadesQuery = useQuery({
    queryKey: ["admin-unidades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unidades")
        .select("nome_da_praca")
        .eq("tipo", "regional")
        .order("nome_da_praca");
      if (error) throw error;
      return (data ?? []).map((u) => u.nome_da_praca as string);
    },
    enabled: isAdmin,
  });
  const unidades = unidadesQuery.data ?? [];
  const growthQuery = useQuery({
    queryKey: ["admin-growth-access"],
    queryFn: () => growthListFn(),
    enabled: isAdmin,
  });
  const growthConfigurado = growthQuery.data?.configured ?? false;
  const growthPorEmail = new Map(
    (growthQuery.data?.membros ?? []).map((m) => [String(m.email).toLowerCase(), m]),
  );

  const roleLabel = (key: string) => roles.find((r) => r.key === key)?.label ?? key;

  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("diretor");
  const [credential, setCredential] = useState<{
    email: string;
    password: string;
    unidade?: string | null;
    /** Senha gerada para uma conta que já existe, que a pessoa terá de trocar. */
    provisoria?: boolean;
  } | null>(null);
  // Alvo do diálogo de senha. `modo` é o que o admin escolheu ali: link por
  // e-mail (não mexe na senha atual) ou senha provisória em tela.
  const [senhaAlvo, setSenhaAlvo] = useState<{
    userId: string;
    nome: string;
    email: string;
    modo: "link" | "provisoria";
  } | null>(null);
  const [acesso, setAcesso] = useState<{
    modo: "convite" | "reset";
    email: string;
    link: string | null;
    enviado: boolean;
    erro: string | null;
    unidade?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socioUnidade, setSocioUnidade] = useState<string | null>(null);
  const [escopoAlvo, setEscopoAlvo] = useState<{ userId: string; nome: string } | null>(null);
  // `tem` é a porta do Ops, que o diálogo de Acessos mostra e liga/desliga.
  const [acessosAlvo, setAcessosAlvo] = useState<{ userId: string; nome: string; tem: boolean } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  // Os dois destrutivos da tela confirmam em AlertDialog, com o efeito (V6).
  const [excluirAlvo, setExcluirAlvo] = useState<{
    user_id: string;
    email: string;
    nome: string;
    produtos: string[];
  } | null>(null);
  const [revogarGrowth, setRevogarGrowth] = useState(false);
  // Troca de papel que tira área: confirma antes (padrão de /admin/permissoes).
  const [trocaComPerda, setTrocaComPerda] = useState<{
    user_id: string;
    nome: string;
    role: string | null;
    efeito?: string;
    /** Os acessos da pessoa não carregaram: confirma sem afirmar efeito. */
    semEfeito?: boolean;
  } | null>(null);
  const [busca, setBusca] = useFiltroNaUrl("q", "");
  const [unidadeSel, setUnidadeSel] = useState("");

  // Preview da unidade quando role=socio + email digitado
  useEffect(() => {
    if (role !== "socio" || !email.includes("@")) {
      setSocioUnidade(null);
      return;
    }
    let cancel = false;
    setLookingUp(true);
    const t = setTimeout(async () => {
      try {
        const res = await lookupFn({ data: { email } });
        if (!cancel) setSocioUnidade(res.unidade);
      } finally {
        if (!cancel) setLookingUp(false);
      }
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [email, role, lookupFn]);

  const portaOpsMut = useMutation({
    mutationFn: (input: { userId: string; conceder: boolean; nome: string }) =>
      portaOpsFn({ data: { userId: input.userId, conceder: input.conceder } }),
    onSuccess: (res, variables) => {
      toast.success(
        res.conceder
          ? `${variables.nome} passa a entrar no Ops, nas áreas marcadas abaixo. Vale no próximo carregamento.`
          : `${variables.nome} deixa de entrar no Ops. As áreas marcadas ficam guardadas para quando a porta reabrir.`,
      );
      // O diálogo fica aberto: quem acabou de conceder normalmente quer
      // marcar as áreas em seguida, e fechar aqui obrigaria a reabrir.
      setAcessosAlvo((a) => (a ? { ...a, tem: res.conceder } : a));
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao mudar o acesso ao Ops";
      setError(msg);
      toast.error(msg);
    },
  });

  const [growthAlvo, setGrowthAlvo] = useState<GrowthAlvo | null>(null);

  const growthGrantMut = useMutation({
    mutationFn: (input: { email: string; nome: string; papel: string; departamento: string; password?: string }) =>
      growthGrantFn({ data: input }),
    onSuccess: (res, variables) => {
      toast.success(
        growthAlvo?.jaTemAcesso
          ? `Growth de ${variables.nome} atualizado: ${variables.papel} · ${variables.departamento}.`
          : `${variables.nome} passa a entrar no Growth como ${variables.papel} · ${variables.departamento}.`,
      );
      if (res.loginCriado && variables.password) {
        setCredential({ email: `${res.email} (Growth)`, password: variables.password });
      }
      setGrowthAlvo(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao conceder acesso no Growth";
      setError(msg);
      toast.error(msg);
    },
  });

  const growthRevokeMut = useMutation({
    mutationFn: (email: string) => growthRevokeFn({ data: { email } }),
    onSuccess: (res) => {
      toast.success(`${res.email} deixa de entrar no Growth. Ops e Financeiro continuam como estavam.`);
      setRevogarGrowth(false);
      setGrowthAlvo(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao revogar acesso no Growth";
      setError(msg);
      toast.error(msg);
    },
  });

  const createMut = useMutation({
    mutationFn: (input: { nome: string; email: string; role: Role; password: string; unidade?: string }) => createFn({ data: input }),
    onSuccess: (res) => {
      if (res.emailEnviado) toast.success(`${res.email} criado. O convite saiu por e-mail.`);
      else toast.warning(`${res.email} criado, mas o e-mail não saiu. Copie o link no topo da página.`);
      mostrarResultadoNoTopo();
      setAcesso({
        modo: "convite",
        email: res.email,
        link: res.link,
        enviado: res.emailEnviado,
        erro: res.emailErro,
        unidade: res.unidade,
      });
      setNome("");
      setEmail("");
      setRole("diretor");
      setSocioUnidade(null);
      setUnidadeSel("");
      setShowForm(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao criar usuário";
      setError(msg);
      toast.error(msg);
    },
  });

  const resetMut = useMutation({
    mutationFn: ({ user_id }: { user_id: string }) => resetFn({ data: { user_id } }),
    onSuccess: (res) => {
      if (res.emailEnviado)
        toast.success(`Link de redefinição enviado a ${res.email}. A senha atual vale até ela trocar.`);
      else toast.warning(`O e-mail para ${res.email} não saiu. Copie o link no topo da página.`);
      setCredential(null);
      setSenhaAlvo(null);
      setError(null);
      setAcesso({
        modo: "reset",
        email: res.email,
        link: res.link,
        enviado: res.emailEnviado,
        erro: res.emailErro,
      });
      mostrarResultadoNoTopo();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao enviar a redefinição de senha";
      setError(msg);
      toast.error(msg);
    },
  });

  const senhaProvisoriaMut = useMutation({
    mutationFn: ({ user_id }: { user_id: string }) => senhaProvisoriaFn({ data: { user_id } }),
    onSuccess: (res) => {
      // Os dois painéis nunca aparecem juntos: são dois caminhos para a mesma
      // pergunta ("como essa pessoa entra?"), e ver os dois faria duvidar de
      // qual valeu.
      toast.success(`Senha provisória de ${res.email} gerada. A anterior já não vale.`);
      setAcesso(null);
      setSenhaAlvo(null);
      setError(null);
      setCredential({ email: res.email, password: res.senha, provisoria: true });
      mostrarResultadoNoTopo();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao gerar a senha provisória";
      setError(msg);
      toast.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (alvo: { user_id: string; email: string }) => deleteFn({ data: { user_id: alvo.user_id } }),
    onSuccess: (_res, alvo) => {
      toast.success(`${alvo.email} excluído. A conta não entra mais no Ops, no Growth nem no Financeiro.`);
      setExcluirAlvo(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-growth-access"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir"),
  });

  const updateMut = useMutation({
    mutationFn: (input: {
      user_id: string;
      nome: string;
      role?: string | null;
      efeito?: string;
      semEfeito?: boolean;
    }) =>
      updateFn({ data: { user_id: input.user_id, nome: input.nome, role: input.role } }),
    onSuccess: (_res, input) => {
      toast.success(
        input.efeito
          ? `${input.nome}: papel trocado. ${input.efeito} Vale no próximo carregamento.`
          : input.role !== undefined
            ? `${input.nome}: papel trocado. Vale no próximo carregamento.`
            : `${input.nome} atualizado.`,
      );
      setEditingId(null);
      setEditingNome("");
      setEditingRole("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["acessos-usuario", input.user_id] });
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao atualizar";
      setError(msg);
      toast.error(msg);
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");
  // "" é sem papel. O papel só existia no cadastro: mudar depois pedia SQL.
  const [editingRole, setEditingRole] = useState("");

  // Os acessos de quem está em edição, para dizer o efeito da troca de papel.
  const acessosEdicao = useQuery({
    queryKey: ["acessos-usuario", editingId],
    queryFn: () => acessosFn({ data: { userId: editingId as string } }),
    enabled: isAdmin && !!editingId,
  });
  const calculandoEfeito = rolesQuery.isPending || acessosEdicao.isPending;
  const efeitoFalhou = rolesQuery.isError || acessosEdicao.isError;

  /** O efeito da troca em texto, ou por que não há efeito para mostrar. */
  function efeitoDaEdicao(roleAtual: string): { texto: string; efeito?: EfeitoPapel } {
    if (efeitoFalhou) return { texto: "Não foi possível calcular o efeito desta troca." };
    if (calculandoEfeito || !rolesQuery.data || !acessosEdicao.data)
      return { texto: "Calculando o efeito…" };
    const efeito = efeitoDaTroca(rolesQuery.data, acessosEdicao.data, roleAtual, editingRole);
    return { texto: textoDoEfeito(efeito), efeito };
  }

  function abrirEdicao(u: { user_id: string; nome: string | null; role: string | null }) {
    setEditingId(u.user_id);
    setEditingNome(u.nome || "");
    setEditingRole(u.role ?? "");
    setError(null);
  }

  function salvarEdicao(u: { user_id: string; role: string | null }) {
    const nome = editingNome.trim();
    if (!nome) return;
    const roleAtual = u.role ?? "";
    // Só manda o papel quando mudou: assim salvar um nome nunca reescreve
    // user_roles sem querer.
    if (editingRole === roleAtual) {
      updateMut.mutate({ user_id: u.user_id, nome });
      return;
    }
    const base = { user_id: u.user_id, nome, role: editingRole || null };
    const { texto, efeito } = efeitoDaEdicao(roleAtual);
    // Sem o cálculo, não afirma efeito: pede confirmação dizendo isso.
    if (!efeito) {
      if (efeitoFalhou) setTrocaComPerda({ ...base, semEfeito: true });
      return;
    }
    const input = { ...base, efeito: texto };
    // Confirma só quando uma área realmente some; alargar ou manter salva direto.
    if (efeito.deixa.length) setTrocaComPerda(input);
    else updateMut.mutate(input);
  }

  /**
   * Os dois painéis de resultado (link enviado, senha gerada) moram no topo da
   * página, e o botão que os dispara está numa linha da tabela que pode estar
   * na altura do rodapé. Sem isto, gerar uma senha parece não ter feito nada.
   */
  function mostrarResultadoNoTopo() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function copyLink() {
    if (acesso?.link) navigator.clipboard?.writeText(acesso.link);
  }

  function copyCred() {
    if (!credential) return;
    const text = `Email: ${credential.email}\nSenha: ${credential.password}`;
    navigator.clipboard?.writeText(text);
  }

  const usuarios = usersQuery.data ?? [];
  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(
    () =>
      usuarios.filter(
        (u) =>
          !termo ||
          (u.nome ?? "").toLowerCase().includes(termo) ||
          (u.email ?? "").toLowerCase().includes(termo),
      ),
    [usuarios, termo],
  );

  const titulo = "Usuários";
  const pergunta = "Quem acessa o Brain, com qual papel?";

  if (roleLoading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="pagina" />
      </div>
    );
  if (!isAdmin)
    return (
      <AppShell title={titulo} pergunta={pergunta}>
        <div className="mx-auto max-w-7xl px-4 py-6">
          <EstadoSemAcesso oQueFalta="admin (Administração)" />
        </div>
      </AppShell>
    );

  return (
    <AppShell
      title={titulo}
      pergunta={pergunta}
      subtitle={
        <>
          {usersQuery.data ? `${usuarios.length} ${usuarios.length === 1 ? "conta" : "contas"} · ` : ""}
          Conta nova recebe o convite por e-mail. Papel e acessos valem no próximo carregamento da
          pessoa; excluir apaga a conta nos três produtos.
        </>
      }
    >
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section className="rounded-xl border bg-card px-5 py-4">
          <h2 className="text-sm font-semibold">Emails de acesso</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Convites e redefinições saem como Planning Brain · noreply@planningbrain.com.br. Para
            uma conta existente, use “Senha” na linha do usuário: de lá sai o link por e-mail, com a
            pessoa definindo a própria senha, ou uma senha provisória em tela, para quando ela não
            acessa o e-mail.
          </p>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {emailStatus.isError
              ? "Não foi possível consultar a configuração de envio."
              : !emailStatus.data
                ? "Conferindo o envio…"
                : emailStatus.data.configured
                  ? "Resend configurado · link de uso único, válido por 1 hora."
                  : "Resend pendente de configuração. O administrador pode copiar o link após gerá-lo."}
          </p>
        </section>
        {acesso && (
          <div
            className={`rounded-xl border p-4 ${
              acesso.enviado
                ? "border-success/40 bg-success/5"
                : "border-warning/50 bg-warning/5"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {acesso.enviado
                    ? acesso.modo === "convite"
                      ? "Convite enviado"
                      : "Redefinição enviada"
                    : "Usuário pronto, mas o e-mail não saiu"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {acesso.enviado ? (
                    <>
                      {acesso.email} recebeu um link para cadastrar a própria senha. O link vale por
                      24 horas e é de uso único.
                    </>
                  ) : (
                    <>
                      Não foi possível enviar o e-mail para {acesso.email}
                      {acesso.erro ? ` (${acesso.erro})` : ""}. Copie o link abaixo e mande por um
                      canal seguro.
                    </>
                  )}
                </p>
                {acesso.unidade !== undefined && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Unidade: <span className="text-foreground">{acesso.unidade ?? "—"}</span>
                  </p>
                )}
                {acesso.link && (
                  <div className="mt-3 break-all rounded-lg bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                    {acesso.link}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {acesso.link && (
                  <button
                    onClick={copyLink}
                    className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >
                    Copiar link
                  </button>
                )}
                <button
                  onClick={() => setAcesso(null)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {credential && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {credential.provisoria ? "Senha provisória gerada" : "Credenciais geradas"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Copie e envie para o usuário por um canal seguro. Esta senha só aparece uma vez.
                </p>
                {credential.provisoria && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    A senha anterior já não vale. No próximo acesso, a pessoa é levada a cadastrar a
                    dela antes de usar o Ops.
                  </p>
                )}
                <div className="mt-3 rounded-lg bg-background px-3 py-2 font-mono text-sm">
                  <div><span className="text-muted-foreground">Email:</span> {credential.email}</div>
                  <div><span className="text-muted-foreground">Senha:</span> {credential.password}</div>
                  {credential.unidade !== undefined && (
                    <div><span className="text-muted-foreground">Unidade:</span> {credential.unidade ?? "—"}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={copyCred} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
                  Copiar
                </button>
                <button onClick={() => setCredential(null)} className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou e-mail"
              aria-label="Buscar por nome ou e-mail"
              className="h-9 w-[260px] pl-8"
            />
          </div>
          <button
            onClick={() => { setShowForm((s) => !s); setError(null); }}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {showForm ? "Cancelar" : "Novo usuário"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate({
                nome,
                email,
                role,
                password: generatePassword(12),
                unidade: role === "socio_regional" ? unidadeSel : undefined,
              });
            }}
            className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-4"
          >
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-foreground">Nome</label>
              <input required value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground">Email</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              {role === "socio" && email.includes("@") && (
                <p className="mt-1 text-xs">
                  {lookingUp ? (
                    <span className="text-muted-foreground">Buscando unidade…</span>
                  ) : socioUnidade ? (
                    <span className="text-success">
                      Unidade vinculada: <strong>{socioUnidade}</strong>
                    </span>
                  ) : (
                    <span className="text-warning">
                      Email não encontrado na tabela de sócios. O acesso será criado, mas a unidade ficará vazia.
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-foreground">Papel</label>
              <select
                value={role}
                onChange={(e) => { setRole(e.target.value as Role); setUnidadeSel(""); }}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                    {!r.is_system ? " (customizado)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {role === "socio_regional" && (
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-foreground">Unidade</label>
                <select
                  required
                  value={unidadeSel}
                  onChange={(e) => setUnidadeSel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="" disabled>Selecione…</option>
                  {unidades.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="sm:col-span-4 flex justify-end">
              <button type="submit" disabled={createMut.isPending} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {createMut.isPending ? "Criando..." : "Criar e enviar acesso"}
              </button>
            </div>
          </form>
        )}

        {/* Motivo visível da pílula Growth desabilitada (N8), uma vez para a tabela. */}
        {!growthConfigurado && (
          <p id="motivo-growth" aria-live="polite" className="text-xs text-muted-foreground">
            {growthQuery.isPending
              ? "Conferindo a conexão com o Growth…"
              : "O Growth não está conectado neste ambiente: a pílula Growth fica desabilitada."}
          </p>
        )}

        {usersQuery.isLoading ? (
          <Carregando variante="tabela" />
        ) : usersQuery.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar os usuários"
            detalhe={usersQuery.error instanceof Error ? usersQuery.error.message : undefined}
            tentarNovamente={() => usersQuery.refetch()}
          />
        ) : usuarios.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum usuário cadastrado"
            descricao="Use “Novo usuário” para cadastrar o primeiro."
          />
        ) : filtrados.length === 0 ? (
          <EstadoVazio titulo="Ninguém com esse nome ou e-mail" total={usuarios.length} />
        ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Papel</th>
                <th className="px-4 py-2">Unidade</th>
                <th className="px-4 py-2">Produtos</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((u) => (
                <tr key={u.user_id} className="border-t">
                  <td className="px-4 py-2 text-foreground">
                    {editingId === u.user_id ? (
                      <input
                        autoFocus
                        value={editingNome}
                        onChange={(e) => setEditingNome(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") salvarEdicao(u);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                      />
                    ) : (
                      u.nome || "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-foreground">{u.email}</td>
                  <td className="px-4 py-2">
                    {editingId === u.user_id ? (
                      <>
                        <label htmlFor={`papel-${u.user_id}`} className="sr-only">
                          Papel de {u.nome || u.email}
                        </label>
                        <select
                          id={`papel-${u.user_id}`}
                          value={editingRole}
                          onChange={(e) => setEditingRole(e.target.value)}
                          className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <option value="">sem papel</option>
                          {roles.map((r) => (
                            <option key={r.key} value={r.key}>{r.label}</option>
                          ))}
                        </select>
                        {editingRole !== (u.role ?? "") && (
                          <p
                            id={`efeito-${u.user_id}`}
                            aria-live="polite"
                            className="mt-1 max-w-56 text-xs leading-tight text-muted-foreground"
                          >
                            {(() => {
                              const { texto, efeito } = efeitoDaEdicao(u.role ?? "");
                              return efeito
                                ? `${texto} O que foi dado a ela na pílula Ops continua igual.`
                                : texto;
                            })()}
                          </p>
                        )}
                      </>
                    ) : u.role ? (
                      <button
                        type="button"
                        onClick={() => abrirEdicao(u)}
                        title="Clique para trocar o papel desta pessoa"
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide hover:opacity-80 ${ROLE_PILL}`}
                      >
                        {roleLabel(u.role)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => abrirEdicao(u)}
                        title="Sem papel no Ops. Pode entrar por área, pela pílula Ops. Clique para definir um papel."
                        className="rounded px-1 py-0.5 text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:bg-accent hover:text-foreground"
                      >
                        sem papel
                      </button>
                    )}
                  </td>
                  {/* Unidade é o escopo: o que a pessoa enxerga nas áreas do
                      Ops. Editar aqui mesmo evita o botão "Escopo" no fim da
                      linha, que dizia menos do que a própria coluna. */}
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setEscopoAlvo({ userId: u.user_id, nome: u.nome || u.email })}
                      title="Clique para escolher as unidades e empresas que esta pessoa enxerga"
                      className="rounded px-1 py-0.5 text-left text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:bg-accent hover:text-foreground"
                    >
                      {u.escopo.todas ? (
                        <span className="text-foreground">Todas as unidades</span>
                      ) : u.escopo.unidades.length === 0 ? (
                        <span className="text-warning">nenhuma unidade</span>
                      ) : u.escopo.unidades.length === 1 ? (
                        <span className="text-foreground">{u.escopo.unidades[0]}</span>
                      ) : (
                        <span className="text-foreground" title={u.escopo.unidades.join(", ")}>
                          {u.escopo.unidades[0]} +{u.escopo.unidades.length - 1}
                        </span>
                      )}
                      {(u.role === "socio" || u.role === "socio_regional") && (
                        <span className="mt-0.5 block text-xs normal-case">
                          {u.unidade ? (
                            <>sócio de {u.unidade}</>
                          ) : (
                            <span className="text-warning">sócio não vinculado</span>
                          )}
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {PRODUTOS.map((prod) => {
                        const tem = u.produtos.includes(prod.slug);
                        const membroGrowth =
                          prod.slug === "growth" ? growthPorEmail.get(u.email.toLowerCase()) : undefined;
                        // A porta sem o cadastro do Growth é acesso que não
                        // funciona: a pessoa entra e o `e_membro()` de lá barra.
                        const inconsistente = prod.slug === "growth" && tem && !membroGrowth;
                        const titulo =
                          prod.slug === "growth" && !growthConfigurado
                            ? growthQuery.isLoading
                              ? "Conferindo a conexão com o Growth…"
                              : "O Growth não está conectado neste ambiente: não dá para administrar o acesso daqui."
                            : !tem
                          ? `Sem acesso ao ${prod.rotulo}. Clique para conceder.`
                          : inconsistente
                            ? "Tem a porta do Growth mas não está em growth.membros — clique para acertar o papel."
                            : membroGrowth
                              ? `${membroGrowth.papel} · ${membroGrowth.departamento ?? "sem departamento"}`
                              : `Entra no ${prod.rotulo}. Clique para administrar.`;
                        return (
                          <button
                            key={prod.slug}
                            type="button"
                            title={titulo}
                            disabled={prod.slug === "growth" && !growthConfigurado}
                            aria-describedby={
                              prod.slug === "growth" && !growthConfigurado ? "motivo-growth" : undefined
                            }
                            onClick={() => {
                              if (prod.slug === "ops") {
                                setAcessosAlvo({ userId: u.user_id, nome: u.nome || u.email, tem });
                                return;
                              }
                              if (prod.slug === "growth") {
                                const m = growthPorEmail.get(u.email.toLowerCase());
                                setGrowthAlvo({
                                  email: u.email,
                                  nome: u.nome || u.email,
                                  papel: String(m?.papel ?? "operacional"),
                                  departamento: String(m?.departamento ?? "comercial"),
                                  jaTemAcesso: Boolean(m),
                                });
                                return;
                              }
                              navigate({ to: "/admin/acessos-financeiro" });
                            }}
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-40 ${
                              tem ? CUSTOM_ROLE_PILL : PRODUTO_PILL_OFF
                            }`}
                          >
                            {prod.rotulo}
                            {inconsistente && <span className="ml-1 text-warning">!</span>}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    {editingId === u.user_id ? (
                      <>
                        {(() => {
                          const trocouPapel = editingRole !== (u.role ?? "");
                          const motivo = !editingNome.trim()
                            ? "Preencha o nome para salvar."
                            : trocouPapel && calculandoEfeito && !efeitoFalhou
                              ? "Calculando o efeito…"
                              : null;
                          return (
                            <>
                              <button
                                onClick={() => salvarEdicao(u)}
                                disabled={updateMut.isPending || !!motivo}
                                aria-describedby={
                                  motivo ? `motivo-${u.user_id}` : trocouPapel ? `efeito-${u.user_id}` : undefined
                                }
                                className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                              >
                                {updateMut.isPending ? "Salvando..." : "Salvar"}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              >
                                Cancelar
                              </button>
                              {motivo && (
                                <p id={`motivo-${u.user_id}`} aria-live="polite" className="mt-1 text-xs text-muted-foreground">
                                  {motivo}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => abrirEdicao(u)}
                          title="Nome e papel"
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                        >
                          Editar
                        </button>
                        {/* "Escopo" e "Acessos" saíram daqui: o primeiro é a
                            coluna Unidade, o segundo é a pílula Ops. Dois
                            caminhos para a mesma janela só faziam duvidar se
                            eram a mesma coisa. */}
                        {/* Um botão para os dois caminhos de senha. Dois botões
                            na linha obrigariam a escolher entre eles sem ver a
                            diferença, que é justamente o que o diálogo explica:
                            o link não toca na senha atual, a provisória troca. */}
                        <button
                          onClick={() =>
                            setSenhaAlvo({
                              userId: u.user_id,
                              nome: u.nome || u.email || "",
                              email: u.email || "",
                              modo: "link",
                            })
                          }
                          title="Enviar link de redefinição ou gerar uma senha provisória"
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
                        >
                          Senha
                        </button>
                        {u.user_id !== user?.id && (
                          <button
                            onClick={() =>
                              setExcluirAlvo({
                                user_id: u.user_id,
                                email: u.email,
                                nome: u.nome || u.email,
                                produtos: PRODUTOS.filter((p) => u.produtos.includes(p.slug)).map((p) => p.rotulo),
                              })
                            }
                            disabled={deleteMut.isPending}
                            className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {senhaAlvo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-foreground">Senha de acesso</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {senhaAlvo.nome} · {senhaAlvo.email}
              </p>

              <div className="mt-5 space-y-3">
                <label className="flex cursor-pointer gap-3 rounded-lg border border-input p-3 hover:bg-accent">
                  <input
                    type="radio"
                    name="modo-senha"
                    className="mt-0.5"
                    checked={senhaAlvo.modo === "link"}
                    onChange={() => setSenhaAlvo({ ...senhaAlvo, modo: "link" })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      Enviar link por e-mail
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      A pessoa cadastra a própria senha. A senha atual continua valendo até ela
                      fazer isso. Link de uso único, válido por 24 horas.
                    </span>
                  </span>
                </label>

                <label
                  className={`flex gap-3 rounded-lg border border-input p-3 ${
                    senhaAlvo.userId === user?.id ? "opacity-50" : "cursor-pointer hover:bg-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="modo-senha"
                    className="mt-0.5"
                    disabled={senhaAlvo.userId === user?.id}
                    checked={senhaAlvo.modo === "provisoria"}
                    onChange={() => setSenhaAlvo({ ...senhaAlvo, modo: "provisoria" })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      Gerar senha provisória
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {senhaAlvo.userId === user?.id
                        ? "Não vale para a sua própria conta: use “Esqueci minha senha” na tela de login."
                        : "A senha aparece aqui para você copiar e mandar. A senha atual para de valer na hora, e no próximo acesso a pessoa é obrigada a cadastrar a dela."}
                    </span>
                  </span>
                </label>
              </div>

              {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setSenhaAlvo(null);
                    setError(null);
                  }}
                  className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  onClick={() =>
                    senhaAlvo.modo === "provisoria"
                      ? senhaProvisoriaMut.mutate({ user_id: senhaAlvo.userId })
                      : resetMut.mutate({ user_id: senhaAlvo.userId })
                  }
                  disabled={resetMut.isPending || senhaProvisoriaMut.isPending}
                  className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {resetMut.isPending || senhaProvisoriaMut.isPending
                    ? "Aplicando..."
                    : senhaAlvo.modo === "provisoria"
                      ? "Gerar senha"
                      : "Enviar link"}
                </button>
              </div>
            </div>
          </div>
        )}

        {growthAlvo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-foreground">Acesso ao Growth</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {growthAlvo.nome} · {growthAlvo.email}
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">Papel no Growth</label>
                  <select
                    value={growthAlvo.papel}
                    onChange={(e) => setGrowthAlvo({ ...growthAlvo, papel: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  >
                    {GROWTH_PAPEIS.map((pp) => (
                      <option key={pp} value={pp}>{pp}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground">Departamento</label>
                  <select
                    value={growthAlvo.departamento}
                    onChange={(e) => setGrowthAlvo({ ...growthAlvo, departamento: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  >
                    {GROWTH_DEPARTAMENTOS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                {/* Havia aqui um campo de senha, de quando o Growth era outro
                    banco e outro login. Desde a migração de 18/09/2026 a conta
                    é a mesma: digitar uma senha nesta tela trocaria também a
                    senha do Ops e do Financeiro, sem avisar. Para trocar senha
                    existe o botão "Senha", na linha da pessoa. */}
                <p className="text-xs text-muted-foreground">
                  Mesma conta do Ops e do Financeiro. Aqui se define só o que a pessoa é dentro
                  do Growth.
                </p>
              </div>

              {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

              <div className="mt-6 flex items-center justify-between">
                {growthAlvo.jaTemAcesso ? (
                  <button
                    onClick={() => setRevogarGrowth(true)}
                    disabled={growthRevokeMut.isPending}
                    className="rounded-full border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Revogar acesso
                  </button>
                ) : (
                  <span />
                )}

                <div className="space-x-2">
                  <button
                    onClick={() => { setGrowthAlvo(null); setError(null); }}
                    className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground hover:bg-accent"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() =>
                      growthGrantMut.mutate({
                        email: growthAlvo.email,
                        nome: growthAlvo.nome,
                        papel: growthAlvo.papel,
                        departamento: growthAlvo.departamento,
                      })
                    }
                    disabled={growthGrantMut.isPending}
                    className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {growthGrantMut.isPending ? "Salvando..." : growthAlvo.jaTemAcesso ? "Salvar" : "Conceder acesso"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {escopoAlvo && (
          <EscopoUsuarioDialog
            userId={escopoAlvo.userId}
            nome={escopoAlvo.nome}
            onClose={() => setEscopoAlvo(null)}
          />
        )}
        {acessosAlvo && (
          <AcessosUsuarioDialog
            userId={acessosAlvo.userId}
            nome={acessosAlvo.nome}
            porta={{
              tem: acessosAlvo.tem,
              salvando: portaOpsMut.isPending,
              erro: portaOpsMut.isError ? (portaOpsMut.error as Error)?.message : null,
              onDefinir: (conceder) =>
                portaOpsMut.mutate({ userId: acessosAlvo.userId, conceder, nome: acessosAlvo.nome }),
            }}
            onClose={() => setAcessosAlvo(null)}
          />
        )}

        <AlertDialog open={!!excluirAlvo} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {excluirAlvo?.nome}?</AlertDialogTitle>
              <AlertDialogDescription>
                A conta {excluirAlvo?.email} é apagada, e com ela o login
                {excluirAlvo?.produtos.length
                  ? ` no ${listar(excluirAlvo.produtos)}`
                  : ""}
                . É a mesma conta nos três produtos, então a pessoa não entra em mais nenhum. Não
                dá para desfazer: para voltar, ela precisa ser cadastrada de novo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMut.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (excluirAlvo) deleteMut.mutate({ user_id: excluirAlvo.user_id, email: excluirAlvo.email });
                }}
                className={buttonVariants({ variant: "destructive" })}
              >
                {deleteMut.isPending ? "Excluindo…" : "Excluir conta"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={revogarGrowth && !!growthAlvo} onOpenChange={setRevogarGrowth}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revogar o Growth de {growthAlvo?.nome}?</AlertDialogTitle>
              <AlertDialogDescription>
                {growthAlvo?.email} deixa de entrar no Growth e sai do cadastro de membros de lá
                (papel e departamento se perdem). A conta continua valendo no Ops e no Financeiro.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={growthRevokeMut.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (growthAlvo) growthRevokeMut.mutate(growthAlvo.email);
                }}
                className={buttonVariants({ variant: "destructive" })}
              >
                {growthRevokeMut.isPending ? "Revogando…" : "Revogar acesso"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!trocaComPerda} onOpenChange={(o) => !o && setTrocaComPerda(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {trocaComPerda?.semEfeito
                  ? `Trocar o papel de ${trocaComPerda.nome} sem ver o efeito?`
                  : `Isto tira áreas de ${trocaComPerda?.nome}`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {trocaComPerda?.semEfeito
                  ? "Não foi possível calcular o efeito: os acessos desta pessoa não carregaram. A troca pode tirar áreas que ela vê hoje. Vale no próximo carregamento."
                  : `${trocaComPerda?.efeito ?? ""} Vale no próximo carregamento.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (trocaComPerda) updateMut.mutate(trocaComPerda);
                  setTrocaComPerda(null);
                }}
              >
                Trocar o papel
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
