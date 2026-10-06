import { HeartPulse } from "lucide-react";
import type { GentePessoaRow } from "@/lib/gente.functions";
import { Card } from "@/components/ui/card";
import { StatusBadge, type TomStatus } from "@/components/planning";
import { diasDeCasa } from "./tempo-de-casa";

// Radar de afastamentos no Cadastro (05/10/2026, pedido do RH de Maceió para
// acompanhar SST e não perder o retorno). Lê o afastamento em aberto que já vem
// no cadastro; o CID só aparece para quem tem a chave de saúde (RH).

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");

function situacao(previsao: string | null): { tom: TomStatus; texto: string; ordem: number } {
  if (!previsao) return { tom: "neutro", texto: "sem previsão de retorno", ordem: 9_999 };
  // Dias até a previsão: o inverso do "dias de casa" contado a partir dela.
  const falta = -(diasDeCasa(previsao) ?? 0);
  if (falta < 0)
    return {
      tom: "perigo",
      texto: `previsão venceu há ${-falta} dia${falta === -1 ? "" : "s"}`,
      ordem: falta,
    };
  if (falta === 0) return { tom: "atencao", texto: "retorno previsto hoje", ordem: 0 };
  if (falta <= 7)
    return {
      tom: "atencao",
      texto: `retorno em ${falta} dia${falta === 1 ? "" : "s"}`,
      ordem: falta,
    };
  return { tom: "info", texto: `retorno em ${falta} dias`, ordem: falta };
}

export function AfastamentosCard({ pessoas }: { pessoas: GentePessoaRow[] }) {
  const afastadas = pessoas
    .filter((p) => p.status === "afastado")
    .map((p) => ({ p, s: situacao(p.afastamento?.previsaoRetorno ?? null) }))
    .sort((a, b) => a.s.ordem - b.s.ordem);
  if (!afastadas.length) return null;

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-primary-text" />
        <h3 className="font-semibold">Afastamentos</h3>
        <span className="num text-[13px] text-muted-foreground">({afastadas.length})</span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Quem está afastado e quando volta. Quando a pessoa voltar, use Registrar retorno no Editar
        dela.
      </p>
      <ul className="divide-y text-sm">
        {afastadas.map(({ p, s }) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium">{p.nomeCompleto}</span>
            <span className="text-[13px] text-muted-foreground">
              {p.afastamento
                ? `desde ${fmt(p.afastamento.inicio)} · ${p.afastamento.motivo}${p.afastamento.previsaoRetorno ? ` · volta em ${fmt(p.afastamento.previsaoRetorno)}` : ""}${p.afastamento.cid ? ` · CID ${p.afastamento.cid}` : ""}`
                : "afastamento sem registro de data e motivo"}
            </span>
            <span className="ml-auto">
              <StatusBadge tom={p.afastamento ? s.tom : "neutro"}>
                {p.afastamento ? s.texto : "complete pelo Editar"}
              </StatusBadge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
