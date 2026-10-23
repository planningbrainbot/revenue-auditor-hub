import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl, dia, Pagina, TabelaLinhas } from "@/components/comissoes/comum";
import { usePermissions } from "@/hooks/use-permissions";
import { CHAVE_COMISSOES, comissoes } from "@/lib/comissoes/api";
import { mesExtenso, metadeTexto, papelTexto, SITUACAO } from "@/lib/comissoes/tipos";

// Minhas comissões (contrato docs/design/contratos/comissoes.md §1): o próximo pagamento, só depois que os
// líderes liberam, o que fica para depois com o motivo, e os pagamentos anteriores. Cada pessoa vê só o
// que é dela: quem recorta é ops.comissoes_minhas, pelo login.

export const Route = createFileRoute("/_authenticated/comissoes/")({
  head: () => ({ meta: [{ title: "Minhas comissões · Planning Brain" }] }),
  component: MinhasComissoes,
});

const TITULO = "Minhas comissões";
const PERGUNTA = "Quanto eu recebo no dia 20?";
const DESCRICAO =
  "Contratos do Inside Sales em que você é closer ou SDR · cada contrato paga em duas metades, quando a apuração da unidade fecha com aquele cliente · pagamento pelo iFood todo dia 20.";

function MinhasComissoes() {
  const perms = usePermissions();
  const q = useQuery({
    queryKey: [...CHAVE_COMISSOES, "minhas"],
    queryFn: comissoes.minhas,
    enabled: !perms.loading && perms.can("view.comissoes"),
    retry: false,
  });

  if (perms.loading)
    return (
      <Pagina titulo={TITULO} pergunta={PERGUNTA}>
        <Carregando variante="pagina" />
      </Pagina>
    );
  if (!perms.can("view.comissoes"))
    return (
      <Pagina titulo={TITULO} pergunta={PERGUNTA}>
        <EstadoSemAcesso oQueFalta="view.comissoes (área Comissões, concedida pela administração)" />
      </Pagina>
    );
  if (q.isLoading)
    return (
      <Pagina titulo={TITULO} pergunta={PERGUNTA} descricao={DESCRICAO}>
        <Carregando variante="pagina" />
      </Pagina>
    );
  if (q.isError)
    return (
      <Pagina titulo={TITULO} pergunta={PERGUNTA} descricao={DESCRICAO}>
        <EstadoErro
          titulo="As comissões não carregaram"
          detalhe={`Fonte: ops.comissoes_minhas. ${(q.error as Error).message}`}
          tentarNovamente={() => q.refetch()}
        />
      </Pagina>
    );
  const d = q.data!;
  if (!d.vinculado)
    return (
      <Pagina titulo={TITULO} pergunta={PERGUNTA} descricao={DESCRICAO}>
        <EstadoVazio
          titulo="Seu login ainda não está ligado ao seu nome no Pipedrive"
          descricao="Peça ao líder comercial para fazer o vínculo na Revisão do mês. Sem ele, o sistema não sabe quais contratos são seus."
        />
      </Pagina>
    );
  const p = d.proximo;

  return (
    <Pagina titulo={TITULO} pergunta={PERGUNTA} descricao={DESCRICAO}>
      <Secao
        titulo={p ? `Próximo pagamento · ${dia(p.pagamento_em)}` : "Próximo pagamento"}
        acoes={
          p ? (
            <StatusBadge tom={SITUACAO[p.situacao].tom}>{SITUACAO[p.situacao].texto}</StatusBadge>
          ) : undefined
        }
      >
        {!p ? (
          <EstadoVazio
            titulo="Nada a receber ainda"
            descricao="Quando a apuração de uma unidade fechar com um cliente seu, a metade aparece aqui."
          />
        ) : p.situacao === "previa" ? (
          <KpiGrade colunas={2}>
            <KpiCard
              rotulo={`Pagamento de ${mesExtenso(p.mes)}`}
              valor="Em revisão"
              nota={`Os líderes comerciais revisam até ${dia(p.prazo)}. Depois disso o valor aparece aqui.`}
            />
          </KpiGrade>
        ) : (
          <div className="space-y-4">
            <KpiGrade colunas={2}>
              <KpiCard
                rotulo={`Pagamento de ${mesExtenso(p.mes)}`}
                valor={brl(p.total)}
                nota={`Pelo iFood, em ${dia(p.pagamento_em)}.`}
              />
            </KpiGrade>
            <TabelaLinhas linhas={p.linhas} />
          </div>
        )}
      </Secao>

      <Secao
        titulo="Fica para depois"
        descricao="Metades que ainda não foram liberadas. O valor é uma estimativa com o seu percentual atual."
      >
        {d.depois.length === 0 ? (
          <EstadoVazio
            titulo="Nada pendente"
            descricao="Tudo o que você vendeu desde 01/10/2026 já entrou em algum pagamento."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Unidade</TableHead>
                  <TableHead className="hidden md:table-cell">Papel</TableHead>
                  <TableHead>Metade</TableHead>
                  <TableHead className="text-right">Estimado</TableHead>
                  <TableHead>O que falta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.depois.map((x) => (
                  <TableRow key={`${x.contrato_id}-${x.papel}-${x.metade}`}>
                    <TableCell className="font-medium">{x.cliente}</TableCell>
                    <TableCell className="hidden md:table-cell">{x.unidade}</TableCell>
                    <TableCell className="hidden md:table-cell">{papelTexto(x.papel)}</TableCell>
                    <TableCell>{metadeTexto(x.metade)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {x.valor_estimado == null ? "-" : brl(x.valor_estimado)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tom="atencao">{x.motivo}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      {d.historico.length ? (
        <Secao titulo="Pagamentos anteriores">
          <div className="space-y-2">
            {d.historico.map((h) => (
              <details key={h.mes} className="rounded-lg border p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 font-medium">
                  <span>{mesExtenso(h.mes)}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{brl(h.total)}</span>
                    <StatusBadge tom={SITUACAO[h.situacao].tom}>
                      {SITUACAO[h.situacao].texto}
                    </StatusBadge>
                  </span>
                </summary>
                <div className="mt-3">
                  <TabelaLinhas linhas={h.linhas} />
                </div>
              </details>
            ))}
          </div>
        </Secao>
      ) : null}
    </Pagina>
  );
}
