import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, TriangleAlert } from "lucide-react";
import {
  adminDefinirPortaOps,
  adminDeleteUser,
  adminReativarPessoa,
  adminFichaPessoa,
  adminVincularGente,
  type AreaNaFicha,
  type EventoDoHistorico,
  type FichaDaPessoa,
} from "@/lib/admin-users.functions";
import { listRoles } from "@/lib/roles.functions";
import {
  ROTULO_SITUACAO,
  TOM_SITUACAO,
  haQuanto,
  pendenciasDe,
  situacaoDe,
} from "@/lib/pessoas-situacao";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { AcessosUsuarioDialog } from "@/components/admin/acessos-usuario-dialog";
import { EscopoUsuarioDialog } from "@/components/admin/escopo-usuario-dialog";
import {
  DesativarDialog,
  EditarPessoaDialog,
  GrowthDialog,
  PainelResultado,
  SenhaDialog,
  type ResultadoDeAcesso,
} from "@/components/admin/pessoa-dialogos";
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
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ficha da pessoa: o que ela acessa, e por quê, num lugar só.
 *
 * É a tela que faltava (auditoria de 24/09/2026). Para responder "o que a
 * Fulana vê?" era preciso abrir a linha da lista, o diálogo de Acessos, o de
 * Escopo, o tooltip do Growth e outra página para o Financeiro. O acesso
 * efetivo aqui vem de `ops.acesso_do_usuario`, a mesma regra que monta o menu
 * dela e que a RLS aplica; a coluna "De onde vem" diz qual das camadas abriu
 * cada área. Arquétipo Ficha (docs/design/ARQUETIPOS.md §4).
 */
export const Route = createFileRoute("/_authenticated/admin/usuarios_/$userId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Pessoa – Planning Brain" }] }),
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
  component: FichaPage,
});

const ROTULO_ACAO: Record<string, string> = {
  criar_pessoa: "Pessoa criada",
  editar_pessoa: "Cadastro editado",
  desativar: "Conta desativada",
  reativar: "Conta reativada",
  excluir: "Conta excluída",
  senha_link: "Link de senha enviado",
  senha_provisoria: "Senha provisória gerada",
  porta_ops_abrir: "Passou a entrar no Ops",
  porta_ops_fechar: "Deixou de entrar no Ops",
  growth_conceder: "Acesso ao Growth dado ou ajustado",
  growth_revogar: "Saiu do Growth",
  financeiro_conceder: "Empresas do Financeiro ajustadas",
  financeiro_revogar: "Saiu do Financeiro",
  definir_recorte: "Recorte de unidades mudou",
  definir_unidades: "Unidades mudaram",
  adicionar_na_area: "Entrou numa área",
  remover_da_area: "Saiu de uma área",
  definir_paginas: "Páginas da área mudaram",
  nomear: "Nomeada na área",
  bloquear_area: "Área bloqueada",
  desbloquear_area: "Área desbloqueada",
  negar_pagina: "Página negada",
  devolver_pagina: "Página devolvida",
  escopo_devolvido: "Recorte de antes de ser admin voltou",
  pedido_aprovado: "Pedido de acesso aprovado",
  pedido_recusado: "Pedido de acesso recusado",
  gente_vincular: "Cadastro do Gente ligado",
  gente_dar_acesso: "Acesso dado pelo Planning People",
  ver_como_iniciar: "Começou a simular uma unidade",
  ver_como_encerrar: "Encerrou a simulação",
};

const ROTULO_ORIGEM = {
  admin: "Admin da área",
  socio: "Sócio da área",
  pessoa: "Dada a ela",
  perfil: "Perfil",
} as const;

function FichaPage() {
  const { userId } = Route.useParams();
  const { isAdmin, loading } = usePermissions();
  const fichaFn = useServerFn(adminFichaPessoa);
  const rolesFn = useServerFn(listRoles);

  const q = useQuery({
    queryKey: ["ficha-pessoa", userId],
    queryFn: () => fichaFn({ data: { userId } }),
    enabled: isAdmin,
  });
  const perfisQ = useQuery({ queryKey: ["admin-roles"], queryFn: () => rolesFn(), enabled: isAdmin });

  if (loading || !isAdmin) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <nav aria-label="Trilha" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Administração</span>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link to="/admin/usuarios" className="hover:text-foreground hover:underline">
          Pessoas
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="text-foreground">{q.data?.nome || q.data?.email || "Pessoa"}</span>
      </nav>

      {q.isLoading ? (
        <Carregando variante="pagina" />
      ) : q.isError || !q.data ? (
        <EstadoErro
          titulo="Não foi possível abrir a ficha desta pessoa"
          detalhe={(q.error as Error)?.message}
          tentarNovamente={() => q.refetch()}
        />
      ) : (
        <Ficha
          f={q.data}
          atualizadoEm={new Date(q.dataUpdatedAt)}
          perfis={(perfisQ.data ?? []).map((r) => ({ key: r.key, label: r.label, areas: r.areas }))}
        />
      )}
    </div>
  );
}

