import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, FileSpreadsheet, FileText, Printer, Radar, Send } from "lucide-react";
import { listGente, type GentePessoaRow } from "@/lib/gente.functions";
import {
  enviarAve,
  listAveRadar,
  verAve,
  type Alcance,
  type AveAvaliacaoRow,
  type ModeloAve,
} from "@/lib/gente-ave.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EstadoVazio, StatusBadge, type TomStatus } from "@/components/planning";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dataDoMarco, diasDeCasa } from "./tempo-de-casa";
import { exportarRadarExcel, exportarRadarPdf, type LinhaExportavel } from "./radar-exportar";

// Radar de avaliação de experiência (AVE), pedido do RH de Maceió em
// 01/10/2026. Mostra quem está nos primeiros 90 dias pela data de admissão e,
// desde a segunda rodada do mesmo dia, deixa o RH ENVIAR a avaliação dali:
// 90° (só o líder), 180° (líder e autoavaliação) ou 360° (mais colegas). A
// avaliação cai em Minha vez de quem responde, e o radar mostra o andamento
// para o RH cobrar. Quem já passou do prazo continua aqui enquanto houver AVE
// em aberto.
//
// A lista vem do cadastro (`listGente`), recortado pela unidade na RLS. Quem só
// enxerga a própria linha (colaborador) não vê o radar.

const NA = "—";
const fmtData = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");

const MODELO_DO_MARCO: Record<45 | 90, ModeloAve> = { 45: "ave45", 90: "ave90" };

const TIPO_ROTULO: Record<string, string> = {
  gestor: "Líder",
  auto: "Autoavaliação",
  par: "Par",
  liderado: "Liderado",
};

const ALCANCES: { v: Alcance; t: string; d: string }[] = [
  { v: 90, t: "90°", d: "Só o líder avalia." },
  { v: 180, t: "180°", d: "O líder avalia e a pessoa faz a autoavaliação." },
  {
    v: 360,
    t: "360°",
    d: "Líder, autoavaliação e colegas que você escolher. Os colegas respondem as perguntas do líder, sem a decisão de efetivação.",
  },
];

interface LinhaRadar {
  pessoa: GentePessoaRow;
  marco: 45 | 90;
  prazo: string;
  falta: number;
  envios: AveAvaliacaoRow[];
}

function situacaoPrazo(falta: number): { tom: TomStatus; texto: string } {
  if (falta < 0)
    return { tom: "perigo", texto: `venceu há ${-falta} dia${falta === -1 ? "" : "s"}` };
  if (falta === 0) return { tom: "perigo", texto: "completa hoje" };
  if (falta <= 7) return { tom: "atencao", texto: `faltam ${falta} dia${falta === 1 ? "" : "s"}` };
  return { tom: "neutro", texto: `faltam ${falta} dias` };
}

