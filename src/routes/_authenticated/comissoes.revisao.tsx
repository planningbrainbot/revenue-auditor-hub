import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SITUACAO,
  type Linha,
  type Revisao,
} from "@/lib/comissoes/tipos";

// Revisão do mês (contrato docs/design/contratos/comissoes.md §2): a prévia que a rotina montou a partir das
// apurações fechadas, as pendências e as ações do líder até o dia 10. Toda mudança pede motivo e fica em
// comissoes.eventos; o banco recusa o que estiver fora do prazo.

const MES = /^\d{4}-\d{2}$/;

export const Route = createFileRoute("/_authenticated/comissoes/revisao")({
  validateSearch: (s: Record<string, unknown>): { mes?: string } =>
    typeof s.mes === "string" && MES.test(s.mes) ? { mes: s.mes } : {},
  head: () => ({ meta: [{ title: "Revisão das comissões · Planning Brain" }] }),
  component: RevisaoDoMes,
});

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

function AcaoLinha({ l, editavel }: { l: Linha; editavel: boolean }) {
  const [aberto, setAberto] = useState<"ajustar" | "excluir" | null>(null);
  const [base, setBase] = useState(String(l.base ?? ""));
  const [percentual, setPercentual] = useState(String(l.percentual ?? ""));
  const [motivo, setMotivo] = useState("");
  const ajustar = useAcao(
    () => comissoes.ajustar(l.id, Number(base), Number(percentual), motivo),
    "Ajuste gravado.",
  );
  const excluir = useAcao(
    () => (l.excluida ? comissoes.restaurar(l.id, motivo) : comissoes.excluir(l.id, motivo)),
    l.excluida ? "Linha restaurada." : "Linha excluída.",
  );
  if (l.tipo === "ajuste") return null;
  if (!aberto)
    return (
      <span className="flex gap-1">
        {l.tipo === "comissao" && !l.excluida ? (
          <Button size="sm" variant="ghost" onClick={() => setAberto("ajustar")}>
            Ajustar
          </Button>
        ) : null}
        {editavel ? (
          <Button size="sm" variant="ghost" onClick={() => setAberto("excluir")}>
            {l.excluida ? "Restaurar" : "Excluir"}
          </Button>
        ) : null}
      </span>
    );
  const acao = aberto === "ajustar" ? ajustar : excluir;
  return (
    <span className="grid min-w-[240px] gap-2">
      {aberto === "ajustar" ? (
        <span className="grid grid-cols-2 gap-2">
          <Input
            aria-label="Base"
            inputMode="decimal"
            value={base}
            onChange={(e) => setBase(e.target.value.replace(",", "."))}
          />
          <Input
            aria-label="Percentual"
            inputMode="decimal"
            value={percentual}
            onChange={(e) => setPercentual(e.target.value.replace(",", "."))}
          />
        </span>
      ) : null}
      <Input
        aria-label="Motivo da mudança"
        placeholder="Motivo"
        maxLength={500}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      {aberto === "ajustar" && !editavel ? (
        <span className="text-[12px] text-muted-foreground">
          O mês já fechou para mudanças: o ajuste entra no próximo pagamento.
        </span>
      ) : null}
      <span className="flex gap-1">
        <Button
          size="sm"
          disabled={motivo.trim().length < 3 || acao.isPending}
          onClick={() => acao.mutate(undefined, { onSuccess: () => setAberto(null) })}
        >
          Confirmar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAberto(null)}>
          Cancelar
        </Button>
      </span>
    </span>
  );
}

function LancarBonus({ mes, pessoas }: { mes: string; pessoas: Revisao["todas_pessoas"] }) {
  const [pessoa, setPessoa] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  // Mesma chave enquanto o formulário não muda: clique repetido lança um bônus só.
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const acao = useAcao(
    () => comissoes.lancarBonus(Number(pessoa), mes, Number(valor), motivo, chave),
    "Bônus lançado.",
  );
  return (
    <Secao
      titulo="Lançar bônus"
      descricao="Meta, ROAS, melhor conversão: não depende da apuração e sai no mesmo pagamento."
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_2fr_auto] sm:items-end">
        <select
          aria-label="Pessoa"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={pessoa}
          onChange={(e) => setPessoa(e.target.value)}
        >
          <option value="">Pessoa</option>
          {pessoas.map((p) => (
            <option key={p.pessoa_id} value={p.pessoa_id}>
              {p.nome}
            </option>
          ))}
        </select>
        <Input
          aria-label="Valor"
          placeholder="Valor"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(",", "."))}
        />
        <Input
          aria-label="Motivo do bônus"
          placeholder="Motivo"
          maxLength={500}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={!pessoa || !Number(valor) || motivo.trim().length < 3 || acao.isPending}
          onClick={() =>
            acao.mutate(undefined, {
              onSuccess: () => {
                setValor("");
                setMotivo("");
                setChave(crypto.randomUUID());
              },
            })
          }
        >
          Lançar
        </Button>
      </div>
    </Secao>
  );
}

