import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoSemAcesso,
  EstadoVazio,
  FOCO_VISIVEL,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { ErroDaConsulta } from "@/components/receita/moldura";
import { usePermissions } from "@/hooks/use-permissions";
import { UnidadeDialog, type UnidadeCadastro } from "@/components/unidades/unidade-dialog";
import { pendenciasDaUnidade, statusDaUnidade, tempoDeCasa } from "@/lib/unidades-cadastro";

// A lista das unidades da rede. Até 01/10/2026 era "Regras da Rede", uma
// tabela com a regra de repasse de cada unidade em 13 colunas e os sócios numa
// linha expandida. A regra, os sócios, os acessos e as chaves moram agora na
// ficha de cada uma (/unidades/$unidadeId); aqui fica só o que serve para achar
// a unidade e ver se o cadastro dela está completo.

type Unidade = UnidadeCadastro;

const fmtMesAno = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m] = iso.split("-");
  return `${m}/${a}`;
};

type FiltroStatus = "todas" | "ativas" | "futuras" | "internas";
const STATUS_VALIDOS: FiltroStatus[] = ["todas", "ativas", "futuras", "internas"];
const ROTULO_STATUS: Record<FiltroStatus, string> = {
  todas: "Todas",
  ativas: "Ativas",
  futuras: "Futuras",
  internas: "Internas",
};

