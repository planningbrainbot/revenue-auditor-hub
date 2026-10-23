import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl, dia, Pagina, SeletorMes, TabelaLinhas, useAcao } from "@/components/comissoes/comum";
import { Confirmar } from "@/components/comissoes/confirmar";
import { BlocosPendencias } from "@/components/comissoes/pendencias";
import { usePermissions } from "@/hooks/use-permissions";
import { CHAVE_COMISSOES, comissoes } from "@/lib/comissoes/api";
import {
  mesAnterior,
  mesCurto,
  mesExtenso,
  mesPadrao,
  metadeTexto,
  origem,
  papelTexto,
  SITUACAO,
  type Revisao,
} from "@/lib/comissoes/tipos";

// Fechamento (contrato docs/design/contratos/comissoes.md §3): o financeiro registra as datas onde não há
// CAC, baixa a planilha para o Departamento Pessoal (até o dia 11, ou o próximo dia útil), e marca como
// pago depois do pagamento pelo iFood no dia 20.

const MES = /^\d{4}-\d{2}$/;

export const Route = createFileRoute("/_authenticated/comissoes/fechamento")({
  validateSearch: (s: Record<string, unknown>): { mes?: string } =>
    typeof s.mes === "string" && MES.test(s.mes) ? { mes: s.mes } : {},
  head: () => ({ meta: [{ title: "Fechamento das comissões · Planning Brain" }] }),
  component: Fechamento,
});

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