function RevisaoDoMes() {
  const perms = usePermissions();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const mes = busca.mes ?? mesPadrao(hojeSP());
  const lider = perms.can("manage.comissoes_revisao");
  const financeiro = perms.can("manage.comissoes_fechamento");
  const q = useQuery({
    queryKey: [...CHAVE_COMISSOES, "revisao", mes],
    queryFn: () => comissoes.revisao(mes),
    enabled: !perms.loading && (lider || financeiro),
    retry: false,
  });
  const liberar = useAcao(() => comissoes.liberar(mes), "Pagamento liberado para o time.");

  const titulo = "Revisão do mês";
  const pergunta = `O pagamento de ${mesExtenso(`${mes}-01`)} está pronto para liberar?`;
  const descricao =
    "Linhas que a rotina montou a partir das apurações fechadas até o dia 5 · os líderes revisam até o dia 10 (ou o dia útil anterior) · contagem: metade de comissão, ajuste ou bônus.";
  if (perms.loading)
    return (
      <Pagina titulo={titulo} pergunta={pergunta}>
        <Carregando variante="pagina" />
      </Pagina>
    );
  if (!lider && !financeiro)
    return (
      <Pagina titulo={titulo} pergunta={pergunta}>
        <EstadoSemAcesso oQueFalta="manage.comissoes_revisao (área Comissões: revisão, concedida pela administração)" />
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
      {lider && d?.situacao === "previa" ? (
        <Confirmar
          rotulo="Liberar para o time"
          titulo={`Liberar o pagamento de ${mesExtenso(`${mes}-01`)}?`}
          texto={`Total de ${brl(d.total)} para ${d.pessoas.length} pessoa(s). Depois de liberar, o time vê os valores e qualquer correção vira ajuste no pagamento seguinte.`}
          confirmar="Liberar"
          aoConfirmar={() => liberar.mutate(undefined)}
          desabilitado={liberar.isPending}
        />
      ) : null}
    </div>
  );

  return (
    <Pagina titulo={titulo} pergunta={pergunta} descricao={descricao} acoes={acoes}>
      {q.isLoading ? (
        <Carregando variante="pagina" />
      ) : q.isError || !d ? (
        <EstadoErro
          titulo="A revisão não carregou"
          detalhe={`Fonte: ops.comissoes_revisao. ${(q.error as Error | null)?.message ?? ""}`}
          tentarNovamente={() => q.refetch()}
        />
      ) : (
        <>
          <KpiGrade colunas={3}>
            <KpiCard
              rotulo="Total do mês"
              valor={brl(d.total)}
              nota={`Pagamento pelo iFood em ${dia(d.pagamento_em)}; envio ao DP até ${dia(d.envio_dp_em)}.`}
            />
            <KpiCard
              rotulo="Situação"
              valor={SITUACAO[d.situacao].texto}
              nota={
                d.situacao === "previa"
                  ? d.editavel
                    ? `Prazo para revisar: ${dia(d.prazo)}.`
                    : "Fechado para mudanças: o prazo passou."
                  : d.liberado_em
                    ? `Liberado em ${dia(d.liberado_em)}.`
                    : undefined
              }
            />
            <KpiCard
              rotulo={`Apurações de ${mesCurto(mesAnterior(mes))}`}
              valor={`${d.apuracoes.filter((a) => a.status === "confirmado").length} de ${d.apuracoes.length}`}
              nota="fechadas. A que fechar depois da liberação vai para o mês seguinte."
            />
          </KpiGrade>

          <BlocosPendencias
            pend={d.pendencias}
            lider={lider}
            financeiro={financeiro}
            editavel={lider && d.editavel}
          />

          {lider && d.editavel ? <LancarBonus mes={mes} pessoas={d.todas_pessoas} /> : null}

          <Secao titulo="Por pessoa">
            {d.pessoas.length === 0 ? (
              <EstadoVazio titulo="Ninguém neste pagamento ainda" />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.pessoas.map((p) => (
                  <li
                    key={p.pessoa_id}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="truncate">
                      {p.nome}
                      {p.vinculado ? null : (
                        <StatusBadge tom="atencao" className="ml-2">
                          sem login
                        </StatusBadge>
                      )}
                    </span>
                    <span className="font-semibold tabular-nums">{brl(p.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Linhas do pagamento">
            {d.linhas.length === 0 ? (
              <EstadoVazio
                titulo="Nenhuma linha neste mês ainda"
                descricao="As linhas nascem quando a apuração de uma unidade fecha com um cliente do Inside Sales."
              />
            ) : (
              <TabelaLinhas
                linhas={d.linhas}
                comPessoa
                acao={lider ? (l) => <AcaoLinha l={l} editavel={d.editavel} /> : undefined}
              />
            )}
          </Secao>
        </>
      )}
    </Pagina>
  );
}