function Ficha({
  f,
  atualizadoEm,
  perfis,
}: {
  f: FichaDaPessoa;
  atualizadoEm: Date;
  perfis: { key: string; label: string; areas: string[] }[];
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const nome = f.nome || f.email;
  const primeiroNome = nome.split(/\s+/)[0];

  const [dialogo, setDialogo] = useState<
    null | "senha" | "editar" | "desativar" | "excluir" | "growth" | "acessos" | "recorte"
  >(null);
  const [resultado, setResultado] = useState<ResultadoDeAcesso | null>(null);

  const entrada = useMemo(
    () => ({
      email: f.email,
      ativo: f.ativo,
      ultimoLogin: f.ultimoLogin,
      papeis: f.papeis.map((p) => p.key),
      produtos: (["ops", "growth", "financeiro"] as const).filter((p) => f.produtos[p]),
      escopo: { todas: f.escopo.todasUnidades, unidades: f.escopo.unidades },
      growth: f.growth,
      administra: f.areas
        .filter((a) => a.origens.includes("admin") || a.origens.includes("socio"))
        .map((a) => ({ area: a.slug })),
      pedidoPendente: f.pedido,
      unidadeSocio: f.socio?.unidade ?? null,
      banida: f.banida,
    }),
    [f],
  );
  const situacao = situacaoDe(entrada);
  const pendencias = [
    ...pendenciasDe(entrada),
    ...(f.genteSemVinculo
      ? [`O cadastro "${f.genteSemVinculo.nome}" do Planning People não está ligado a esta conta: 1:1, feedback e PDI barram a pessoa. Confira o gestor antes de ligar.`]
      : []),
    ...(f.senhaProvisoria ? ["Está com senha provisória: no próximo acesso é obrigada a cadastrar a dela."] : []),
  ];

  const portaFn = useServerFn(adminDefinirPortaOps);
  const porta = useMutation({
    mutationFn: (conceder: boolean) => portaFn({ data: { userId: f.userId, conceder } }),
    onSuccess: (r) => {
      toast.success(r.conceder ? `${primeiroNome} passou a entrar no Ops.` : `${primeiroNome} não entra mais no Ops.`);
      qc.invalidateQueries({ queryKey: ["ficha-pessoa", f.userId] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const vincularFn = useServerFn(adminVincularGente);
  const vincular = useMutation({
    mutationFn: (pessoaId: number) => vincularFn({ data: { userId: f.userId, pessoaId } }),
    onSuccess: () => {
      toast.success("Cadastro do Planning People ligado.");
      qc.invalidateQueries({ queryKey: ["ficha-pessoa", f.userId] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao ligar."),
  });

  const liberarFn = useServerFn(adminReativarPessoa);
  const liberar = useMutation({
    mutationFn: () => liberarFn({ data: { userId: f.userId } }),
    onSuccess: () => {
      toast.success(`Login de ${primeiroNome} liberado.`);
      qc.invalidateQueries({ queryKey: ["ficha-pessoa", f.userId] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao liberar."),
  });

  const excluirFn = useServerFn(adminDeleteUser);
  const excluir = useMutation({
    mutationFn: () => excluirFn({ data: { user_id: f.userId } }),
    onSuccess: () => {
      toast.success(`Conta de ${f.email} excluída.`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      navigate({ to: "/admin/usuarios" });
    },
  });

  const areasQueAbre = f.areas.filter((a) => a.abre);
  const nProdutos = Object.values(f.produtos).filter(Boolean).length;
  const perfisTexto = f.papeis.map((p) => p.label).join(" + ");

  return (
    <>
      <PageHeader
        area="admin"
        titulo={nome}
        pergunta={`O que ${primeiroNome} acessa, e por quê?`}
        descricao={
          <>
            {f.email} · {f.ultimoLogin ? `último acesso ${haQuanto(f.ultimoLogin)}` : "nunca entrou"}
            {f.criadoEm && ` · conta criada ${haQuanto(f.criadoEm)}`}
          </>
        }
        acoes={
          <>
            <StatusBadge tom={TOM_SITUACAO[situacao]}>{ROTULO_SITUACAO[situacao]}</StatusBadge>
            <Button variant="outline" onClick={() => setDialogo("senha")} disabled={!f.ativo}>
              Senha
            </Button>
            {f.ativo && f.banida && (
              <Button variant="outline" disabled={liberar.isPending} onClick={() => liberar.mutate()}>
                Liberar login
              </Button>
            )}
            {!f.souEu && f.convitePendente && (
              <Button variant="outline" className="text-danger" onClick={() => setDialogo("excluir")}>
                Excluir
              </Button>
            )}
            {!f.souEu && (
              <Button variant="outline" onClick={() => setDialogo("desativar")}>
                {f.ativo ? "Desativar" : "Reativar"}
              </Button>
            )}
            <Button onClick={() => setDialogo("editar")}>Editar</Button>
          </>
        }
      />

      {resultado && <PainelResultado r={resultado} onFechar={() => setResultado(null)} />}

      {!f.ativo && (
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-foreground">
            Conta desativada: não entra em nenhum produto. O que está abaixo é o que ela volta a ter
            se for reativada.
          </p>
        </div>
      )}

      {pendencias.length > 0 && (
        <Secao titulo="O que está pendente?" descricao="Acesso que não funciona como parece. Cada item diz o efeito.">
          <ul className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm">
            {pendencias.map((p) => (
              <li key={p} className="flex items-start gap-2 text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <KpiGrade colunas={4}>
        <KpiCard rotulo="Produtos" valor={`${nProdutos} de 3`} nota="Ops, Growth e Financeiro" />
        <KpiCard
          rotulo="Áreas do Ops que abre"
          valor={f.superAdmin ? "Todas" : areasQueAbre.length}
          nota={f.superAdmin ? "super admin" : `${f.totalChaves} páginas e ações no total`}
        />
        <KpiCard
          rotulo="Unidades que vê"
          valor={f.escopo.todasUnidades ? "Todas" : f.escopo.unidades.length}
          nota={f.escopo.todasUnidades ? "inclusive as futuras" : "recorte por pessoa"}
          tom={!f.escopo.todasUnidades && !f.escopo.unidades.length && areasQueAbre.some((a) => a.escopo === "unidade") ? "atencao" : undefined}
        />
        <KpiCard
          rotulo="Último acesso"
          valor={f.ultimoLogin ? haQuanto(f.ultimoLogin) : "Nunca"}
          nota={f.convitePendente ? "convite ainda não usado" : undefined}
        />
      </KpiGrade>

      <Secao titulo="Em quais produtos entra?" descricao="A porta de cada produto. O que ela faz dentro de cada um vem nas seções abaixo.">
        <div className="divide-y rounded-xl border bg-card">
          <LinhaProduto
            nome="Ops"
            entra={f.produtos.ops}
            detalhe={
              f.superAdmin
                ? "Super admin: acesso total."
                : perfisTexto
                  ? `Perfil ${perfisTexto}${f.papeis.length > 1 ? " (vê a soma dos dois)" : ""}.`
                  : "Sem perfil: entra só no que for dado a ela área por área."
            }
            acao={
              <Button variant="outline" size="sm" onClick={() => setDialogo("acessos")}>
                Mudar acessos no Ops
              </Button>
            }
          />
          <LinhaProduto
            nome="Growth"
            entra={f.produtos.growth}
            detalhe={f.growth ? `${f.growth.papel} · ${f.growth.departamento ?? "sem departamento"}` : "Sem papel no Growth."}
            acao={
              <Button variant="outline" size="sm" onClick={() => setDialogo("growth")}>
                {f.growth ? "Mudar no Growth" : "Dar acesso ao Growth"}
              </Button>
            }
          />
          <LinhaProduto
            nome="Financeiro"
            entra={f.produtos.financeiro}
            detalhe={
              !f.produtos.financeiro
                ? "Não entra no cockpit."
                : f.escopo.todasEmpresas
                  ? "Todas as empresas, inclusive as futuras."
                  : f.escopo.empresas.length
                    ? `Empresas: ${f.escopo.empresas.join(", ")}.`
                    : "Entra, mas sem nenhuma empresa: o cockpit abre vazio."
            }
            acao={
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin/acessos-financeiro">Acessos do Financeiro</Link>
              </Button>
            }
          />
        </div>
      </Secao>

      <Secao
        titulo="Quais áreas do Ops abre, e de onde vem cada uma?"
        descricao="É a mesma regra do menu dela e do banco. Uma área pode vir de mais de um lugar."
        acoes={
          <Button variant="outline" size="sm" onClick={() => setDialogo("acessos")}>
            Mudar acessos
          </Button>
        }
      >
        {f.superAdmin ? (
          <EstadoVazio
            titulo="Super admin abre todas as áreas"
            descricao="Vem do perfil Super admin e não se ajusta área por área."
          />
        ) : f.areas.length === 0 ? (
          <EstadoVazio
            titulo="Não abre nenhuma área do Ops"
            descricao={
              f.produtos.ops
                ? "Entra no Ops e cai em “você ainda não tem acesso”. Dê um perfil (Editar) ou áreas (Mudar acessos)."
                : "Sem perfil e sem áreas."
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Área</TableHead>
                  <TableHead>Abre?</TableHead>
                  <TableHead>De onde vem</TableHead>
                  <TableHead>Páginas</TableHead>
                  <TableHead>Recorte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.areas.map((a) => (
                  <LinhaArea key={a.slug} a={a} perfisTexto={perfisTexto} ops={f.produtos.ops} ativo={f.ativo} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      <Secao
        titulo="De quais unidades vê os dados?"
        descricao="O recorte vale em todas as áreas recortadas por unidade."
        acoes={
          <Button variant="outline" size="sm" onClick={() => setDialogo("recorte")}>
            Mudar recorte
          </Button>
        }
      >
        <div className="rounded-xl border bg-card p-4 text-sm">
          {f.escopo.todasUnidades ? (
            <p className="text-foreground">Todas as unidades, inclusive as que ainda vão existir.</p>
          ) : f.escopo.unidades.length ? (
            <p className="text-foreground">{f.escopo.unidades.map((u) => u.nome).join(", ")}.</p>
          ) : (
            <p className="text-warning">Nenhuma unidade: as telas recortadas por unidade abrem vazias.</p>
          )}
          {f.socio && (
            <p className="mt-2 text-muted-foreground">
              Cadastro de sócio: {f.socio.unidade ? `sócio de ${f.socio.unidade}` : "sem unidade"}. É só
              cadastro (aparece em Rede); o que ela vê é o recorte acima.
            </p>
          )}
        </div>
      </Secao>

      <Secao titulo="Que cadastros estão ligados a ela?" descricao="Login e cadastro de pessoa são duas coisas, e as duas precisam estar ligadas.">
        <div className="divide-y rounded-xl border bg-card text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-foreground">Planning People</p>
              <p className="text-muted-foreground">
                {f.gente
                  ? `Ligada a ${f.gente.nome}${f.gente.cargo ? `, ${f.gente.cargo}` : ""}${f.gente.unidade ? `, ${f.gente.unidade}` : ""}.`
                  : f.genteSemVinculo
                    ? `Existe o cadastro "${f.genteSemVinculo.nome}" com este e-mail, sem login ligado${
                        f.genteSemVinculo.unidade ? `, na unidade ${f.genteSemVinculo.unidade}` : ""
                      }. Gestor: ${f.genteSemVinculo.gestor ?? "nenhum"}${
                        f.genteSemVinculo.manual ? " (cadastrado à mão no People)" : " (importado do Qulture)"
                      }. Ligar dá ao gestor a leitura dos 1:1 e PDIs dela.`
                    : "Sem cadastro no Planning People com este e-mail."}
              </p>
            </div>
            {f.genteSemVinculo && (
              <Button
                variant="outline"
                size="sm"
                disabled={vincular.isPending}
                onClick={() => vincular.mutate(f.genteSemVinculo!.id)}
              >
                Ligar cadastro
              </Button>
            )}
          </div>
          {f.pedido && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium text-foreground">Pedido de acesso aberto</p>
                <p className="text-muted-foreground">
                  {f.pedido.cargo}, {f.pedido.unidade}, pedido {haQuanto(f.pedido.criadoEm)}.{" "}
                  {f.pedido.confirmado
                    ? "Aguarda o sócio da unidade."
                    : "Ainda não confirmou o e-mail: o sócio só vê depois disso."}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/equipe">Abrir em Equipes</Link>
              </Button>
            </div>
          )}
        </div>
      </Secao>

      <Secao titulo="O que mudou no acesso dela?" descricao="As últimas 60 ações de administração com ela ou feitas por ela.">
        {f.historico.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma ação registrada"
            descricao="O histórico completo de criação, perfil, porta e senha começou em 25/09/2026; antes só as ações de área eram registradas."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>O quê</TableHead>
                  <TableHead>Quem fez</TableHead>
                  <TableHead>Com quem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.historico.map((e, i) => (
                  <LinhaHistorico key={`${e.quando}-${i}`} e={e} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      <Procedencia
        fonte="Banco único · ops.acesso_do_usuario (a mesma regra do menu e da RLS), ops.acessos_log"
        atualizadoEm={atualizadoEm}
      />

      {dialogo === "senha" && (
        <SenhaDialog
          pessoa={{ userId: f.userId, nome, email: f.email, souEu: f.souEu, superAdmin: f.superAdmin }}
          onResultado={setResultado}
          onFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === "editar" && (
        <EditarPessoaDialog
          pessoa={{ userId: f.userId, nome: f.nome ?? "", email: f.email, papeis: f.papeis.map((p) => p.key), souEu: f.souEu }}
          perfis={perfis}
          onFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === "desativar" && (
        <DesativarDialog pessoa={{ userId: f.userId, nome, ativo: f.ativo }} onFechar={() => setDialogo(null)} />
      )}
      {dialogo === "growth" && (
        <GrowthDialog
          pessoa={{ userId: f.userId, nome, email: f.email, atual: f.growth }}
          onFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === "recorte" && (
        <EscopoUsuarioDialog userId={f.userId} nome={nome} onClose={() => setDialogo(null)} />
      )}
      {dialogo === "acessos" && (
        <AcessosUsuarioDialog
          userId={f.userId}
          nome={nome}
          porta={{
            tem: f.produtos.ops,
            salvando: porta.isPending,
            erro: porta.isError ? (porta.error as Error)?.message : null,
            onDefinir: (conceder) => porta.mutate(conceder),
          }}
          onClose={() => {
            setDialogo(null);
            qc.invalidateQueries({ queryKey: ["ficha-pessoa", f.userId] });
          }}
        />
      )}
      <AlertDialog open={dialogo === "excluir"} onOpenChange={(v) => !v && setDialogo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a conta {f.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Só vale para quem nunca entrou, como um convite com e-mail errado. Apaga a conta de vez e
              não tem volta. Para quem já entrou, use Desativar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {excluir.isError && <p className="text-sm text-danger">{(excluir.error as Error)?.message}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                excluir.mutate();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LinhaProduto({
  nome,
  entra,
  detalhe,
  acao,
}: {
  nome: string;
  entra: boolean;
  detalhe: string;
  acao: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-2 font-medium text-foreground">
          {nome}
          <StatusBadge tom={entra ? "sucesso" : "neutro"}>{entra ? "entra" : "não entra"}</StatusBadge>
        </p>
        <p className="text-muted-foreground">{detalhe}</p>
      </div>
      {acao}
    </div>
  );
}

function LinhaArea({
  a,
  perfisTexto,
  ops,
  ativo,
}: {
  a: AreaNaFicha;
  perfisTexto: string;
  ops: boolean;
  ativo: boolean;
}) {
  const areaInteira = a.origens.some((o) => o !== "pessoa");
  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{a.nome}</TableCell>
      <TableCell>
        {a.bloqueada ? (
          <StatusBadge tom="perigo">bloqueada</StatusBadge>
        ) : a.abre ? (
          <StatusBadge tom="sucesso">abre</StatusBadge>
        ) : (
          <StatusBadge tom="neutro" icone={false}>
            {!ativo ? "conta desativada" : !ops && a.escopo !== "empresa" ? "sem a porta do Ops" : "não abre"}
          </StatusBadge>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {a.origens.length === 0
          ? a.bloqueada
            ? "Bloqueada pelo super admin"
            : "—"
          : a.origens
              .map((o) => (o === "perfil" ? `${ROTULO_ORIGEM.perfil} ${perfisTexto}` : ROTULO_ORIGEM[o]))
              .join(" · ")}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {areaInteira ? "todas" : `${a.paginas.length} de ${a.totalPaginas}`}
        {a.negadas.length > 0 && `, ${a.negadas.length} negada${a.negadas.length > 1 ? "s" : ""}`}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {a.escopo === "unidade" ? "por unidade" : a.escopo === "empresa" ? "por empresa" : "sem recorte"}
      </TableCell>
    </TableRow>
  );
}

const QUANDO = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function LinhaHistorico({ e }: { e: EventoDoHistorico }) {
  const extra =
    typeof e.detalhe?.motivo === "string" && e.detalhe.motivo
      ? ` (${e.detalhe.motivo})`
      : typeof e.detalhe?.nivel === "string"
        ? ` como ${e.detalhe.nivel === "admin" ? "admin" : "sócio"}`
        : "";
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{QUANDO.format(new Date(e.quando))}</TableCell>
      <TableCell className="text-sm text-foreground">
        {ROTULO_ACAO[e.acao] ?? e.acao}
        {e.area && <span className="text-muted-foreground"> · {e.area}</span>}
        {extra}
      </TableCell>
      <TableCell className="text-sm">{e.ator ?? "sistema"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{e.alvo ?? "—"}</TableCell>
    </TableRow>
  );
}
