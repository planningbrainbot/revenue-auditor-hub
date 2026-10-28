import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, FileText, Pencil, Plus, Video } from "lucide-react";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { db } from "@/lib/uso";
import {
  linkPesquisa,
  ordenarComites,
  porComite,
  resumir,
  slugCodigo,
  TIPOS,
  type Comite,
  type Resposta,
  type Resumo,
  type TipoComite,
} from "@/lib/comites";

// Comitês da rede (contrato docs/design/contratos/comites.md; PRD 2026-10-ops-comites-da-rede).
// Por comitê: a apresentação, a gravação e as notas da pesquisa de satisfação.
// As contas ficam em src/lib/comites.ts; quem pode ver fica nas policies de ops.comites.

type Busca = { comite?: string };
const UUID_RE = /^[0-9a-f-]{36}$/i;
const BUCKET = "comites";

export const Route = createFileRoute("/_authenticated/comites")({
  ssr: false,
  head: () => ({ meta: [{ title: "Comitês da rede · Planning Brain" }] }),
  validateSearch: (s: Record<string, unknown>): Busca =>
    typeof s.comite === "string" && UUID_RE.test(s.comite) ? { comite: s.comite } : {},
  component: Comites,
});

const TITULO = "Comitês da rede";
const PERGUNTA = "Como foi cada comitê, segundo quem participou?";
const DESCRICAO =
  "Apresentação, gravação e notas da pesquisa de satisfação de cada comitê. A pesquisa é anônima: não pede nome nem unidade.";