export function RedeContent({
  novaAberta = false,
  aoMudarNovaAberta,
}: {
  /** "Nova unidade" mora no cabeçalho da página; o diálogo, aqui. */
  novaAberta?: boolean;
  aoMudarNovaAberta?: (v: boolean) => void;
}) {
  const { can, loading: loadingPerm } = usePermissions();
  const navigate = useNavigate();
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  // Sócios por unidade_id (preenchido nas 15 desde a migration 60).
  const [sociosPorUnidade, setSociosPorUnidade] = useState<Map<number, number>>(new Map());
  // unidade_id das que estão em ops.csc_unidades; null quando quem olha não lê a tabela.
  const [noCsc, setNoCsc] = useState<Set<number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [tentativa, setTentativa] = useState(0);
  const podeCadastrar = !loadingPerm && can("manage.unidades_rede");
  const podeVerCsc = !loadingPerm && can("view.csc_faturamento");

  // Busca e status na URL (N7). A busca digitada grava com uma pausa curta;
  // a URL só sobrescreve o campo quando muda por fora ("Limpar", link colado).
  const [q, setQUrl] = useFiltroNaUrl("q", "");
  const [statusBruto, setStatusUrl] = useFiltroNaUrl("status", "todas");
  const statusFilter: FiltroStatus = STATUS_VALIDOS.includes(statusBruto as FiltroStatus)
    ? (statusBruto as FiltroStatus)
    : "todas";
  const limparFiltros = useLimparFiltrosNaUrl(["q", "status"]);

  const [busca, setBusca] = useState(q);
  const gravada = useRef(q);
  useEffect(() => {
    if (q === gravada.current) return;
    gravada.current = q;
    setBusca(q);
  }, [q]);
  useEffect(() => {
    const v = busca.trim();
    if (v === gravada.current) return;
    const t = setTimeout(() => {
      gravada.current = v;
      setQUrl(v || undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [busca, setQUrl]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErro(null);
    (async () => {
      const [uRes, sRes, cRes] = await Promise.all([
        supabase
          .from("unidades")
          .select(
            "id,nome_da_praca,tipo,data_inauguracao,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,midia_mensal,midia_cac,paga_cac,cac_desde,absorve_midia,observacoes_financeiras,cnpj,razao_social,id_omie,id_asaas,pipefy_id,pipedrive_opcao_id",
          )
          .order("data_inauguracao", { ascending: true, nullsFirst: false }),
        // socios.unidade_id não está nos tipos gerados.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("socios").select("unidade_id"),
        // csc_unidades não está nos tipos gerados.
        podeVerCsc
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (supabase as any).from("csc_unidades").select("unidade_id")
          : Promise.resolve(null),
      ]);
      if (!mounted) return;
      // Sem as unidades não há tela; sem os sócios, só a contagem fica de fora.
      if (uRes.error) setErro(uRes.error);
      if (uRes.data) setUnidades(uRes.data as Unidade[]);
      const contagem = new Map<number, number>();
      for (const s of (sRes.data ?? []) as { unidade_id: number | null }[]) {
        if (s.unidade_id != null) contagem.set(s.unidade_id, (contagem.get(s.unidade_id) ?? 0) + 1);
      }
      setSociosPorUnidade(contagem);
      // Leitura do CSC que falhou não afirma "fora do faturamento": vira null, como sem permissão.
      setNoCsc(
        cRes && !cRes.error && cRes.data
          ? new Set(
              (cRes.data as { unidade_id: number | null }[])
                .map((c) => c.unidade_id)
                .filter((x): x is number => x != null),
            )
          : null,
      );
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [tentativa, podeVerCsc]);

  const pendenciasDe = (u: Unidade) => pendenciasDaUnidade(u, noCsc ? noCsc.has(u.id) : null);

  const enriched = useMemo(() => {
    const hoje = new Date();
    return unidades.map((u) => ({ ...u, status: statusDaUnidade(u, hoje) }));
  }, [unidades]);

  const ativas = enriched.filter((u) => u.status === "ativa");
  const futuras = enriched.filter((u) => u.status === "futura");
  const internas = enriched.filter((u) => u.status === "interna");
  const regionais = enriched.filter((u) => u.status !== "interna");
  const comPendencia = podeCadastrar
    ? enriched.filter((u) => pendenciasDe(u).length > 0).length
    : 0;

  const filteredRegionais = useMemo(() => {
    const term = q.trim().toLowerCase();
    return regionais.filter((u) => {
      if (statusFilter === "ativas" && u.status !== "ativa") return false;
      if (statusFilter === "futuras" && u.status !== "futura") return false;
      if (statusFilter === "internas") return false;
      if (term && !(u.nome_da_praca ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [regionais, q, statusFilter]);

  const filteredInternas = useMemo(() => {
    if (statusFilter !== "todas" && statusFilter !== "internas") return [];
    const term = q.trim().toLowerCase();
    return internas.filter((u) => !term || (u.nome_da_praca ?? "").toLowerCase().includes(term));
  }, [internas, q, statusFilter]);

  const temFiltro = q.trim() !== "" || statusFilter !== "todas";
  const alternarStatus = (s: FiltroStatus) => setStatusUrl(statusFilter === s ? undefined : s);
  const abrir = (id: number) =>
    navigate({ to: "/unidades/$unidadeId", params: { unidadeId: String(id) } });

  if (loadingPerm) {
    return <Carregando variante="pagina" className="mx-auto max-w-7xl px-4 py-6 md:px-6" />;
  }

  if (!can("view.clientes")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <EstadoSemAcesso oQueFalta="view.clientes" />
      </div>
    );
  }

  if (erro) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <ErroDaConsulta
          erro={erro}
          chaves="view.unidades_rede"
          titulo="Não foi possível carregar as unidades"
          tentarNovamente={() => setTentativa((n) => n + 1)}
        />
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6">
        {loading ? (
          <Carregando variante="kpis" />
        ) : (
          <KpiGrade>
            <KpiCard
              rotulo="Unidades ativas"
              valor={ativas.length}
              nota="Regionais já inauguradas"
              abrir={{ onClick: () => alternarStatus("ativas"), rotulo: "Filtrar" }}
            />
            <KpiCard
              rotulo="Unidades futuras"
              valor={futuras.length}
              nota="Inauguração pendente"
              abrir={{ onClick: () => alternarStatus("futuras"), rotulo: "Filtrar" }}
            />
            <KpiCard
              rotulo="Unidades internas"
              valor={internas.length}
              nota="Matriz e áreas"
              abrir={{ onClick: () => alternarStatus("internas"), rotulo: "Filtrar" }}
            />
            {podeCadastrar && (
              <KpiCard
                rotulo="Cadastro incompleto"
                valor={comPendencia}
                nota={`de ${enriched.length} unidades`}
              />
            )}
          </KpiGrade>
        )}

        <BarraFiltros aoLimpar={temFiltro ? limparFiltros : undefined}>
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Buscar unidade..."
              aria-label="Buscar unidade"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusUrl(v === "todas" ? undefined : v)}
          >
            <SelectTrigger className="w-[180px]" aria-label="Status da unidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_VALIDOS.map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusFilter !== "todas" && (
            <ChipFiltro
              rotulo="Status"
              valor={ROTULO_STATUS[statusFilter]}
              aoRemover={() => setStatusUrl(undefined)}
            />
          )}
          {q.trim() && (
            <ChipFiltro rotulo="Busca" valor={q.trim()} aoRemover={() => setQUrl(undefined)} />
          )}
        </BarraFiltros>

        {statusFilter !== "internas" && (
          <Secao
            titulo="Quais são as unidades regionais?"
            descricao={
              loading
                ? undefined
                : `${filteredRegionais.length} de ${regionais.length} regionais · clique na linha para abrir a ficha`
            }
          >
            {loading ? (
              <Carregando variante="tabela" />
            ) : filteredRegionais.length === 0 ? (
              <EstadoVazio titulo="Nenhuma unidade regional encontrada" total={regionais.length} />
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Inauguração</TableHead>
                      <TableHead>Tempo de casa</TableHead>
                      <TableHead className="text-right">Sócios</TableHead>
                      {podeCadastrar && <TableHead>Cadastro</TableHead>}
                      <TableHead className="w-8">
                        <span className="sr-only">Abrir</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRegionais.map((u) => (
                      <TableRow key={u.id} className="cursor-pointer" onClick={() => abrir(u.id)}>
                        <TableCell className="font-medium">
                          <Link
                            to="/unidades/$unidadeId"
                            params={{ unidadeId: String(u.id) }}
                            onClick={(e) => e.stopPropagation()}
                            className={`hover:underline ${FOCO_VISIVEL}`}
                          >
                            {u.nome_da_praca ?? "—"}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {u.status === "ativa" ? (
                            <StatusBadge tom="sucesso">Ativa</StatusBadge>
                          ) : (
                            <StatusBadge tom="info">Futura</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="num">{fmtMesAno(u.data_inauguracao)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {tempoDeCasa(u.data_inauguracao)}
                        </TableCell>
                        <TableCell className="num text-right">
                          {sociosPorUnidade.get(u.id) ?? 0}
                        </TableCell>
                        {podeCadastrar && (
                          <TableCell>
                            <SeloCadastro pendencias={pendenciasDe(u).length} />
                          </TableCell>
                        )}
                        <TableCell className="w-8 text-muted-foreground">
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Secao>
        )}

        {!loading && (statusFilter === "todas" || statusFilter === "internas") && (
          <Secao titulo="Quais unidades são internas?" descricao="Matriz e áreas.">
            {filteredInternas.length === 0 ? (
              <EstadoVazio titulo="Nenhuma unidade interna encontrada" total={internas.length} />
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {filteredInternas.map((u) => (
                  <Link
                    key={u.id}
                    to="/unidades/$unidadeId"
                    params={{ unidadeId: String(u.id) }}
                    className={`flex items-start justify-between gap-2 rounded-xl border bg-card p-3 hover:bg-muted/40 ${FOCO_VISIVEL}`}
                  >
                    <div>
                      <div className="font-medium">{u.nome_da_praca ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {sociosPorUnidade.get(u.id) ?? 0} no cadastro de sócios
                      </div>
                    </div>
                    {podeCadastrar ? (
                      <SeloCadastro pendencias={pendenciasDe(u).length} />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                  </Link>
                ))}
              </div>
            )}
          </Secao>
        )}
      </div>

      {podeCadastrar && (
        <UnidadeDialog
          aberto={novaAberta}
          aoMudarAberto={(v) => {
            if (!v) aoMudarNovaAberta?.(false);
          }}
          unidade={null}
          noFaturamentoDoCsc={noCsc == null ? null : false}
          podeEditarCsc={can("edit.csc_faturamento")}
          aoSalvar={() => setTentativa((n) => n + 1)}
        />
      )}
    </>
  );
}

function SeloCadastro({ pendencias }: { pendencias: number }) {
  return pendencias > 0 ? (
    <StatusBadge tom="atencao">
      {pendencias} {pendencias === 1 ? "pendência" : "pendências"}
    </StatusBadge>
  ) : (
    <StatusBadge tom="sucesso">Completo</StatusBadge>
  );
}
