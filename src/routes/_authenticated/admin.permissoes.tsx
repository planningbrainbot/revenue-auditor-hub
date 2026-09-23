import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Minus, Search, ShieldCheck, Users } from "lucide-react";
import {
  listAdministradoresPorArea,
  listRoleAreas,
  salvarAreasDoPapel,
  type Area,
} from "@/lib/permissions.functions";
import { AppShell } from "@/components/app-shell";
import { EstadoVazio, Secao, StatusBadge } from "@/components/planning";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Permissões por ÁREA.
 *
 * Histórico curto: a tela tinha 66 linhas por 10 colunas, uma linha por chave,
 * e crescia uma linha a cada página nova. Em 15/09/2026 a unidade de concessão
 * virou a ÁREA, o que derrubou as linhas para 10 e resolveu o tamanho.
 *
 * Não resolveu o RISCO, que é o que esta versão (23/09/2026) ataca. A grade
 * passou a ter 14 áreas por 12 papéis, 168 caixinhas para 37 concessões: 78%
 * de células vazias para varrer, uma rolagem horizontal que tirava o nome do
 * papel da tela, e cada caixinha salvando sozinha no clique, sem confirmação e
 * sem desfazer. Marcar a coluna `financeiro` mexia em 8 pessoas e a `head` em
 * 1, com a mesma aparência.
 *
 * Agora a matriz é LEITURA (papel na linha, área na coluna, um retrato de quem
 * vê o quê) e a concessão acontece num papel por vez, no painel lateral, onde
 * cabe dizer quem são as pessoas afetadas e mostrar o efeito em palavras antes
 * de gravar. É o arquétipo Configuração de docs/design/ARQUETIPOS.md §5.
 *
 * O segundo nível, QUAIS unidades e empresas cada pessoa enxerga, continua
 * sendo por usuário e mora em /admin/usuarios.
 */
export const Route = createFileRoute("/_authenticated/admin/permissoes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Permissões – Planning" }] }),
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { id: string } }).user;
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/" });
  },
  component: PermissionsPage,
});

const ROTULO_ESCOPO: Record<string, string> = {
  unidade: "Filtra por unidade",
  empresa: "Filtra por empresa",
  nenhum: "Sem filtro de escopo",
};

/** Ordem em que os grupos de escopo aparecem no painel de edição. */
const ORDEM_ESCOPO = ["unidade", "empresa", "nenhum"] as const;

/** Sentinela do "não comparar com ninguém" no seletor de comparação. */
const SEM_COMPARACAO = "__nenhum__";

/**
 * Fundo opaco da coluna grudada. Precisa ser a MISTURA já resolvida, e não
 * `bg-muted/40` de novo: a célula fica por cima das outras e um fundo
 * translúcido deixa as caixinhas passarem por baixo do nome do papel enquanto
 * a tabela rola. Mesma técnica do `grudavel` de components/ui/table.tsx.
 */
const FUNDO_CABECALHO_GRUDADO = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";
const FUNDO_LINHA_GRUDADA_HOVER =
  "group-hover:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";

type Papel = { key: string; label: string; description: string; is_system: boolean };
type Pessoa = { role: string; userId: string; nome: string };

/** Busca sem acento e sem caixa: "monetizacao" acha "Monetização". */
function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function plural(n: number, um: string, muitos: string) {
  return `${n} ${n === 1 ? um : muitos}`;
}

function PermissionsPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = usePermissions();
  const listFn = useServerFn(listRoleAreas);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/" });
  }, [loading, isAdmin, navigate]);

  const q = useQuery({ queryKey: ["role-areas"], queryFn: () => listFn(), enabled: isAdmin });

  // Quem administra cada área (admin ou sócio). Nomear é na tela de Usuários,
  // botão "Acessos": aqui é só a leitura. Saiu de dentro da matriz em 23/09 —
  // eram quatro linhas de texto por área empurrando as caixinhas para longe do
  // nome da coluna.
  const adminsFn = useServerFn(listAdministradoresPorArea);
  const adminsQ = useQuery({
    queryKey: ["area-admins"],
    queryFn: () => adminsFn(),
    enabled: isAdmin,
  });
  const adminsPorArea = useMemo(() => {
    const map = new Map<string, { nome: string; nivel: "admin" | "socio" }[]>();
    for (const l of adminsQ.data ?? []) {
      const lista = map.get(l.area) ?? [];
      lista.push({ nome: l.nome, nivel: l.nivel });
      map.set(l.area, lista);
    }
    for (const lista of map.values())
      lista.sort((x, y) =>
        x.nivel === y.nivel ? x.nome.localeCompare(y.nome, "pt-BR") : x.nivel === "admin" ? -1 : 1,
      );
    return map;
  }, [adminsQ.data]);

  const areas = useMemo(() => (q.data?.areas ?? []) as Area[], [q.data]);
  const papeis = useMemo(() => (q.data?.roles ?? []) as Papel[], [q.data]);
  const pessoas = useMemo(() => (q.data?.pessoas ?? []) as Pessoa[], [q.data]);

  /** `papel__area` -> concedida. Ausente e `false` valem a mesma coisa. */
  const concedida = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const g of q.data?.grants ?? []) map.set(`${g.role}__${g.area}`, g.allowed);
    return map;
  }, [q.data]);

  const pessoasPorPapel = useMemo(() => {
    const map = new Map<string, Pessoa[]>();
    for (const p of pessoas) map.set(p.role, [...(map.get(p.role) ?? []), p]);
    return map;
  }, [pessoas]);

  const chavesPorArea = useMemo(() => {
    const dicionario = new Map((q.data?.dicionario ?? []).map((d) => [d.key, d]));
    const map = new Map<string, { key: string; label: string }[]>();
    for (const c of q.data?.chaves ?? []) {
      const lista = map.get(c.area) ?? [];
      lista.push({
        key: c.permission_key,
        label: dicionario.get(c.permission_key)?.label ?? c.permission_key,
      });
      map.set(c.area, lista);
    }
    for (const lista of map.values()) lista.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return map;
  }, [q.data]);

  /** Papéis ordenados por quanta gente carregam: o peso da linha primeiro. */
  const papeisOrdenados = useMemo(
    () =>
      [...papeis].sort(
        (x, y) =>
          (pessoasPorPapel.get(y.key)?.length ?? 0) - (pessoasPorPapel.get(x.key)?.length ?? 0) ||
          x.label.localeCompare(y.label, "pt-BR"),
      ),
    [papeis, pessoasPorPapel],
  );

  // Uma busca só, que recorta os dois eixos: "receita" deixa a coluna Receita,
  // "CS" deixa a linha do CS. Um eixo sem resultado fica inteiro, senão a tela
  // some por completo quando o termo só existe do outro lado.
  const [busca, setBusca] = useState("");
  const { linhas, colunas } = useMemo(() => {
    const t = normalizar(busca);
    if (!t) return { linhas: papeisOrdenados, colunas: areas };
    const casaPapel = (p: Papel) =>
      normalizar(`${p.label} ${p.description ?? ""} ${p.key}`).includes(t);
    const casaArea = (a: Area) =>
      normalizar(`${a.nome} ${a.descricao ?? ""} ${a.slug}`).includes(t);
    const ps = papeisOrdenados.filter(casaPapel);
    const as = areas.filter(casaArea);
    return {
      linhas: ps.length ? ps : papeisOrdenados,
      colunas: as.length ? as : areas,
    };
  }, [busca, papeisOrdenados, areas]);

  const semResultado = Boolean(busca) && linhas === papeisOrdenados && colunas === areas;

  const [editando, setEditando] = useState<Papel | null>(null);

  if (loading || !isAdmin) return null;

  return (
    <AppShell
      title="Quem vê o quê, em cada área?"
      subtitle={
        q.data
          ? `${plural(papeis.length, "papel", "papéis")} · ${plural(areas.length, "área", "áreas")} · ${plural(new Set(pessoas.map((p) => p.userId)).size, "pessoa", "pessoas")} · a mudança vale no próximo carregamento`
          : "A mudança vale no próximo carregamento."
      }
    >
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-semibold">Como funciona</p>
            <p className="text-muted-foreground">
              Quem tem a área tem <strong>todas</strong> as páginas e ações dela, e quem não tem não
              enxerga a área nem no menu. A tabela abaixo é o retrato: para mudar, abra{" "}
              <strong>Editar</strong> no papel, um papel por vez.
            </p>
            <p className="text-muted-foreground">
              Página nova não precisa de permissão nova: ela herda a área em que mora.
            </p>
          </div>
        </div>

        <Secao
          titulo="Matriz de papéis"
          descricao="Papel na linha, área na coluna. É leitura: nada aqui salva sozinho."
          acoes={
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar papel ou área"
                aria-label="Buscar papel ou área"
                className="h-9 w-[240px] pl-8"
              />
            </div>
          }
        >
          {q.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

          {q.isError && (
            <p className="text-sm text-danger">
              Não foi possível carregar a matriz. Recarregue a página.
            </p>
          )}

          {semResultado ? (
            <EstadoVazio
              titulo="Nenhum papel e nenhuma área com esse termo"
              descricao="Tente o nome do papel (CS, Diretor) ou o da área (Receita, Broker)."
              acao={
                <Button variant="outline" size="sm" onClick={() => setBusca("")}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            !q.isLoading &&
            !q.isError && (
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className={cn("sticky left-0 z-20 min-w-[220px]", FUNDO_CABECALHO_GRUDADO)}
                      >
                        Papel
                      </TableHead>
                      {colunas.map((a) => (
                        <TableHead
                          key={a.slug}
                          title={a.descricao ?? a.nome}
                          className="w-[88px] min-w-[88px] whitespace-normal px-2 py-2 text-center align-bottom leading-tight"
                        >
                          {a.nome}
                        </TableHead>
                      ))}
                      <TableHead className="w-[96px] text-right">
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((p) => {
                      const gente = pessoasPorPapel.get(p.key) ?? [];
                      const abertas = areas.filter((a) => concedida.get(`${p.key}__${a.slug}`));
                      return (
                        <TableRow key={p.key} className="group">
                          <TableCell
                            className={cn(
                              "sticky left-0 z-10 bg-card align-top",
                              FUNDO_LINHA_GRUDADA_HOVER,
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium text-foreground">{p.label}</span>
                              {!p.is_system && (
                                <StatusBadge tom="neutro" icone={false}>
                                  customizado
                                </StatusBadge>
                              )}
                              {gente.length === 0 && (
                                <StatusBadge tom="neutro">sem ninguém</StatusBadge>
                              )}
                              {abertas.length === 0 && (
                                <StatusBadge tom="atencao">não abre nada</StatusBadge>
                              )}
                            </div>
                            <p className="mt-0.5 text-[13px] text-muted-foreground">
                              {gente.length > 0 && (
                                <span title={gente.map((g) => g.nome).join(", ")}>
                                  {plural(gente.length, "pessoa", "pessoas")}
                                </span>
                              )}
                              {gente.length > 0 && " · "}
                              {plural(abertas.length, "área", "áreas")}
                            </p>
                          </TableCell>
                          {colunas.map((a) => {
                            const tem = concedida.get(`${p.key}__${a.slug}`) ?? false;
                            return (
                              <TableCell key={a.slug} className="px-2 text-center align-middle">
                                {/*
                                 * O rótulo vai num `sr-only` e não num
                                 * `aria-label` do ícone: leitor de tela não
                                 * anuncia label em <svg> sem papel declarado, e
                                 * a célula ficaria muda numa grade que só tem
                                 * símbolo.
                                 */}
                                {tem ? (
                                  <Check className="mx-auto size-4 text-success" aria-hidden />
                                ) : (
                                  <Minus
                                    className="mx-auto size-4 text-muted-foreground"
                                    aria-hidden
                                  />
                                )}
                                <span className="sr-only">
                                  {tem ? `${p.label} vê ${a.nome}` : `${p.label} não vê ${a.nome}`}
                                </span>
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right align-middle">
                            <Button variant="outline" size="sm" onClick={() => setEditando(p)}>
                              Editar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </Secao>

        <Secao
          titulo="Quem administra cada área"
          descricao="Nível delegado por pessoa, concedido em Usuários → Acessos. Não vem do papel."
        >
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {areas.map((a) => {
              const lista = adminsPorArea.get(a.slug) ?? [];
              return (
                <li key={a.slug} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="min-w-[200px] font-medium text-foreground">{a.nome}</span>
                  <span className="text-muted-foreground">
                    {lista.length === 0
                      ? "Só o super admin"
                      : lista
                          .map((x) => `${x.nome} (${x.nivel === "admin" ? "admin" : "sócio"})`)
                          .join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </Secao>

        <div className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
          <Users className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">Segundo nível: quem vê o quê dentro da área</p>
            <p className="mt-1 text-muted-foreground">
              Unidades da rede e empresas do grupo são filtro <strong>por pessoa</strong>, não por
              papel: dois analistas com o mesmo papel podem cuidar de unidades diferentes. Isso se
              edita em{" "}
              <a href="/admin/usuarios" className="font-medium text-primary-text hover:underline">
                Usuários
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      {editando && (
        <EditorDoPapel
          // `key` zera o rascunho ao trocar de papel sem o painel fechar.
          key={editando.key}
          papel={editando}
          papeis={papeisOrdenados}
          areas={areas}
          concedida={concedida}
          pessoas={pessoasPorPapel.get(editando.key) ?? []}
          chavesPorArea={chavesPorArea}
          onFechar={() => setEditando(null)}
        />
      )}
    </AppShell>
  );
}

/**
 * Edição de UM papel. O painel existe para caber o que a grade não cabia: de
 * quem é este papel, o que cada área carrega e o que a mudança faz, em
 * português, antes de gravar.
 */
function EditorDoPapel({
  papel,
  papeis,
  areas,
  concedida,
  pessoas,
  chavesPorArea,
  onFechar,
}: {
  papel: Papel;
  papeis: Papel[];
  areas: Area[];
  concedida: Map<string, boolean>;
  pessoas: Pessoa[];
  chavesPorArea: Map<string, { key: string; label: string }[]>;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarAreasDoPapel);

  const original = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of areas) m.set(a.slug, concedida.get(`${papel.key}__${a.slug}`) ?? false);
    return m;
  }, [areas, concedida, papel.key]);

  const [rascunho, setRascunho] = useState<Map<string, boolean>>(() => new Map(original));
  const [comparar, setComparar] = useState<string>("");
  const [confirmando, setConfirmando] = useState(false);

  const ganhos = areas.filter((a) => rascunho.get(a.slug) && !original.get(a.slug));
  const perdas = areas.filter((a) => !rascunho.get(a.slug) && original.get(a.slug));
  const mudou = ganhos.length + perdas.length > 0;

  const outro = papeis.find((p) => p.key === comparar) ?? null;
  const temNoOutro = (slug: string) => Boolean(outro && concedida.get(`${outro.key}__${slug}`));

  const salvar = useMutation({
    mutationFn: () =>
      salvarFn({
        data: {
          role: papel.key,
          mudancas: [...ganhos, ...perdas].map((a) => ({
            area: a.slug,
            allowed: Boolean(rascunho.get(a.slug)),
          })),
        },
      }),
    onSuccess: () => {
      toast.success(
        pessoas.length
          ? `${papel.label} atualizado. ${plural(pessoas.length, "pessoa vê", "pessoas veem")} a mudança no próximo carregamento.`
          : `${papel.label} atualizado.`,
      );
      qc.invalidateQueries({ queryKey: ["role-areas"] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
      onFechar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar."),
  });

  const tentarSalvar = () => {
    if (perdas.length) setConfirmando(true);
    else salvar.mutate();
  };

  const porEscopo = ORDEM_ESCOPO.map((escopo) => ({
    escopo,
    lista: areas.filter((a) => a.escopo === escopo),
  })).filter((g) => g.lista.length > 0);

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b px-6 py-4 text-left">
          <SheetTitle>{papel.label}</SheetTitle>
          <SheetDescription>{papel.description || "Sem descrição cadastrada."}</SheetDescription>
          <p className="pt-1 text-[13px] text-muted-foreground">
            {pessoas.length === 0 ? (
              "Ninguém tem este papel hoje, então mudar aqui não afeta nenhuma pessoa agora."
            ) : (
              <>
                <strong className="text-foreground">
                  {plural(pessoas.length, "pessoa", "pessoas")}
                </strong>{" "}
                com este papel: {pessoas.map((p) => p.nome).join(", ")}.
              </>
            )}
          </p>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b px-6 py-3">
          <span className="shrink-0 text-[13px] text-muted-foreground">Comparar com</span>
          <Select
            value={comparar}
            // O Select do Radix não aceita item de valor vazio, então o "não
            // comparar" entra com sentinela e volta para "" aqui.
            onValueChange={(v) => setComparar(v === SEM_COMPARACAO ? "" : v)}
          >
            <SelectTrigger className="h-8 flex-1">
              <SelectValue placeholder="nenhum papel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_COMPARACAO}>nenhum papel</SelectItem>
              {papeis
                .filter((p) => p.key !== papel.key)
                .map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {outro && (
            <Button
              variant="outline"
              size="sm"
              title={`Marcar exatamente as áreas de ${outro.label} neste papel`}
              onClick={() =>
                setRascunho(
                  new Map(areas.map((a) => [a.slug, temNoOutro(a.slug)] as [string, boolean])),
                )
              }
            >
              Copiar
            </Button>
          )}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {porEscopo.map((g) => (
            <div key={g.escopo} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {ROTULO_ESCOPO[g.escopo]}
              </p>
              <ul className="divide-y rounded-lg border">
                {g.lista.map((a) => {
                  const marcada = Boolean(rascunho.get(a.slug));
                  const chaves = chavesPorArea.get(a.slug) ?? [];
                  const mudouAqui = marcada !== Boolean(original.get(a.slug));
                  return (
                    <li key={a.slug} className="flex items-start gap-3 px-3 py-3">
                      <Switch
                        id={`area-${a.slug}`}
                        checked={marcada}
                        onCheckedChange={(v) =>
                          setRascunho((m) => new Map(m).set(a.slug, Boolean(v)))
                        }
                        className="mt-0.5"
                      />
                      <label htmlFor={`area-${a.slug}`} className="flex-1 cursor-pointer">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-foreground">{a.nome}</span>
                          {mudouAqui && (
                            <StatusBadge tom={marcada ? "sucesso" : "perigo"}>
                              {marcada ? "passa a ver" : "deixa de ver"}
                            </StatusBadge>
                          )}
                          {outro && temNoOutro(a.slug) && (
                            <StatusBadge tom="info" icone={false}>
                              {outro.label} vê
                            </StatusBadge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          {a.descricao}
                        </span>
                        <span
                          className="mt-0.5 block text-xs text-muted-foreground"
                          title={chaves.map((c) => c.label).join(", ")}
                        >
                          {plural(chaves.length, "permissão", "permissões")} dentro
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <SheetFooter className="flex-col items-stretch gap-3 border-t px-6 py-4 sm:flex-col sm:space-x-0">
          <div className="text-[13px]">
            {!mudou ? (
              <span className="text-muted-foreground">Nada mudou.</span>
            ) : (
              <div className="space-y-1">
                {ganhos.length > 0 && (
                  <p>
                    <span className="font-medium text-success">Passa a ver:</span>{" "}
                    <span className="text-foreground">{ganhos.map((a) => a.nome).join(", ")}</span>
                  </p>
                )}
                {perdas.length > 0 && (
                  <p>
                    <span className="font-medium text-danger">Deixa de ver:</span>{" "}
                    <span className="text-foreground">{perdas.map((a) => a.nome).join(", ")}</span>
                  </p>
                )}
                <p className="text-muted-foreground">
                  {pessoas.length === 0
                    ? "Não afeta ninguém hoje."
                    : `Afeta ${plural(pessoas.length, "pessoa", "pessoas")}.`}
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onFechar} disabled={salvar.isPending}>
              Cancelar
            </Button>
            <Button onClick={tentarSalvar} disabled={!mudou || salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </SheetFooter>

        {/*
         * Dentro do SheetContent de propósito. O Sheet é modal e tira o
         * ponteiro de tudo que não é camada registrada; um AlertDialog irmão
         * dele abre e não recebe clique. Aninhado, o Radix empilha as duas
         * camadas e a de cima fica clicável.
         */}
        <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Isto tira acesso de quem já tem</AlertDialogTitle>
              <AlertDialogDescription>
                {pessoas.length === 0
                  ? `Ninguém tem o papel ${papel.label} hoje, mas quem receber daqui em diante vem sem `
                  : `${plural(pessoas.length, "pessoa", "pessoas")} com o papel ${papel.label} ${pessoas.length === 1 ? "deixa" : "deixam"} de ver `}
                {perdas.map((a) => a.nome).join(", ")}
                {pessoas.length > 0 && ` (${pessoas.map((p) => p.nome).join(", ")})`}. A área some
                do menu no próximo carregamento.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={() => salvar.mutate()}
              >
                Tirar mesmo assim
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