// Planilha para o DP: uma aba por pessoa e valor (o que o iFood paga) e uma com as linhas, no layout da
// planilha de comissões de hoje. O formato final do iFood está em aberto (P-13 do PRD).
function baixarPlanilha(mes: string, d: Revisao) {
  const wb = XLSX.utils.book_new();
  const porPessoa = [
    ["Pessoa", "Valor a pagar"],
    ...d.pessoas.map((p) => [p.nome, Number(p.total)]),
    ["Total", Number(d.total)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(porPessoa), "Para o DP");
  const linhas = [
    [
      "Pessoa",
      "Papel",
      "Tipo",
      "Cliente",
      "Unidade",
      "Metade",
      "Base",
      "%",
      "Valor",
      "De onde veio",
      "Excluída",
      "Motivo",
    ],
    ...d.linhas.map((l) => [
      l.pessoa,
      papelTexto(l.papel),
      l.tipo,
      l.cliente ?? "",
      l.unidade ?? "",
      metadeTexto(l.metade),
      l.base == null ? "" : Number(l.base),
      l.percentual == null ? "" : Number(l.percentual),
      Number(l.valor),
      origem(l),
      l.excluida ? "sim" : "",
      l.motivo ?? "",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "Linhas");
  XLSX.writeFile(wb, `comissoes-${mes}.xlsx`);
}

function Fechamento() {
  const perms = usePermissions();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const mes = busca.mes ?? mesPadrao(hojeSP());
  const financeiro = perms.can("manage.comissoes_fechamento");
  const [motivo, setMotivo] = useState("");
  const q = useQuery({
    queryKey: [...CHAVE_COMISSOES, "revisao", mes],
    queryFn: () => comissoes.revisao(mes),
    enabled: !perms.loading && financeiro,
    retry: false,
  });
  const pagar = useAcao(() => comissoes.marcarPago(mes), "Mês marcado como pago.");
  const reabrir = useAcao(() => comissoes.reabrir(mes, motivo), "Mês reaberto para os líderes.");

  const titulo = "Fechamento";
  const pergunta = "Quanto pagar no dia 20 e para quem?";
  const descricao =
    "Linhas liberadas pelos líderes · planilha para o Departamento Pessoal até o dia 11 (ou o próximo dia útil) · pagamento pelo iFood no dia 20.";
  if (perms.loading)
    return (
      <Pagina titulo={titulo} pergunta={pergunta}>
        <Carregando variante="pagina" />
      </Pagina>
    );
  if (!financeiro)
    return (
      <Pagina titulo={titulo} pergunta={pergunta}>
        <EstadoSemAcesso oQueFalta="manage.comissoes_fechamento (área Comissões: fechamento, concedida pela administração)" />
      </Pagina>
    );
  const d = q.data;
  const acoes = (
    <div className="flex flex-wrap items-center gap-2">
      <SeletorMes
        atual={mes}
        meses={d?.meses ?? []}
        aoMudar={(m) => navigate({ search: { mes: m }, replace: true })}
      />
      <Button
        variant="outline"
        disabled={!d}
        onClick={async () => {
          try {
            baixarPlanilha(mes, await comissoes.exportar(mes));
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        <Download className="size-4" aria-hidden />
        Baixar planilha para o DP
      </Button>
      {d?.situacao === "liberado" ? (
        <Confirmar
          rotulo="Marcar como pago"
          titulo={`Marcar ${mesExtenso(`${mes}-01`)} como pago?`}
          texto={`Total de ${brl(d.total)}. Faça isso depois do pagamento pelo iFood. Depois de pago, o mês não pode ser reaberto.`}
          confirmar="Marcar como pago"
          aoConfirmar={() => pagar.mutate(undefined)}
          desabilitado={pagar.isPending}
        />
      ) : (
        <Button
          disabled
          title={
            d?.situacao === "pago"
              ? "Este mês já está pago."
              : "Os líderes ainda não liberaram este mês."
          }
        >
          Marcar como pago
        </Button>
      )}
    </div>
  );

  return (
    <Pagina titulo={titulo} pergunta={pergunta} descricao={descricao} acoes={acoes}>
      {q.isLoading ? (
        <Carregando variante="pagina" />
      ) : q.isError || !d ? (
        <EstadoErro
          titulo="O fechamento não carregou"
          detalhe={`Fonte: ops.comissoes_revisao. ${(q.error as Error | null)?.message ?? ""}`}
          tentarNovamente={() => q.refetch()}
        />
      ) : (
        <>
          <KpiGrade colunas={3}>
            <KpiCard
              rotulo="Total a pagar"
              valor={brl(d.total)}
              nota={`Pelo iFood em ${dia(d.pagamento_em)}.`}
            />
            <KpiCard
              rotulo="Situação"
              valor={SITUACAO[d.situacao].texto}
              nota={
                d.situacao === "previa"
                  ? "Os líderes ainda não liberaram."
                  : d.situacao === "liberado"
                    ? `Enviar ao DP até ${dia(d.envio_dp_em)}.`
                    : d.pago_em
                      ? `Pago em ${dia(d.pago_em)}.`
                      : undefined
              }
            />
            <KpiCard
              rotulo={`Apurações de ${mesCurto(mesAnterior(mes))}`}
              valor={`${d.apuracoes.filter((a) => a.status === "confirmado").length} de ${d.apuracoes.length}`}
              nota="fechadas (prazo: dia 5)."
            />
          </KpiGrade>

          {d.situacao === "liberado" ? (
            <Secao
              titulo="Reabrir para os líderes"
              descricao="Só antes de marcar como pago. O motivo fica registrado."
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Motivo para reabrir"
                  placeholder="Motivo"
                  className="max-w-md"
                  maxLength={500}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={motivo.trim().length < 3 || reabrir.isPending}
                  onClick={() => reabrir.mutate(undefined, { onSuccess: () => setMotivo("") })}
                >
                  Reabrir
                </Button>
              </div>
            </Secao>
          ) : null}

          <BlocosPendencias
            pend={{
              ...d.pendencias,
              sem_parcela: [],
              regra_antiga: [],
              sem_vinculo: [],
              pessoa_trocada: [],
              pipe_a_confirmar: [],
              sem_closer: [],
            }}
            lider={false}
            financeiro
            editavel={false}
          />

          <Secao titulo="Total por pessoa">
            {d.pessoas.length === 0 ? (
              <EstadoVazio titulo="Ninguém neste pagamento" />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pessoa</TableHead>
                      <TableHead>Login</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.pessoas.map((p) => (
                      <TableRow key={p.pessoa_id}>
                        <TableCell className="font-medium">{p.nome}</TableCell>
                        <TableCell>
                          {p.vinculado ? (
                            "ligado"
                          ) : (
                            <StatusBadge tom="atencao">sem login</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(p.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Secao>

          <Secao titulo={`Apurações de ${mesCurto(mesAnterior(mes))} que alimentam o mês`}>
            {d.apuracoes.length === 0 ? (
              <EstadoVazio titulo="Nenhuma apuração com CAC no mês" />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Apuração</TableHead>
                      <TableHead className="text-right">Valor na apuração</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.apuracoes.map((a) => (
                      <TableRow key={a.apuracao_id}>
                        <TableCell className="font-medium">{a.unidade}</TableCell>
                        <TableCell>
                          {a.status === "confirmado" ? (
                            <StatusBadge tom="sucesso">Fechada</StatusBadge>
                          ) : (
                            <StatusBadge tom="atencao">Em aberto</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(a.cac)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Secao>

          <Secao titulo="Linhas do pagamento">
            {d.linhas.length === 0 ? (
              <EstadoVazio titulo="Nenhuma linha neste mês" />
            ) : (
              <TabelaLinhas linhas={d.linhas} comPessoa />
            )}
          </Secao>
        </>
      )}
    </Pagina>
  );
}
