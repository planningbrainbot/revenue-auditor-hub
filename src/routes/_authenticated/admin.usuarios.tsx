import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Plus, Search } from "lucide-react";
import { adminCreateUser, adminListUsers, type PessoaNaLista } from "@/lib/admin-users.functions";
import { listRoles } from "@/lib/roles.functions";
import {
  ROTULO_SITUACAO,
  TOM_SITUACAO,
  dominioIncomum,
  haQuanto,
  pendenciasDe,
  situacaoDe,
  type Situacao,
} from "@/lib/pessoas-situacao";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { PainelResultado, type ResultadoDeAcesso } from "@/components/admin/pessoa-dialogos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Pessoas: quem entra no Brain, em quê, e o que está pendente.
 *
 * Refeita em 24/09/2026 depois da auditoria da gestão de acessos. A tela antiga
 * fazia tudo numa linha (papel, recorte, três produtos, senha, excluir) e não
 * respondia a pergunta que importa: o que esta pessoa acessa, e por quê. Agora
 * a lista diz a SITUAÇÃO de cada pessoa e aponta o que está errado; tudo o que
 * se faz com uma pessoa mora na ficha dela (/admin/usuarios/$userId).
 */
const SITUACOES: Situacao[] = ["ativa", "pendencia", "convite", "pedido", "desativada"];
type FiltroSituacao = Situacao | "todas";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  ssr: false,
  head: () => ({ meta: [{ title: "Pessoas – Planning Brain" }] }),
  // Os dois filtros são opcionais na URL: sem eles, a lista abre inteira. Assim
  // qualquer link para Pessoas funciona sem ter de repetir o padrão.
  validateSearch: (s: Record<string, unknown>): { situacao?: Situacao; busca?: string } => ({
    ...((SITUACOES as string[]).includes(String(s.situacao)) ? { situacao: s.situacao as Situacao } : {}),
    ...(typeof s.busca === "string" && s.busca ? { busca: s.busca } : {}),
  }),
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
  component: PessoasPage,
});

