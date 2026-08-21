import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNpsExecucao } from "@/hooks/use-nps";

function tempoDecorrido(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 > 0 ? ` ${min % 60}min` : ""}`;
  return `${Math.floor(h / 24)}d`;
}

export function NpsExecucaoTab() {
  const { data, isLoading, error, dataUpdatedAt } = useNpsExecucao();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Acompanha em tempo real os disparos feitos pelo workflow de WhatsApp — atualiza sozinho a cada 15s.
        </p>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-muted-foreground">
            atualizado há {Math.round((Date.now() - dataUpdatedAt) / 1000)}s
          </span>
        )}
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando execução…</Card>}
      {error && <Card className="p-6 text-sm text-red-600">Erro ao carregar execução.</Card>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Enviados nesta campanha</div>
              <div className="mt-1 text-2xl font-semibold">{data.totalEnviados}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Respondidos</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-600">{data.totalRespondidos}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Aguardando resposta</div>
              <div className="mt-1 text-2xl font-semibold text-amber-600">{data.totalAguardando}</div>
            </Card>
          </div>

          <Card>
            <div className="border-b p-3 text-sm font-medium">Disparos (mais recentes primeiro)</div>
            <div className="relative max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-background">Telefone</TableHead>
                    <TableHead className="bg-background">Empresa</TableHead>
                    <TableHead className="bg-background">Enviado há</TableHead>
                    <TableHead className="bg-background">Status</TableHead>
                    <TableHead className="bg-background text-center">NPS</TableHead>
                    <TableHead className="bg-background">Card Pipefy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.telefone}</TableCell>
                      <TableCell>{r.empresa ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{tempoDecorrido(r.enviadoEm)}</TableCell>
                      <TableCell>
                        {r.respondido ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200">Respondido</Badge>
                        ) : (
                          <Badge variant="outline">Aguardando</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{r.npsRecomendacao ?? "—"}</TableCell>
                      <TableCell>
                        <a
                          href={`https://app.pipefy.com/open-cards/${r.pipefyCardId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary underline underline-offset-2"
                        >
                          ver card
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Nenhum disparo ainda. Assim que o workflow "NPS - Criar Card e Enviar WhatsApp" rodar, os envios aparecem aqui em tempo real.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
