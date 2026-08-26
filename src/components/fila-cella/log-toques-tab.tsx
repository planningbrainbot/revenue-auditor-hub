import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFilaCella, useToquesDaConta } from "@/hooks/use-fila-cella";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dataBR } from "@/lib/fila-cella.types";

/**
 * Aba 3 — o log de toques, com o `literal` INTEGRAL.
 *
 * O literal não é resumido em lugar nenhum: é registro de compliance (playbook
 * §2.5 e §4.7) e vai inteiro no handoff ao Cella. Resumir aqui criaria duas
 * versões do que foi dito.
 *
 * A leitura é por conta porque `fila_cella_toques` não guarda `conta_id` — a
 * ligação passa por `fila_cella_ciclos`. Um log global exigiria ou embedding do
 * PostgREST ou uma view nova; nenhum dos dois cabe na v1.
 */
export function LogToquesTab() {
  const fila = useFilaCella();
  const [contaId, setContaId] = useState<string>("");
  const [busca, setBusca] = useState("");
  const toques = useToquesDaConta(contaId ? Number(contaId) : null);

  const contas = useMemo(() => {
    const rows = fila.data?.rows ?? [];
    return [...rows].sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
  }, [fila.data]);

  const filtrados = (toques.data?.toques ?? []).filter((t) =>
    busca ? t.literal.toLowerCase().includes(busca.toLowerCase()) : true,
  );
  const ciclos = new Map((toques.data?.ciclos ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={contaId} onValueChange={setContaId}>
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="Escolha a conta" />
          </SelectTrigger>
          <SelectContent>
            {contas.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.titulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-[280px]"
          placeholder="Buscar no literal"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {!contaId && (
        <Card className="p-6 text-sm text-muted-foreground">
          Escolha uma conta para ver o histórico de toques.
        </Card>
      )}

      {contaId && toques.isLoading && (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      )}

      {contaId && !toques.isLoading && filtrados.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">Nenhum toque registrado.</Card>
      )}

      {filtrados.length > 0 && (
        <Card className="divide-y p-0">
          {filtrados.map((t) => {
            const c = ciclos.get(t.ciclo_id);
            return (
              <div key={t.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Ciclo {c?.numero ?? "?"} · toque {t.toque_num}/4
                  </span>
                  <span>{dataBR(t.data)}</span>
                  <span>·</span>
                  <span>{t.canal}</span>
                  <span>·</span>
                  <span>gatilho {t.gatilho_ref}</span>
                  <Badge variant="outline" className="font-normal">
                    {t.resultado}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {t.frente}
                  </Badge>
                  {t.corrige_toque_id && (
                    <Badge variant="outline" className="font-normal">
                      corrige #{t.corrige_toque_id}
                    </Badge>
                  )}
                  {t.override_por && (
                    <Badge className="bg-amber-500 font-normal text-white hover:bg-amber-500">
                      override
                    </Badge>
                  )}
                  {!t.atesto_sem_citar_cliente && (
                    <Badge
                      variant="outline"
                      className="border-amber-300 font-normal text-amber-700 dark:border-amber-900 dark:text-amber-300"
                    >
                      sem atesto
                    </Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{t.literal}</p>
                {t.resposta && (
                  <p className="text-sm text-muted-foreground">Resposta: {t.resposta}</p>
                )}
                {t.proximo_passo && (
                  <p className="text-sm text-muted-foreground">
                    Próximo passo: {t.proximo_passo} ({dataBR(t.proximo_passo_em)})
                  </p>
                )}
                {t.motivo && <p className="text-sm text-muted-foreground">Motivo: {t.motivo}</p>}
              </div>
            );
          })}
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Append-only: não existe editar nem apagar toque, na tela nem no banco (sem policy e sem
        grant de UPDATE/DELETE). Correção é linha nova apontando o toque corrigido.
      </p>
    </div>
  );
}
