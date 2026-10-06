import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { importarPessoas, type LinhaImportacao, type ResultadoLinha } from "@/lib/gente.functions";
import { Button } from "@/components/ui/button";
import { mesmoNome } from "./nomes";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Import do time da unidade por planilha, para o RH não cadastrar um por um.
// A leitura e a checagem ficam aqui para a pessoa ver o problema antes de
// enviar; quem grava e decide a unidade é o servidor, pela RLS.

const MAX_LINHAS = 300;
const SEM_LOGIN = "__sem_login__";

const COLUNAS_MODELO = [
  "Nome completo",
  "E-mail",
  "Cargo",
  "Departamento",
  "Vínculo",
  "Admissão",
  "Nascimento",
  "E-mail do gestor",
];

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Cabeçalho da planilha → campo. Aceita as variações mais comuns de escrita. */
function campoDoCabecalho(h: string): keyof Omit<LinhaImportacao, "linha"> | null {
  const k = semAcento(h);
  if (/gestor|lider|superior/.test(k)) return "emailGestor";
  if (/nasc|aniversario/.test(k)) return "dataNascimento";
  if (/e-?mail/.test(k)) return "email";
  if (/nome/.test(k)) return "nomeCompleto";
  if (/cargo|funcao/.test(k)) return "cargo";
  if (/depart|setor|area/.test(k)) return "departamento";
  if (/vinculo|contrato|regime/.test(k)) return "tipoVinculo";
  if (/admiss|entrada|inicio/.test(k)) return "dataAdmissao";
  return null;
}

const VINCULO_POR_TEXTO: Record<string, string> = {
  clt: "clt",
  pj: "pj",
  socio: "socio",
  estagio: "estagio",
  estagiario: "estagio",
  "pro-labore": "prolabore",
  "pro labore": "prolabore",
  prolabore: "prolabore",
  terceiro: "terceiro",
  terceirizado: "terceiro",
};

/** Data em AAAA-MM-DD a partir do número serial do Excel, DD/MM/AAAA ou AAAA-MM-DD. */
function normalizarData(v: unknown): string | null | undefined {
  if (v === "" || v == null) return undefined;
  let y: number, m: number, d: number;
  if (typeof v === "number") {
    // Serial do Excel direto, sem passar por Date: com `cellDates` o SheetJS
    // devolve 01/03 como 28/02 23:59 no fuso de Brasília.
    // Dia 0 do Excel é 30/12/1899; conta em UTC para o fuso não mexer no dia.
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  } else {
    const s = String(v).trim();
    const br = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (br) [d, m, y] = [Number(br[1]), Number(br[2]), Number(br[3])];
    else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else return null;
  }
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** CSV salvo pelo Excel em português costuma vir em Windows-1252, não UTF-8. */
function textoDoCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

interface LinhaLida extends LinhaImportacao {
  problemas: string[];
}

function lerPlanilha(buf: ArrayBuffer, csv: boolean): LinhaLida[] {
  // CSV vai cru: o SheetJS adivinha data em CSV no formato americano e 01/03
  // viraria 3 de janeiro.
  const wb = csv
    ? XLSX.read(textoDoCsv(buf), { type: "string", raw: true })
    : XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const bruto = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  const vistos = new Set<string>();

  return bruto
    .map((r, i) => {
      const l: LinhaLida = { linha: i + 2, nomeCompleto: "", email: "", problemas: [] };
      const datasBrutas: Record<"dataAdmissao" | "dataNascimento", unknown> = {
        dataAdmissao: "",
        dataNascimento: "",
      };
      for (const [h, v] of Object.entries(r)) {
        const campo = campoDoCabecalho(h);
        if (!campo) continue;
        if (campo === "dataAdmissao" || campo === "dataNascimento") {
          datasBrutas[campo] = v;
          continue;
        }
        const texto = String(v ?? "")
          .trim()
          .replace(/\s+/g, " ");
        if (texto) l[campo] = texto;
      }

      l.email = l.email.toLowerCase();
      if (l.emailGestor) l.emailGestor = l.emailGestor.toLowerCase();
      if (l.nomeCompleto.split(" ").length < 2) l.problemas.push("nome e sobrenome");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) l.problemas.push("e-mail inválido");
      else if (vistos.has(l.email)) l.problemas.push("e-mail repetido");
      vistos.add(l.email);

      if (l.tipoVinculo) {
        const v = VINCULO_POR_TEXTO[semAcento(l.tipoVinculo)];
        if (v) l.tipoVinculo = v;
        else l.problemas.push(`vínculo "${l.tipoVinculo}"`);
      }
      for (const [campo, rotulo] of [
        ["dataAdmissao", "data de admissão"],
        ["dataNascimento", "data de nascimento"],
      ] as const) {
        const data = normalizarData(datasBrutas[campo]);
        if (data === null) l.problemas.push(rotulo);
        else if (data) l[campo] = data;
      }
      if (l.emailGestor && l.emailGestor === l.email) l.problemas.push("gestor é a própria pessoa");
      return l;
    })
    .filter((l) => l.nomeCompleto || l.email);
}