function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function PessoasPage() {
  const navigate = useNavigate();
  const nav = Route.useNavigate();
  const search = Route.useSearch();
  const situacao: FiltroSituacao = search.situacao ?? "todas";
  const busca = search.busca ?? "";
  const { isAdmin, loading } = usePermissions();

  const listFn = useServerFn(adminListUsers);
  const rolesFn = useServerFn(listRoles);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/" });
  }, [loading, isAdmin, navigate]);

  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn(), enabled: isAdmin });
  const perfisQ = useQuery({ queryKey: ["admin-roles"], queryFn: () => rolesFn(), enabled: isAdmin });
  const rotuloPerfil = useMemo(
    () => new Map((perfisQ.data ?? []).map((r) => [r.key, r.label])),
    [perfisQ.data],
  );

  const [criando, setCriando] = useState(false);
  const [resultado, setResultado] = useState<(ResultadoDeAcesso & { userId?: string }) | null>(null);

  const pessoas = useMemo(
    () =>
      (q.data ?? []).map((p) => {
        const entrada = { ...p, unidadeSocio: p.unidade };
        return { ...p, situacao: situacaoDe(entrada), pendencias: pendenciasDe(entrada) };
      }),
    [q.data],
  );

  const contagem = useMemo(() => {
    const c = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>;
    for (const p of pessoas) c[p.situacao]++;
    return c;
  }, [pessoas]);

  const filtradas = useMemo(() => {
    const t = normalizar(busca);
    return pessoas
      .filter((p) => situacao === "todas" || p.situacao === situacao)
      .filter(
        (p) =>
          !t ||
          normalizar(
            `${p.nome ?? ""} ${p.email} ${p.papeis.map((r) => rotuloPerfil.get(r) ?? r).join(" ")} ${p.escopo.unidades.join(" ")}`,
          ).includes(t),
      )
      .sort((a, b) => (a.nome ?? a.email).localeCompare(b.nome ?? b.email, "pt-BR"));
  }, [pessoas, situacao, busca, rotuloPerfil]);

  const mudarFiltro = (next: Partial<{ situacao: FiltroSituacao; busca: string }>) =>
    nav({
      search: (s) => {
        const proximo = { ...s, ...next };
        return {
          ...(proximo.situacao && proximo.situacao !== "todas" ? { situacao: proximo.situacao as Situacao } : {}),
          ...(proximo.busca ? { busca: proximo.busca } : {}),
        };
      },
      replace: true,
    });

  if (loading || !isAdmin) return null;

  return (
    <AppShell
      title="Quem entra no Brain, e em quê?"
      subtitle={
        q.data
          ? `${q.data.length} pessoas com conta · Ops, Growth e Financeiro · a situação de cada uma e o que está pendente`
          : "Pessoas com conta no Brain"
      }
      headerExtra={
        <Button onClick={() => setCriando(true)}>
          <Plus className="size-4" aria-hidden /> Nova pessoa
        </Button>
      }
    >
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {resultado && (
          <div className="space-y-2">
            <PainelResultado r={resultado} onFechar={() => setResultado(null)} />
            {resultado.userId && (
              <Link
                to="/admin/usuarios/$userId"
                params={{ userId: resultado.userId }}
                className="text-sm font-medium text-primary-text hover:underline"
              >
                Abrir a ficha da pessoa criada
              </Link>
            )}
          </div>
        )}

        {q.isLoading ? (
          <Carregando variante="pagina" />
        ) : q.isError ? (
          <EstadoErro detalhe={(q.error as Error)?.message} tentarNovamente={() => q.refetch()} />
        ) : (
          <>
            <KpiGrade colunas={4}>
              <KpiCard
                rotulo="Com pendência"
                valor={contagem.pendencia}
                nota="acesso que não funciona como parece"
                tom={contagem.pendencia ? "atencao" : undefined}
                abrir={{ onClick: () => mudarFiltro({ situacao: "pendencia" }), rotulo: "Ver quem" }}
              />
              <KpiCard
                rotulo="Convite pendente"
                valor={contagem.convite}
                nota="têm conta e nunca entraram"
                abrir={{ onClick: () => mudarFiltro({ situacao: "convite" }), rotulo: "Ver quem" }}
              />
              <KpiCard
                rotulo="Pediram acesso"
                valor={contagem.pedido}
                nota="aguardam o sócio da unidade, em Equipes"
                abrir={{ onClick: () => mudarFiltro({ situacao: "pedido" }), rotulo: "Ver quem" }}
              />
              <KpiCard
                rotulo="Desativadas"
                valor={contagem.desativada}
                nota="fora dos três produtos; reativar devolve tudo"
                abrir={{ onClick: () => mudarFiltro({ situacao: "desativada" }), rotulo: "Ver quem" }}
              />
            </KpiGrade>

            <Secao
              titulo="Pessoas"
              descricao="Clique numa pessoa para ver o que ela acessa, de onde vem cada acesso, e mudar."
              acoes={
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={situacao} onValueChange={(v) => mudarFiltro({ situacao: v as FiltroSituacao })}>
                    <SelectTrigger className="h-9 w-[190px]" aria-label="Situação">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas as situações</SelectItem>
                      {SITUACOES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ROTULO_SITUACAO[s]} ({contagem[s]})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      value={busca}
                      onChange={(e) => mudarFiltro({ busca: e.target.value })}
                      placeholder="Nome, e-mail, perfil ou unidade"
                      aria-label="Buscar pessoa"
                      className="h-9 w-[260px] pl-8"
                    />
                  </div>
                </div>
              }
            >
              {filtradas.length === 0 ? (
                <EstadoVazio
                  titulo="Ninguém com esse filtro"
                  total={pessoas.length}
                  acao={
                    <Button variant="outline" size="sm" onClick={() => mudarFiltro({ situacao: "todas", busca: "" })}>
                      Limpar filtros
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pessoa</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Perfil</TableHead>
                        <TableHead>Unidades que vê</TableHead>
                        <TableHead>Produtos</TableHead>
                        <TableHead>Último acesso</TableHead>
                        <TableHead>
                          <span className="sr-only">Abrir</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtradas.map((p) => (
                        <LinhaPessoa key={p.user_id} p={p} rotuloPerfil={rotuloPerfil} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Secao>
          </>
        )}
      </div>

      {criando && (
        <NovaPessoaDialog
          perfis={(perfisQ.data ?? []).map((r) => ({ key: r.key, label: r.label, areas: r.areas }))}
          onFechar={() => setCriando(false)}
          onCriada={(r) => setResultado(r)}
        />
      )}
    </AppShell>
  );
}

function LinhaPessoa({
  p,
  rotuloPerfil,
}: {
  p: PessoaNaLista & { situacao: Situacao; pendencias: string[] };
  rotuloPerfil: Map<string, string>;
}) {
  const navigate = useNavigate();
  const abrir = () => navigate({ to: "/admin/usuarios/$userId", params: { userId: p.user_id } });
  return (
    <TableRow className="cursor-pointer" onClick={abrir}>
      <TableCell>
        <Link
          to="/admin/usuarios/$userId"
          params={{ userId: p.user_id }}
          className="font-medium text-foreground hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {p.nome || p.email}
        </Link>
        <p className="text-[13px] text-muted-foreground">{p.email}</p>
      </TableCell>
      <TableCell>
        <StatusBadge tom={TOM_SITUACAO[p.situacao]}>{ROTULO_SITUACAO[p.situacao]}</StatusBadge>
        {p.pendencias.length > 0 && (
          <p className="mt-1 max-w-[260px] text-[13px] text-muted-foreground" title={p.pendencias.join("\n")}>
            {p.pendencias[0]}
            {p.pendencias.length > 1 && ` (+${p.pendencias.length - 1})`}
          </p>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {p.papeis.length ? (
          p.papeis.map((r) => rotuloPerfil.get(r) ?? r).join(" + ")
        ) : (
          <span className="text-muted-foreground">sem perfil</span>
        )}
        {p.administra.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            administra {p.administra.length} {p.administra.length === 1 ? "área" : "áreas"}
          </p>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {p.escopo.todas ? (
          "Todas"
        ) : p.escopo.unidades.length === 0 ? (
          <span className="text-muted-foreground">nenhuma</span>
        ) : (
          <span title={p.escopo.unidades.join(", ")}>
            {p.escopo.unidades[0]}
            {p.escopo.unidades.length > 1 && ` +${p.escopo.unidades.length - 1}`}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {(["ops", "growth", "financeiro"] as const).map((prod) => (
            <span
              key={prod}
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                p.produtos.includes(prod)
                  ? "bg-muted font-medium text-foreground"
                  : "border border-dashed text-muted-foreground line-through",
              )}
            >
              {prod === "ops" ? "Ops" : prod === "growth" ? "Growth" : "Financeiro"}
            </span>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{haQuanto(p.ultimoLogin)}</TableCell>
      <TableCell className="text-right">
        <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
      </TableCell>
    </TableRow>
  );
}

/**
 * Nova pessoa, inteira de uma vez: conta, perfil, recorte de unidades e
 * cadastro de sócio. Até 24/09/2026 o recorte era um segundo passo que a tela
 * não pedia, e o perfil "Diretor", marcado por padrão, não era gravado.
 */
function NovaPessoaDialog({
  perfis,
  onFechar,
  onCriada,
}: {
  perfis: { key: string; label: string; areas: string[] }[];
  onFechar: () => void;
  onCriada: (r: ResultadoDeAcesso & { userId?: string }) => void;
}) {
  const qc = useQueryClient();
  const criarFn = useServerFn(adminCreateUser);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  // Sem perfil pré-marcado: o antigo vinha em "Diretor" e ninguém percebia.
  const [perfil, setPerfil] = useState<string>("");
  const [recorte, setRecorte] = useState<"todas" | "escolher">("escolher");
  const [unidades, setUnidades] = useState<number[]>([]);
  const [unidadeSocio, setUnidadeSocio] = useState<string>("");

  const unidadesQ = useQuery({
    queryKey: ["admin-unidades-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("unidades").select("id, nome_da_praca").order("nome_da_praca");
      if (error) throw error;
      return ((data ?? []) as { id: number; nome_da_praca: string | null }[]).filter((u) => u.nome_da_praca);
    },
  });

  const semOps = perfil === "__sem_ops__";
  const socioRegional = perfil === "socio_regional";
  const perfilEscolhido = perfis.find((p) => p.key === perfil);
  const precisaRecorte = Boolean(perfil) && !semOps && !socioRegional;
  const recorteOk = !precisaRecorte || recorte === "todas" || unidades.length > 0;
  const pronto =
    nome.trim() && email.trim() && perfil && recorteOk && (!socioRegional || unidadeSocio);

  const criar = useMutation({
    mutationFn: () =>
      criarFn({
        data: {
          nome: nome.trim(),
          email: email.trim().toLowerCase(),
          role: semOps ? null : perfil,
          escopo: { todas: precisaRecorte && recorte === "todas", unidades: precisaRecorte ? unidades : [] },
          unidadeSocio: socioRegional ? Number(unidadeSocio) : null,
        },
      }),
    onSuccess: (r) => {
      toast.success(`${nome.trim()} criada.`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      onCriada({
        tipo: "link",
        titulo: r.emailEnviado ? "Convite enviado" : "Pessoa criada, mas o e-mail não saiu",
        email: r.email,
        link: r.emailEnviado ? null : r.link,
        enviado: r.emailEnviado,
        erro: r.emailErro,
        userId: r.user_id,
      });
      onFechar();
    },
  });

  const alterna = (id: number) =>
    setUnidades((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova pessoa</DialogTitle>
          <DialogDescription>
            A pessoa recebe um e-mail para definir a própria senha. Growth e Financeiro se dão na
            ficha dela, depois de criada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nova-nome">Nome</Label>
              <Input id="nova-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nova-email">E-mail</Label>
              <Input id="nova-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {email.includes("@") && dominioIncomum(email) && (
                <p className="text-[13px] text-warning">
                  Domínio fora do grupo. Confira a digitação: um e-mail errado não recebe o convite.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Perfil no Ops</Label>
            <Select value={perfil} onValueChange={setPerfil}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o perfil" />
              </SelectTrigger>
              <SelectContent>
                {perfis.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                    {p.key !== "admin" && !p.areas.length ? " · não abre nenhuma área" : ""}
                  </SelectItem>
                ))}
                <SelectItem value="__sem_ops__">Sem acesso ao Ops (só Growth ou Financeiro)</SelectItem>
              </SelectContent>
            </Select>
            {perfilEscolhido && (
              <p className="text-[13px] text-muted-foreground">
                {perfilEscolhido.key === "admin"
                  ? "Acesso total, inclusive a esta Administração."
                  : perfilEscolhido.areas.length
                    ? `Abre: ${perfilEscolhido.areas.join(", ")}.`
                    : "Este perfil não abre nenhuma área. A pessoa entra e não vê nada até alguém dar áreas a ela."}
              </p>
            )}
          </div>

          {socioRegional && (
            <div className="space-y-1">
              <Label>Unidade do sócio</Label>
              <Select value={unidadeSocio} onValueChange={setUnidadeSocio}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {(unidadesQ.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.nome_da_praca}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[13px] text-muted-foreground">
                O sócio regional vê só esta unidade, e ela vai também para o cadastro de sócio.
              </p>
            </div>
          )}

          {precisaRecorte && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">Unidades que a pessoa vê</legend>
              <RadioGroup value={recorte} onValueChange={(v) => setRecorte(v as "todas" | "escolher")} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="recorte-todas" value="todas" />
                  <Label htmlFor="recorte-todas" className="font-normal">
                    Todas, inclusive as futuras
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="recorte-escolher" value="escolher" />
                  <Label htmlFor="recorte-escolher" className="font-normal">
                    Escolher
                  </Label>
                </div>
              </RadioGroup>
              {recorte === "escolher" && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(unidadesQ.data ?? []).map((u) => (
                    <div key={u.id} className="flex items-center gap-2">
                      <Checkbox id={`nova-un-${u.id}`} checked={unidades.includes(u.id)} onCheckedChange={() => alterna(u.id)} />
                      <Label htmlFor={`nova-un-${u.id}`} className="truncate font-normal">
                        {u.nome_da_praca}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              {!recorteOk && (
                <p className="text-[13px] text-warning">
                  Sem nenhuma unidade, as telas recortadas por unidade abrem vazias. Marque as
                  unidades ou "Todas".
                </p>
              )}
            </fieldset>
          )}
        </div>

        {criar.isError && <p className="text-sm text-danger">{(criar.error as Error)?.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={!pronto || criar.isPending}>
            {criar.isPending ? "Criando…" : "Criar e enviar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