function EnviarAveDialog({
  linha,
  pessoas,
  jaEnviada,
}: {
  linha: LinhaRadar;
  pessoas: GentePessoaRow[];
  jaEnviada: boolean;
}) {
  const fn = useServerFn(enviarAve);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [alcance, setAlcance] = useState<Alcance>(90);
  const [pares, setPares] = useState<number[]>([]);
  const p = linha.pessoa;
  const lider = pessoas.find((x) => x.id === p.gestorId) ?? null;
  const candidatos = pessoas.filter(
    (x) =>
      x.status === "ativo" &&
      x.id !== p.id &&
      x.id !== p.gestorId &&
      (p.unidadeId == null || x.unidadeId === p.unidadeId),
  );
  const modelo = MODELO_DO_MARCO[linha.marco];

  const semLogin = [
    ...(lider && !lider.temLogin ? [lider.nomeCompleto] : []),
    ...(alcance >= 180 && !p.temLogin ? [p.nomeCompleto] : []),
    ...(alcance === 360
      ? candidatos.filter((c) => pares.includes(c.id) && !c.temLogin).map((c) => c.nomeCompleto)
      : []),
  ];

  const enviar = useMutation({
    mutationFn: async () =>
      fn({ data: { pessoaId: p.id, modelo, alcance, pares: alcance === 360 ? pares : [] } }),
    onSuccess: (r) => {
      if (!r.criadas) toast.info("Nada novo: essas avaliações já tinham sido enviadas.");
      else {
        const aviso = r.semLogin.length
          ? ` ${r.semLogin.join(", ")} ainda sem login: a avaliação espera até ganhar acesso.`
          : "";
        toast.success(
          `${r.criadas} avaliação(ões) enviada(s)${r.emailsEnviados ? `, ${r.emailsEnviados} aviso(s) por e-mail` : ""}.${aviso}`,
          { duration: r.semLogin.length ? 15_000 : 5_000 },
        );
      }
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["gente-ave-radar"] });
      qc.invalidateQueries({ queryKey: ["gente-avaliacao"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (o) {
          setAlcance(90);
          setPares([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={jaEnviada ? "ghost" : "default"} className="h-7 px-2 text-xs">
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {jaEnviada ? "Incluir avaliadores" : "Enviar avaliação"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar avaliação de {linha.marco} dias</DialogTitle>
          <DialogDescription>
            {p.nomeCompleto}, admissão em {fmtData(p.dataAdmissao!)}. A avaliação cai em Minha vez
            de quem responde, e você acompanha por aqui.
          </DialogDescription>
        </DialogHeader>

        {!lider ? (
          <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
            {p.nomeCompleto} está sem gestor no cadastro, e a avaliação vai para o líder. Defina o
            gestor em Cadastro, no botão Editar da linha dela, e volte aqui.
          </p>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm">
              Líder que avalia: <span className="font-medium">{lider.nomeCompleto}</span>
            </p>

            <div className="grid gap-2" role="radiogroup" aria-label="Alcance da avaliação">
              <Label>Alcance</Label>
              {ALCANCES.map((a) => (
                <button
                  key={a.v}
                  type="button"
                  role="radio"
                  aria-checked={alcance === a.v}
                  onClick={() => setAlcance(a.v)}
                  className={
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                    (alcance === a.v
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent")
                  }
                >
                  <span className="font-medium">{a.t}</span>
                  <span className="block text-[13px] text-muted-foreground">{a.d}</span>
                </button>
              ))}
            </div>

            {alcance === 360 ? (
              <div className="grid gap-1.5">
                <Label>Colegas que avaliam</Label>
                <div className="max-h-48 overflow-auto rounded-md border p-2">
                  {candidatos.length ? (
                    candidatos.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={pares.includes(c.id)}
                          onChange={(e) =>
                            setPares((s) =>
                              e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id),
                            )
                          }
                        />
                        <span>{c.nomeCompleto}</span>
                        {c.cargo ? (
                          <span className="text-[13px] text-muted-foreground">{c.cargo}</span>
                        ) : null}
                        {!c.temLogin ? (
                          <span className="text-[12px] text-muted-foreground">(sem login)</span>
                        ) : null}
                      </label>
                    ))
                  ) : (
                    <p className="text-[13px] text-muted-foreground">
                      Ninguém mais ativo na unidade.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {semLogin.length ? (
              <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-[13px] text-warning">
                Sem login no Brain: {semLogin.join(", ")}. A avaliação fica esperando e só aparece
                quando a pessoa ganhar acesso (Cadastro, botão Dar acesso).
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => enviar.mutate()}
            disabled={!lider || enviar.isPending || (alcance === 360 && !pares.length)}
          >
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerRespostasDialog({ pessoa, modelo }: { pessoa: GentePessoaRow; modelo: ModeloAve }) {
  const fn = useServerFn(verAve);
  const [aberto, setAberto] = useState(false);
  const q = useQuery({
    queryKey: ["gente-ave-respostas", pessoa.id, modelo],
    queryFn: () => fn({ data: { pessoaId: pessoa.id, modelo } }),
    enabled: aberto,
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          Ver respostas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {pessoa.nomeCompleto}: avaliação de {modelo === "ave45" ? 45 : 90} dias
          </DialogTitle>
          <DialogDescription>
            O que cada avaliador respondeu. A pessoa avaliada não vê isto antes da devolutiva.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-5">
            {(q.data ?? []).map((a, i) => (
              <div key={i} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{TIPO_ROTULO[a.tipo] ?? a.tipo}</span>
                  <span className="text-[13px] text-muted-foreground">{a.avaliadorNome ?? NA}</span>
                  <StatusBadge tom={a.status === "concluida" ? "sucesso" : "atencao"}>
                    {a.status === "concluida"
                      ? `respondida${a.concluidaEm ? ` em ${fmtData(a.concluidaEm)}` : ""}`
                      : "pendente"}
                  </StatusBadge>
                </div>
                {a.status === "concluida" ? (
                  <Table>
                    <TableBody>
                      {a.itens.map((it, j) => (
                        <TableRow key={j}>
                          <TableCell className="w-1/3 align-top text-[13px]">{it.titulo}</TableCell>
                          <TableCell className="align-top text-[13px]">
                            <div className="font-medium">{it.resposta ?? NA}</div>
                            {it.comentario ? (
                              <div className="text-muted-foreground">{it.comentario}</div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const GRUPO_DO_MARCO: Record<45 | 90, string> = {
  45: "Avaliação de 45 dias",
  90: "Avaliação de 90 dias",
};

/** O mesmo que a linha mostra, em texto, para PDF e Excel. */
function paraExportar(l: LinhaRadar): LinhaExportavel {
  const respondido = l.envios.length > 0 && l.envios.every((e) => e.status === "concluida");
  return {
    grupo: GRUPO_DO_MARCO[l.marco],
    pessoa: l.pessoa.nomeCompleto,
    cargo: l.pessoa.cargo ?? "",
    unidade: l.pessoa.unidade ?? "",
    gestor: l.pessoa.gestorNome ?? "sem gestor",
    admissao: fmtData(l.pessoa.dataAdmissao!),
    completaEm: fmtData(l.prazo),
    prazo: respondido ? "concluída" : situacaoPrazo(l.falta).texto,
    avaliacao: l.envios.length
      ? l.envios
          .map(
            (e) =>
              `${TIPO_ROTULO[e.tipo] ?? e.tipo}${e.tipo === "par" && e.avaliadorNome ? ` (${e.avaliadorNome})` : ""}: ${e.status === "concluida" ? "respondida" : "pendente"}`,
          )
          .join("; ")
      : "não enviada",
  };
}

function Imprimir({ fase45, fase90 }: { fase45: LinhaRadar[]; fase90: LinhaRadar[] }) {
  const [gerando, setGerando] = useState(false);
  const linhas = [...fase45, ...fase90].map(paraExportar);
  const rodar = async (formato: "pdf" | "excel") => {
    setGerando(true);
    try {
      if (formato === "pdf")
        await exportarRadarPdf(linhas, [GRUPO_DO_MARCO[45], GRUPO_DO_MARCO[90]]);
      else await exportarRadarExcel(linhas);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o arquivo.");
    } finally {
      setGerando(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={gerando}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          {gerando ? "Gerando…" : "Imprimir"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void rodar("pdf")}>
          <FileText className="mr-2 h-4 w-4" />
          PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void rodar("excel")}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Andamento({ envios }: { envios: AveAvaliacaoRow[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {envios
        .slice()
        .sort((a, b) => (a.tipo === "gestor" ? -1 : b.tipo === "gestor" ? 1 : 0))
        .map((e) => (
          <StatusBadge key={e.id} tom={e.status === "concluida" ? "sucesso" : "atencao"}>
            {TIPO_ROTULO[e.tipo] ?? e.tipo}
            {e.tipo === "par" && e.avaliadorNome ? ` (${e.avaliadorNome.split(" ")[0]})` : ""}:{" "}
            {e.status === "concluida" ? "respondida" : "pendente"}
          </StatusBadge>
        ))}
    </div>
  );
}

function Grupo({
  titulo,
  linhas,
  pessoas,
  podeEnviar,
}: {
  titulo: string;
  linhas: LinhaRadar[];
  pessoas: GentePessoaRow[];
  podeEnviar: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">
        {titulo} <span className="num text-muted-foreground">({linhas.length})</span>
      </h4>
      {linhas.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Gestor</TableHead>
              <TableHead>Admissão</TableHead>
              <TableHead>Completa {linhas[0].marco} dias em</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead>Avaliação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => {
              const s = situacaoPrazo(l.falta);
              const tudoRespondido =
                l.envios.length > 0 && l.envios.every((e) => e.status === "concluida");
              return (
                <TableRow key={`${l.marco}-${l.pessoa.id}`}>
                  <TableCell>
                    <div className="font-medium">{l.pessoa.nomeCompleto}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {[l.pessoa.cargo, l.pessoa.unidade].filter(Boolean).join(" · ") || NA}
                    </div>
                  </TableCell>
                  <TableCell>
                    {l.pessoa.gestorNome ?? (
                      <span className="text-muted-foreground">sem gestor</span>
                    )}
                  </TableCell>
                  <TableCell className="num">{fmtData(l.pessoa.dataAdmissao!)}</TableCell>
                  <TableCell className="num">{fmtData(l.prazo)}</TableCell>
                  <TableCell>
                    {tudoRespondido ? (
                      <StatusBadge tom="sucesso">concluída</StatusBadge>
                    ) : (
                      <StatusBadge tom={s.tom}>{s.texto}</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {l.envios.length ? <Andamento envios={l.envios} /> : null}
                      {l.envios.some((e) => e.status === "concluida") ? (
                        <VerRespostasDialog pessoa={l.pessoa} modelo={MODELO_DO_MARCO[l.marco]} />
                      ) : null}
                      {podeEnviar ? (
                        <EnviarAveDialog
                          linha={l}
                          pessoas={pessoas}
                          jaEnviada={l.envios.length > 0}
                        />
                      ) : !l.envios.length ? (
                        <span className="text-[13px] text-muted-foreground">não enviada</span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-[13px] text-muted-foreground">Ninguém nesta fase agora.</p>
      )}
    </div>
  );
}

export function RadarExperiencia() {
  const fn = useServerFn(listGente);
  const aveFn = useServerFn(listAveRadar);
  // Mesma chave do Cadastro: a lista já carregada lá é reaproveitada aqui.
  const q = useQuery({ queryKey: ["gente"], queryFn: () => fn(), staleTime: 60_000 });
  const qAve = useQuery({ queryKey: ["gente-ave-radar"], queryFn: () => aveFn() });

  const pessoas = useMemo(() => q.data?.pessoas ?? [], [q.data]);

  const { fase45, fase90, semAdmissao } = useMemo(() => {
    const envios = qAve.data?.envios ?? {};
    const ativos = pessoas.filter((p) => p.status === "ativo");
    const fase45: LinhaRadar[] = [];
    const fase90: LinhaRadar[] = [];
    for (const p of ativos) {
      const dias = diasDeCasa(p.dataAdmissao);
      if (dias == null) continue;
      for (const marco of [45, 90] as const) {
        const doModelo = envios[p.id]?.[MODELO_DO_MARCO[marco]] ?? [];
        const naJanela = marco === 45 ? dias <= 45 : dias > 45 && dias <= 90;
        // Passou do prazo e ainda tem resposta faltando: fica para o RH cobrar.
        const emAberto = doModelo.some((e) => e.status !== "concluida");
        if (!naJanela && !emAberto) continue;
        const linha: LinhaRadar = {
          pessoa: p,
          marco,
          prazo: dataDoMarco(p.dataAdmissao!, marco),
          falta: marco - dias,
          envios: doModelo,
        };
        (marco === 45 ? fase45 : fase90).push(linha);
      }
    }
    const porPrazo = (a: LinhaRadar, b: LinhaRadar) => a.prazo.localeCompare(b.prazo);
    return {
      fase45: fase45.sort(porPrazo),
      fase90: fase90.sort(porPrazo),
      semAdmissao: ativos.filter((p) => !p.dataAdmissao).length,
    };
  }, [pessoas, qAve.data]);

  // Sem acesso individual ao cadastro o radar não tem o que mostrar.
  if (!q.data?.podeIndividual) return null;
  const podeEnviar = qAve.data?.podeEnviar ?? false;

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <Radar className="h-4 w-4 text-primary-text" />
        <h3 className="font-semibold">Radar de avaliação de experiência</h3>
        {fase45.length || fase90.length ? (
          <div className="ml-auto">
            <Imprimir fase45={fase45} fase90={fase90} />
          </div>
        ) : null}
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Quem está nos primeiros 90 dias, pela data de admissão do cadastro. Envie a avaliação na
        linha da pessoa e acompanhe aqui quem já respondeu. Quem passou do prazo continua na lista
        enquanto faltar resposta.
      </p>

      {fase45.length || fase90.length ? (
        <div className="space-y-6">
          <Grupo
            titulo="Avaliação de 45 dias"
            linhas={fase45}
            pessoas={pessoas}
            podeEnviar={podeEnviar}
          />
          <Grupo
            titulo="Avaliação de 90 dias"
            linhas={fase90}
            pessoas={pessoas}
            podeEnviar={podeEnviar}
          />
        </div>
      ) : (
        <EstadoVazio
          titulo="Ninguém em período de experiência"
          descricao="Nenhuma pessoa ativa com até 90 dias de casa no cadastro que você enxerga."
        />
      )}

      {semAdmissao ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          <span className="num">{semAdmissao}</span> pessoa(s) ativa(s) sem data de admissão ficam
          fora do radar.{" "}
          <a className="text-primary-text underline" href="/gente?tela=cadastro&casa=sem">
            Completar no Cadastro
          </a>
        </p>
      ) : null}
    </Card>
  );
}