function baixarModelo() {
  const ws = XLSX.utils.aoa_to_sheet([
    COLUNAS_MODELO,
    [
      "Maria Souza",
      "maria.souza@planning.com.br",
      "Líder de RH",
      "RH",
      "CLT",
      "01/03/2026",
      "12/05/1990",
      "",
    ],
    [
      "João Lima",
      "joao.lima@planning.com.br",
      "Analista",
      "BPO",
      "PJ",
      "15/04/2026",
      "03/11/1995",
      "maria.souza@planning.com.br",
    ],
  ]);
  ws["!cols"] = [28, 32, 20, 16, 12, 12, 12, 32].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pessoas");
  XLSX.writeFile(wb, "modelo-importacao-pessoas.xlsx");
}

const ROTULO_SITUACAO: Record<ResultadoLinha["situacao"], string> = {
  criada: "Cadastrada",
  ja_existe: "Já estava",
  erro: "Erro",
};

export function ImportarPessoasDialog({
  unidades,
  existentes,
}: {
  unidades: { id: number; nome: string }[];
  /** Ativos já no cadastro, para avisar de nome repetido na unidade. */
  existentes: { id: number; nome: string; email: string | null; unidadeId: number | null }[];
}) {
  const fn = useServerFn(importarPessoas);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState("");
  const [linhas, setLinhas] = useState<LinhaLida[]>([]);
  const [acesso, setAcesso] = useState<string>(SEM_LOGIN);
  const [resultados, setResultados] = useState<ResultadoLinha[] | null>(null);
  const [unidadeId, setUnidadeId] = useState<string>(
    unidades.length === 1 ? String(unidades[0].id) : "",
  );

  const [incluirHomonimos, setIncluirHomonimos] = useState(false);
  // Nome que já existe na unidade com OUTRO e-mail: provável duplicidade (caso
  // do Adílio). Mesmo nome e mesmo e-mail é a mesma pessoa: segue, e o servidor
  // só completa as datas vazias dela.
  const mesmoEmail = (a: string | null, b: string) => (a ?? "").trim().toLowerCase() === b;
  const homonimos = useMemo(() => {
    const daUnidade = existentes.filter((e) => String(e.unidadeId) === unidadeId);
    return new Map(
      linhas
        .map(
          (l) =>
            [
              l.linha,
              daUnidade.find(
                (e) => mesmoNome(e.nome, l.nomeCompleto) && !mesmoEmail(e.email, l.email),
              ),
            ] as const,
        )
        .filter(([, e]) => !!e)
        .map(([linha, e]) => [linha, e!.nome]),
    );
  }, [linhas, existentes, unidadeId]);
  const jaCadastradas = useMemo(
    () =>
      new Set(
        linhas
          .filter((l) => existentes.some((e) => mesmoEmail(e.email, l.email)))
          .map((l) => l.linha),
      ),
    [linhas, existentes],
  );
  const validas = useMemo(
    () =>
      linhas.filter((l) => !l.problemas.length && (incluirHomonimos || !homonimos.has(l.linha))),
    [linhas, homonimos, incluirHomonimos],
  );
  const comProblema = linhas.filter((l) => l.problemas.length).length;

  const limpar = () => {
    setArquivo("");
    setLinhas([]);
    setResultados(null);
  };

  const importar = useMutation({
    mutationFn: async () =>
      fn({
        data: {
          unidadeId: Number(unidadeId),
          acesso: acesso === SEM_LOGIN ? null : "colaborador",
          linhas: validas.map(({ problemas: _p, ...l }) => l),
        },
      }),
    onSuccess: ({ resultados: r }) => {
      setResultados(r);
      const criadas = r.filter((x) => x.situacao === "criada").length;
      if (criadas) toast.success(`${criadas} pessoa(s) cadastrada(s).`);
      else toast.warning("Ninguém novo entrou. Veja o relatório.");
      qc.invalidateQueries({ queryKey: ["gente"] });
      qc.invalidateQueries({ queryKey: ["gente-menu"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lerArquivo = async (f: File) => {
    setResultados(null);
    setArquivo(f.name);
    try {
      const lidas = lerPlanilha(await f.arrayBuffer(), /\.csv$/i.test(f.name));
      if (!lidas.length) {
        toast.error(
          "Não achei nenhuma pessoa. Confira se a primeira linha tem os cabeçalhos do modelo.",
        );
        setLinhas([]);
        return;
      }
      if (lidas.length > MAX_LINHAS) {
        toast.error(
          `A planilha tem ${lidas.length} pessoas. Divida em arquivos de até ${MAX_LINHAS}.`,
        );
        setLinhas([]);
        return;
      }
      setLinhas(lidas);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    }
  };

  const links = (resultados ?? []).filter((r) => r.link);

  if (!unidades.length) return null;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) limpar();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Importar planilha
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar pessoas por planilha</DialogTitle>
          <DialogDescription>
            Uma pessoa por linha, com nome completo e e-mail. Cargo, departamento, vínculo,
            admissão, nascimento e e-mail do gestor são opcionais. Quem já está no cadastro só tem
            completadas as datas de admissão e nascimento que estiverem vazias; o resto não é
            alterado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={baixarModelo}>
              <Download className="mr-2 h-4 w-4" />
              Baixar modelo
            </Button>
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                Arquivo (.xlsx ou .csv)
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void lerArquivo(f);
                  e.target.value = "";
                }}
              />
            </label>
            {arquivo ? (
              <span className="text-xs text-muted-foreground">
                {arquivo}: {linhas.length} pessoa(s)
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {unidades.length > 1 ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ip-unidade">Unidade</Label>
                <Select value={unidadeId} onValueChange={setUnidadeId}>
                  <SelectTrigger id="ip-unidade">
                    <SelectValue placeholder="Escolha a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="ip-acesso">Acesso ao Brain</Label>
              <Select value={acesso} onValueChange={setAcesso}>
                <SelectTrigger id="ip-acesso">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_LOGIN}>Sem login, só no cadastro</SelectItem>
                  <SelectItem value="colaborador">Colaborador, com convite por e-mail</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Quem já tem login no Brain é ligado ao cadastro nos dois casos. Gestão de gente se
                dá depois, uma pessoa por vez.
              </p>
            </div>
          </div>

          {linhas.length > 0 && !resultados ? (
            <div className="rounded-md border">
              <div className="border-b bg-muted/40 px-3 py-2 text-xs">
                {validas.length} pronta(s) para importar
                {comProblema ? `, ${comProblema} com problema (fica(m) de fora)` : ""}
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Linha</th>
                      <th className="px-3 py-2 text-left">Nome</th>
                      <th className="px-3 py-2 text-left">E-mail</th>
                      <th className="px-3 py-2 text-left">Cargo</th>
                      <th className="px-3 py-2 text-left">Gestor</th>
                      <th className="px-3 py-2 text-left">Problema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr
                        key={l.linha}
                        className={
                          "border-t " +
                          (l.problemas.length
                            ? "bg-danger-soft"
                            : homonimos.has(l.linha)
                              ? "bg-warning-soft"
                              : "")
                        }
                      >
                        <td className="px-3 py-1.5 tabular-nums">{l.linha}</td>
                        <td className="px-3 py-1.5">{l.nomeCompleto}</td>
                        <td className="px-3 py-1.5">{l.email}</td>
                        <td className="px-3 py-1.5">{l.cargo}</td>
                        <td className="px-3 py-1.5">{l.emailGestor}</td>
                        <td className="px-3 py-1.5">
                          {[
                            ...l.problemas,
                            ...(homonimos.has(l.linha)
                              ? [`já existe "${homonimos.get(l.linha)}" na unidade`]
                              : []),
                            ...(jaCadastradas.has(l.linha)
                              ? ["já cadastrada: só completa datas vazias"]
                              : []),
                          ].join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {homonimos.size ? (
                <label className="flex items-start gap-2 border-t bg-warning-soft px-3 py-2 text-xs text-warning">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={incluirHomonimos}
                    onChange={(e) => setIncluirHomonimos(e.target.checked)}
                  />
                  <span>
                    {homonimos.size} nome(s) já existem na unidade com outro e-mail e ficam de fora,
                    porque costuma ser a mesma pessoa cadastrada duas vezes. Marque para importar
                    mesmo assim, se forem pessoas diferentes.
                  </span>
                </label>
              ) : null}
              {comProblema ? (
                <div className="flex items-center gap-2 border-t bg-warning-soft px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Corrija na planilha e envie de novo, ou importe só as prontas agora.
                </div>
              ) : null}
            </div>
          ) : null}

          {resultados ? (
            <div className="rounded-md border">
              <div className="border-b bg-muted/40 px-3 py-2 text-xs">
                {resultados.filter((r) => r.situacao === "criada").length} cadastrada(s),{" "}
                {resultados.filter((r) => r.situacao === "ja_existe").length} já estava(m),{" "}
                {resultados.filter((r) => r.situacao === "erro").length} com erro
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Linha</th>
                      <th className="px-3 py-2 text-left">E-mail</th>
                      <th className="px-3 py-2 text-left">Resultado</th>
                      <th className="px-3 py-2 text-left">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((r) => (
                      <tr
                        key={r.linha}
                        className={"border-t " + (r.situacao === "erro" ? "bg-danger-soft" : "")}
                      >
                        <td className="px-3 py-1.5 tabular-nums">{r.linha}</td>
                        <td className="px-3 py-1.5">{r.email}</td>
                        <td className="px-3 py-1.5">
                          {ROTULO_SITUACAO[r.situacao]}
                          {r.acesso === "criado" ? ", convite criado" : ""}
                          {r.acesso === "vinculado" ? ", ligada ao login" : ""}
                        </td>
                        <td className="px-3 py-1.5">
                          {[r.mensagem, r.avisoGestor].filter(Boolean).join(" ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {links.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-warning-soft px-3 py-2 text-xs text-warning">
                  <span>{links.length} convite(s) não saíram por e-mail.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      navigator.clipboard.writeText(
                        links.map((r) => `${r.email}\t${r.link}`).join("\n"),
                      )
                    }
                  >
                    Copiar links
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => setAberto(false)}>
            {resultados ? "Fechar" : "Cancelar"}
          </Button>
          {!resultados ? (
            <Button
              onClick={() => importar.mutate()}
              disabled={importar.isPending || !validas.length || !unidadeId}
            >
              {importar.isPending ? "Importando…" : `Importar ${validas.length || ""}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