const NUM1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function dataBR(iso: string | null) {
  if (!iso) return "data a definir";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nota(v: number | null) {
  return v == null ? "-" : NUM1.format(v);
}

function tomNps(nps: number | null) {
  if (nps == null) return undefined;
  if (nps >= 75) return "sucesso" as const;
  if (nps >= 50) return "atencao" as const;
  return "perigo" as const;
}

type Dados = { comites: Comite[]; respostas: Resposta[] };

async function carregar(): Promise<Dados> {
  const [c, r] = await Promise.all([
    db.from("comites").select("*"),
    db
      .from("pesquisa_satisfacao_comite_socios")
      .select(
        "id, created_at, comite_codigo, nps_recomendaria, clareza_resultados, utilidade_novidades, clareza_proximos_passos, frente_prioritaria, comentario",
      )
      .order("created_at", { ascending: false }),
  ]);
  if (c.error) throw new Error(`ops.comites: ${c.error.message}`);
  if (r.error) throw new Error(`ops.pesquisa_satisfacao_comite_socios: ${r.error.message}`);
  return { comites: ordenarComites(c.data as Comite[]), respostas: r.data as Resposta[] };
}

function Moldura({ children, acoes }: { children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="admin"
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao={DESCRICAO}
        procedencia={{
          fonte: "ops.comites · ops.pesquisa_satisfacao_comite_socios",
          regua: "NPS = % 9 e 10 menos % 0 a 6",
        }}
        acoes={acoes}
      />
      {children}
    </main>
  );
}

function Comites() {
  const perms = usePermissions();
  const busca = Route.useSearch();
  const nav = Route.useNavigate();
  const pode = !perms.loading && perms.can("view.admin.comites");
  const [editando, setEditando] = useState<Comite | "novo" | null>(null);

  const q = useQuery({ queryKey: ["comites"], queryFn: carregar, enabled: pode, retry: false });

  const acoes = pode ? (
    <Button size="sm" onClick={() => setEditando("novo")}>
      <Plus className="mr-1 h-4 w-4" aria-hidden /> Novo comitê
    </Button>
  ) : undefined;

  if (perms.loading)
    return (
      <Moldura>
        <Carregando variante="pagina" />
      </Moldura>
    );
  if (!pode)
    return (
      <Moldura>
        <EstadoSemAcesso oQueFalta="view.admin.comites (área Administração)" />
      </Moldura>
    );
  if (q.isLoading)
    return (
      <Moldura acoes={acoes}>
        <Carregando variante="pagina" />
      </Moldura>
    );
  if (q.isError)
    return (
      <Moldura acoes={acoes}>
        <EstadoErro
          titulo="Os comitês não carregaram"
          detalhe={(q.error as Error).message}
          tentarNovamente={() => q.refetch()}
        />
      </Moldura>
    );

  const { comites, respostas } = q.data!;
  const grupos = porComite(respostas);
  const resumos = new Map(comites.map((c) => [c.codigo, resumir(grupos.get(c.codigo) ?? [])]));
  const aberto = busca.comite ? comites.find((c) => c.id === busca.comite) : undefined;

  const dialogo = editando ? (
    <EditarComite comite={editando === "novo" ? null : editando} fechar={() => setEditando(null)} />
  ) : null;

  if (aberto)
    return (
      <Moldura acoes={acoes}>
        <FichaComite
          comite={aberto}
          resumo={resumos.get(aberto.codigo)!}
          voltar={() => nav({ search: {} })}
          editar={() => setEditando(aberto)}
        />
        {dialogo}
      </Moldura>
    );

  return (
    <Moldura acoes={acoes}>
      {comites.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum comitê cadastrado"
          descricao="Use Novo comitê para cadastrar o primeiro."
        />
      ) : (
        <Secao
          titulo="Comitês"
          descricao="Do mais recente para o mais antigo. Clique para abrir a apresentação e as notas."
        >
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comitê</TableHead>
                  <TableHead className="hidden md:table-cell">Tipo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Respostas</TableHead>
                  <TableHead className="text-right">NPS</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Clareza</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Utilidade</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Próximos passos</TableHead>
                  <TableHead className="hidden lg:table-cell">Pesquisa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comites.map((c) => {
                  const r = resumos.get(c.codigo)!;
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => nav({ search: { comite: c.id } })}
                    >
                      <TableCell className="font-medium">{c.titulo}</TableCell>
                      <TableCell className="hidden md:table-cell">{TIPOS[c.tipo]}</TableCell>
                      <TableCell className="tabular-nums">{dataBR(c.data)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.respostas}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {r.nps ?? "-"}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {nota(r.clareza)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {nota(r.utilidade)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {nota(r.proximos)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <StatusBadge tom={c.pesquisa_aberta ? "sucesso" : "neutro"}>
                          {c.pesquisa_aberta ? "Aberta" : "Fechada"}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Notas de 1 a 5 (média). NPS de -100 a 100: quanto recomendariam o comitê a outro sócio.
          </p>
        </Secao>
      )}
      {dialogo}
    </Moldura>
  );
}

function FichaComite({
  comite,
  resumo: r,
  voltar,
  editar,
}: {
  comite: Comite;
  resumo: Resumo;
  voltar: () => void;
  editar: () => void;
}) {
  const arquivo = useQuery({
    queryKey: ["comites-arquivo", comite.apresentacao_arquivo],
    queryFn: async () => {
      const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrl(comite.apresentacao_arquivo, 60 * 60, {
          download: comite.apresentacao_nome ?? true,
        });
      if (error) throw new Error(error.message);
      return data.signedUrl as string;
    },
    enabled: !!comite.apresentacao_arquivo,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={voltar}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Todos os comitês
        </Button>
        <Button variant="outline" size="sm" onClick={editar}>
          <Pencil className="mr-1 h-4 w-4" aria-hidden /> Editar
        </Button>
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{comite.titulo}</h2>
        <p className="text-sm text-muted-foreground">
          {TIPOS[comite.tipo]} · {dataBR(comite.data)} · código {comite.codigo}
        </p>
      </div>

      <Secao titulo="Material" descricao="A apresentação e a gravação da reunião.">
        <div className="flex flex-wrap gap-3">
          {comite.apresentacao_url && (
            <Button asChild variant="outline">
              <a href={comite.apresentacao_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Abrir a apresentação
              </a>
            </Button>
          )}
          {comite.apresentacao_arquivo && (
            <Button asChild variant="outline" disabled={!arquivo.data}>
              <a href={arquivo.data ?? "#"} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-2 h-4 w-4" aria-hidden />
                Baixar {comite.apresentacao_nome ?? "o arquivo"}
              </a>
            </Button>
          )}
          {comite.gravacao_url ? (
            <Button asChild variant="outline">
              <a href={comite.gravacao_url} target="_blank" rel="noopener noreferrer">
                <Video className="mr-2 h-4 w-4" aria-hidden /> Assistir à gravação
              </a>
            </Button>
          ) : (
            <span className="self-center text-sm text-muted-foreground">
              Gravação ainda não cadastrada.
            </span>
          )}
          {!comite.apresentacao_url && !comite.apresentacao_arquivo && (
            <span className="self-center text-sm text-muted-foreground">
              Apresentação ainda não cadastrada.
            </span>
          )}
        </div>
      </Secao>

      <Secao
        titulo="Notas da pesquisa"
        descricao={
          comite.pesquisa_aberta
            ? `Pesquisa aberta: ${linkPesquisa(comite.codigo)}`
            : "Pesquisa fechada: não recebe mais respostas."
        }
      >
        {r.respostas === 0 ? (
          <EstadoVazio
            titulo="Ainda não há respostas"
            descricao={
              comite.pesquisa_aberta
                ? "As respostas aparecem aqui assim que os sócios responderem pelo QR do comitê."
                : "Este comitê não recebeu respostas."
            }
          />
        ) : (
          <div className="space-y-6">
            <KpiGrade colunas={4}>
              <KpiCard
                rotulo="NPS do comitê"
                valor={String(r.nps)}
                nota={`${r.promotores} promotores, ${r.neutros} neutros, ${r.detratores} detratores · ${r.respostas} respostas`}
                tom={tomNps(r.nps)}
              />
              <KpiCard rotulo="Resultados ficaram claros" valor={nota(r.clareza)} unidade="de 5" />
              <KpiCard rotulo="Útil para o dia a dia" valor={nota(r.utilidade)} unidade="de 5" />
              <KpiCard rotulo="Saiu sabendo o que fazer" valor={nota(r.proximos)} unidade="de 5" />
            </KpiGrade>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Frente que a matriz deveria priorizar</h3>
                <ul className="space-y-1 text-sm">
                  {r.frentes.map((f) => (
                    <li key={f.codigo} className="flex justify-between gap-4 border-b py-1">
                      <span>{f.rotulo}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {f.votos} {f.votos === 1 ? "voto" : "votos"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Comentários ({r.comentarios.length})</h3>
                {r.comentarios.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ninguém deixou comentário.</p>
                ) : (
                  <ul className="space-y-3">
                    {r.comentarios.map((c, i) => (
                      <li key={i} className="rounded-md border p-3 text-sm">
                        <p className="whitespace-pre-wrap">{c.texto}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{quando(c.quando)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Secao>
    </div>
  );
}

function EditarComite({ comite, fechar }: { comite: Comite | null; fechar: () => void }) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState(comite?.titulo ?? "");
  const [codigo, setCodigo] = useState(comite?.codigo ?? "");
  const [tipo, setTipo] = useState<TipoComite>(comite?.tipo ?? "growth");
  const [data, setData] = useState(comite?.data ?? "");
  const [apresentacaoUrl, setApresentacaoUrl] = useState(comite?.apresentacao_url ?? "");
  const [gravacaoUrl, setGravacaoUrl] = useState(comite?.gravacao_url ?? "");
  const [aberta, setAberta] = useState(comite?.pesquisa_aberta ?? true);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const codigoFinal = codigo || slugCodigo(titulo);

  const salvar = useMutation({
    mutationFn: async () => {
      const https = (v: string) => {
        const t = v.trim();
        if (t && !/^https:\/\//i.test(t)) throw new Error("Os links precisam começar com https://");
        return t || null;
      };
      const campos: Record<string, unknown> = {
        titulo: titulo.trim(),
        tipo,
        data: data || null,
        apresentacao_url: https(apresentacaoUrl),
        gravacao_url: https(gravacaoUrl),
        pesquisa_aberta: aberta,
      };
      if (!comite) campos.codigo = codigoFinal;
      if (arquivo) {
        if (arquivo.size > 50 * 1024 * 1024) throw new Error("O arquivo passa de 50 MB.");
        const caminho = `${codigoFinal}/${Date.now()}-${slugCodigo(arquivo.name.replace(/\.[^.]+$/, ""))}${arquivo.name.match(/\.[^.]+$/)?.[0] ?? ""}`;
        const up = await db.storage.from(BUCKET).upload(caminho, arquivo, { upsert: false });
        if (up.error) throw new Error(`Arquivo: ${up.error.message}`);
        campos.apresentacao_arquivo = caminho;
        campos.apresentacao_nome = arquivo.name;
      }
      const res = comite
        ? await db.from("comites").update(campos).eq("id", comite.id)
        : await db.from("comites").insert(campos);
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comites"] });
      fechar();
    },
  });

  const valido = titulo.trim().length >= 3 && /^[a-z0-9][a-z0-9-]{2,39}$/.test(codigoFinal);

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{comite ? "Editar comitê" : "Novo comitê"}</DialogTitle>
          <DialogDescription>
            O código vai no endereço da pesquisa e não muda depois de criado.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valido) salvar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="c-titulo">Título</Label>
            <Input
              id="c-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Comitê de Novembro 2026"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-tipo">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoComite)}>
                <SelectTrigger id="c-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIPOS) as TipoComite[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPOS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-data">Data</Label>
              <Input
                id="c-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-codigo">Código</Label>
            <Input
              id="c-codigo"
              value={codigoFinal}
              disabled={!!comite}
              onChange={(e) => setCodigo(slugCodigo(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-apres">Link da apresentação</Label>
            <Input
              id="c-apres"
              value={apresentacaoUrl}
              onChange={(e) => setApresentacaoUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-arq">Arquivo da apresentação (pptx ou pdf, até 50 MB)</Label>
            <Input
              id="c-arq"
              type="file"
              accept=".pptx,.ppt,.pdf,.key"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            {comite?.apresentacao_nome && !arquivo && (
              <p className="text-xs text-muted-foreground">Atual: {comite.apresentacao_nome}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-grav">Link da gravação (Drive ou Meet)</Label>
            <Input
              id="c-grav"
              value={gravacaoUrl}
              onChange={(e) => setGravacaoUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="c-aberta" className="font-normal">
              Pesquisa aberta (recebe respostas pelo QR)
            </Label>
            <Switch id="c-aberta" checked={aberta} onCheckedChange={setAberta} />
          </div>
          {salvar.isError && (
            <p className="text-sm text-danger" role="alert">
              {(salvar.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={fechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valido || salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
