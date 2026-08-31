import { useMemo, useState } from "react";
import { ClipboardList, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePlanoAcaoContatos } from "@/hooks/use-nps";

const ALL = "todas";

export function NpsPlanoAcaoTab() {
  const { data, isLoading, error } = usePlanoAcaoContatos();
  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.empresasSemContato.filter((e) => {
      if (unidade !== ALL && e.unidade !== unidade) return false;
      if (status !== ALL && e.status !== status) return false;
      if (term) {
        const hay = [e.titulo, e.cnpj].filter(Boolean).map((v) => String(v).toLowerCase()).join(" ");
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [data, q, unidade, status]);

  const coberturaPct =
    data && data.totalEmpresas > 0 ? Math.round((data.totalComContatoValido / data.totalEmpresas) * 100) : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Lista de trabalho pro time de CS: toda empresa cliente ativa (Base Nova ou Antiga) precisa de pelo menos 1
        contato com WhatsApp válido pra entrar nos disparos de NPS. Aqui estão as que ainda faltam.
      </p>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando plano de ação…</Card>}
      {error && <Card className="p-6 text-sm text-red-600">Erro ao carregar plano de ação.</Card>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Clientes ativos</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{data.totalEmpresas}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Com WhatsApp válido</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">
                {data.totalComContatoValido}
                <span className="ml-1 text-sm font-normal text-muted-foreground">({coberturaPct}%)</span>
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Faltando contato</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-red-600">
                {data.empresasSemContato.length}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Contatos p/ classificar</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">
                {data.contatosParaClassificar.length}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">têm WhatsApp mas sem empresa vinculada</div>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <ClipboardList className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Empresas sem contato válido</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar empresa ou CNPJ…"
                    className="h-8 w-56 pl-7"
                  />
                </div>
                <Select value={unidade} onValueChange={setUnidade}>
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas unidades</SelectItem>
                    {data.unidades.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos status</SelectItem>
                    <SelectItem value="sem_contato">Sem nenhum contato</SelectItem>
                    <SelectItem value="contato_sem_whatsapp">Tem contato, sem WhatsApp</SelectItem>
                    <SelectItem value="contato_formato_invalido">WhatsApp com formato inválido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="relative max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-background">Empresa</TableHead>
                    <TableHead className="bg-background">CNPJ</TableHead>
                    <TableHead className="bg-background">Unidade</TableHead>
                    <TableHead className="bg-background">Base</TableHead>
                    <TableHead className="bg-background">Situação</TableHead>
                    <TableHead className="bg-background">Contatos existentes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.titulo ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{e.cnpj ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.unidade}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.origemDaBase ?? "—"}</TableCell>
                      <TableCell>
                        {e.status === "sem_contato" ? (
                          <Badge variant="outline" className="border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400">
                            Sem contato
                          </Badge>
                        ) : e.status === "contato_formato_invalido" ? (
                          <Badge variant="outline" className="border-orange-600/30 bg-orange-600/[0.07] text-orange-700 dark:text-orange-400">
                            Formato inválido
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-600/30 bg-amber-600/[0.07] text-amber-700 dark:text-amber-400">
                            Sem WhatsApp
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.contatosNomes.length > 0 ? e.contatosNomes.join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Nenhuma empresa com esses filtros.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {data.contatosParaClassificar.length > 0 && (
            <Card>
              <div className="border-b p-3 text-sm font-medium">
                Contatos com WhatsApp esperando classificação
                <span className="ml-2 font-normal text-muted-foreground">
                  — têm número mas não estão vinculados a nenhuma empresa em /clientes
                </span>
              </div>
              <div className="relative max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="bg-background">Nome</TableHead>
                      <TableHead className="bg-background">WhatsApp</TableHead>
                      <TableHead className="bg-background">Email</TableHead>
                      <TableHead className="bg-background">Cargo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.contatosParaClassificar.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.nomeCompleto ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{c.whatsapp ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.email ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.cargo ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
