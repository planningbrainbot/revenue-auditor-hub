import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Radar } from "lucide-react";
import { listGente, type GentePessoaRow } from "@/lib/gente.functions";
import { Card } from "@/components/ui/card";
import { EstadoVazio, StatusBadge, type TomStatus } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dataDoMarco, diasDeCasa } from "./tempo-de-casa";

// Radar de avaliação de experiência (AVE), pedido do RH de Maceió em
// 01/10/2026. NÃO é ciclo: o Brain ainda não cria ciclo, e a decisão de 30/09
// foi não colocar ninguém em ciclo automático por admissão. O radar só diz
// quem está em experiência e quando completa 45 e 90 dias, para o RH saber a
// quem aplicar a avaliação, que hoje roda fora do Brain.
//
// A lista vem do cadastro (`listGente`), que já sai recortado pela unidade na
// RLS. Quem só enxerga a própria linha (colaborador) não vê o radar.

const NA = "—";
const fmtData = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

interface LinhaRadar {
  pessoa: GentePessoaRow;
  marco: 45 | 90;
  prazo: string;
  falta: number;
}

function situacao(falta: number): { tom: TomStatus; texto: string } {
  if (falta === 0) return { tom: "perigo", texto: "completa hoje" };
  if (falta <= 7) return { tom: "atencao", texto: `faltam ${falta} dia${falta === 1 ? "" : "s"}` };
  return { tom: "neutro", texto: `faltam ${falta} dias` };
}

function Grupo({ titulo, linhas }: { titulo: string; linhas: LinhaRadar[] }) {
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
              <TableHead>Cargo</TableHead>
              <TableHead>Gestor</TableHead>
              <TableHead>Admissão</TableHead>
              <TableHead>Completa {linhas[0].marco} dias em</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => {
              const s = situacao(l.falta);
              return (
                <TableRow key={`${l.marco}-${l.pessoa.id}`}>
                  <TableCell>
                    <div className="font-medium">{l.pessoa.nomeCompleto}</div>
                    {l.pessoa.unidade ? (
                      <div className="text-[13px] text-muted-foreground">{l.pessoa.unidade}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{l.pessoa.cargo ?? NA}</TableCell>
                  <TableCell>
                    {l.pessoa.gestorNome ?? (
                      <span className="text-muted-foreground">sem gestor</span>
                    )}
                  </TableCell>
                  <TableCell className="num">{fmtData(l.pessoa.dataAdmissao!)}</TableCell>
                  <TableCell className="num">{fmtData(l.prazo)}</TableCell>
                  <TableCell>
                    <StatusBadge tom={s.tom}>{s.texto}</StatusBadge>
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
  // Mesma chave do Cadastro: a lista já carregada lá é reaproveitada aqui.
  const q = useQuery({ queryKey: ["gente"], queryFn: () => fn(), staleTime: 60_000 });

  const { fase45, fase90, semAdmissao } = useMemo(() => {
    const ativos = (q.data?.pessoas ?? []).filter((p) => p.status === "ativo");
    const fase45: LinhaRadar[] = [];
    const fase90: LinhaRadar[] = [];
    for (const p of ativos) {
      const dias = diasDeCasa(p.dataAdmissao);
      if (dias == null || dias > 90) continue;
      const marco = dias <= 45 ? 45 : 90;
      const linha = {
        pessoa: p,
        marco,
        prazo: dataDoMarco(p.dataAdmissao!, marco),
        falta: marco - dias,
      } as LinhaRadar;
      (marco === 45 ? fase45 : fase90).push(linha);
    }
    const porPrazo = (a: LinhaRadar, b: LinhaRadar) => a.prazo.localeCompare(b.prazo);
    return {
      fase45: fase45.sort(porPrazo),
      fase90: fase90.sort(porPrazo),
      semAdmissao: ativos.filter((p) => !p.dataAdmissao).length,
    };
  }, [q.data]);

  // Sem acesso individual ao cadastro o radar não tem o que mostrar.
  if (!q.data?.podeIndividual) return null;

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <Radar className="h-4 w-4 text-primary-text" />
        <h3 className="font-semibold">Radar de avaliação de experiência</h3>
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Quem está nos primeiros 90 dias, pela data de admissão do cadastro: a avaliação de 45 dias
        para quem ainda não chegou lá e a de 90 dias para quem já passou dos 45.
      </p>

      {fase45.length || fase90.length ? (
        <div className="space-y-6">
          <Grupo titulo="Avaliação de 45 dias" linhas={fase45} />
          <Grupo titulo="Avaliação de 90 dias" linhas={fase90} />
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
