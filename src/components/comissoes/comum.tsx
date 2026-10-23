// Peças comuns da área Comissões (contrato docs/design/contratos/comissoes.md): casca da página, tabela
// das linhas de um pagamento, seletor de mês e a ação com aviso e recarga.
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, StatusBadge } from "@/components/planning";
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
import { CHAVE_COMISSOES } from "@/lib/comissoes/api";
import { mesExtenso, metadeTexto, origem, papelTexto, type Linha } from "@/lib/comissoes/tipos";

export const brl = (v: number | string | null | undefined) =>
  v == null ? "-" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (v: number | string | null | undefined) =>
  v == null ? "-" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const dia = (v: string | null | undefined) =>
  v ? v.slice(0, 10).split("-").reverse().join("/") : "-";

export function Pagina({
  titulo,
  pergunta,
  descricao,
  acoes,
  children,
}: {
  titulo: string;
  pergunta?: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="comissoes"
        titulo={titulo}
        pergunta={pergunta}
        descricao={descricao}
        acoes={acoes}
      />
      {children}
    </main>
  );
}

/** Ação que grava: mostra o aviso, devolve o erro do banco em texto e recarrega a área. */
export function useAcao<A>(fazer: (a: A) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fazer,
    onSuccess: () => {
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: CHAVE_COMISSOES });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function SeletorMes({
  atual,
  meses,
  aoMudar,
}: {
  atual: string;
  meses: string[];
  aoMudar: (m: string) => void;
}) {
  const opcoes = Array.from(new Set([atual, ...meses.map((m) => m.slice(0, 7))]))
    .sort()
    .reverse();
  return (
    <Select value={atual} onValueChange={aoMudar}>
      <SelectTrigger className="w-[200px]" aria-label="Mês de pagamento">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map((m) => (
          <SelectItem key={m} value={m}>
            {mesExtenso(`${m}-01`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function situacaoDe(l: Linha) {
  if (l.excluida) return <StatusBadge tom="neutro">Excluída</StatusBadge>;
  if (l.tipo === "ajuste") return <StatusBadge tom="info">Ajuste</StatusBadge>;
  if (l.tipo === "bonus") return <StatusBadge tom="sucesso">Bônus</StatusBadge>;
  if (l.ajustada) return <StatusBadge tom="info">Ajustada</StatusBadge>;
  return null;
}

export function TabelaLinhas({
  linhas,
  comPessoa = false,
  acao,
}: {
  linhas: Linha[];
  comPessoa?: boolean;
  acao?: (l: Linha) => ReactNode;
}) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? linhas.filter((l) =>
        `${l.cliente ?? ""} ${l.pessoa} ${l.unidade ?? ""}`.toLowerCase().includes(termo),
      )
    : linhas;
  return (
    <div className="space-y-3">
      {linhas.length > 10 ? (
        <input
          type="search"
          aria-label="Buscar cliente ou pessoa"
          placeholder="Buscar cliente ou pessoa"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
        />
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {comPessoa ? <TableHead>Pessoa</TableHead> : null}
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Unidade</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Metade</TableHead>
              <TableHead className="hidden text-right md:table-cell">Base</TableHead>
              <TableHead className="hidden text-right md:table-cell">%</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="hidden lg:table-cell">De onde veio</TableHead>
              <TableHead />
              {acao ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((l) => (
              <TableRow key={l.id}>
                {comPessoa ? <TableCell>{l.pessoa}</TableCell> : null}
                <TableCell className="font-medium">{l.cliente ?? l.motivo ?? "-"}</TableCell>
                <TableCell className="hidden md:table-cell">{l.unidade ?? "-"}</TableCell>
                <TableCell>{papelTexto(l.papel)}</TableCell>
                <TableCell>{metadeTexto(l.metade)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {brl(l.base)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {pct(l.percentual)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${l.excluida ? "text-muted-foreground line-through" : l.valor < 0 ? "text-danger" : ""}`}
                >
                  {brl(l.valor)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {origem(l)}
                </TableCell>
                <TableCell>{situacaoDe(l)}</TableCell>
                {acao ? <TableCell>{acao(l)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {termo && visiveis.length < linhas.length ? (
        <p className="text-sm text-muted-foreground">
          {visiveis.length} de {linhas.length} linhas.
        </p>
      ) : null}
    </div>
  );
}
