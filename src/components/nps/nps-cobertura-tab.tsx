import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useNpsCoverage } from "@/hooks/use-nps";

const NUM = new Intl.NumberFormat("pt-BR");
const FONTE = "empresas, contatos e nps_pesquisas (Pipefy)";

function tomCobertura(pct: number): TomStatus {
  return pct >= 70 ? "sucesso" : pct >= 30 ? "atencao" : "perigo";
}

// Extraído de nps-painel-tab.tsx (era a aba "Cobertura da base" do Painel) —
// mudou de casa pra Base de Contatos porque é sobre completude de contato
// de WhatsApp, não sobre resultado de pesquisa.
//
// Universos (N11): "Clientes ativos" e a tabela por unidade contam só ativos;
// os totais de "Já receberam" e "Com WhatsApp válido" que o servidor devolve
// contam TODAS as empresas. Cada rótulo diz o seu, e a subtração entre os dois
// só aparece quando fecha.
export function NpsCoberturaTab() {
  const { data: coverage, isLoading, error, refetch, dataUpdatedAt } = useNpsCoverage();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Carregando variante="kpis" />
        <Carregando variante="tabela" />
      </div>
    );
  }
  if (error || !coverage) {
    return (
      <EstadoErro
        titulo="Não foi possível carregar a cobertura"
        detalhe={`Fonte: ${FONTE}: ${error instanceof Error ? error.message : String(error ?? "sem resposta")}`}
        tentarNovamente={() => void refetch()}
      />
    );
  }

  const semContato = coverage.totalEmpresas - coverage.totalComWhatsapp;
  const pctVinculo =
    coverage.pesquisasTotal > 0
      ? Math.round((coverage.pesquisasComEmpresaResolvida / coverage.pesquisasTotal) * 100)
      : null;

  return (
    <div className="space-y-6">
      <Secao
        titulo="Quanto da base está pronta para o disparo?"
        descricao="Os cartões misturam dois universos: cada rótulo diz se conta só clientes ativos ou todas as empresas cadastradas."
      >
        <KpiGrade colunas={4}>
          <KpiCard rotulo="Clientes ativos" valor={NUM.format(coverage.totalEmpresas)} nota="empresas ativas" />
          <KpiCard
            rotulo="Já receberam a pesquisa (todas as empresas)"
            valor={NUM.format(coverage.totalJaDisparadas)}
            nota={
              pctVinculo === null
                ? "empresas distintas · inclui inativas"
                : `empresas distintas · inclui inativas · só ${NUM.format(coverage.pesquisasComEmpresaResolvida)} de ${NUM.format(coverage.pesquisasTotal)} pesquisas (${pctVinculo}%) têm empresa vinculada`
            }
          />
          <KpiCard
            rotulo="Com WhatsApp válido (todas as empresas)"
            valor={NUM.format(coverage.totalComWhatsapp)}
            nota="empresas com contato de 10+ dígitos · inclui inativas"
          />
          {semContato >= 0 ? (
            <KpiCard
              rotulo="Sem contato (clientes ativos)"
              valor={NUM.format(semContato)}
              nota="clientes ativos − com WhatsApp válido · não disparará"
            />
          ) : (
            <KpiCard
              rotulo="Sem contato (clientes ativos)"
              valor="—"
              estado="nao-apurado"
              nota={`Os universos não fecham: ${NUM.format(coverage.totalComWhatsapp)} com WhatsApp contam todas as empresas, ${NUM.format(coverage.totalEmpresas)} ativos contam só as ativas. A tabela por unidade traz o número dos ativos.`}
            />
          )}
        </KpiGrade>
        <p className="text-[13px] text-muted-foreground">
          "Já receberam" conta só pesquisas com empresa vinculada: o número real de empresas já pesquisadas é
          maior. "Clientes ativos" usa a mesma régua de Clientes: cliente da rede, unidade regional ativa e sem card
          de churn em Tratativas, por isso pode ser menor que a contagem bruta de empresas por unidade.
        </p>
      </Secao>

      <Secao
        titulo="Quais unidades estão prontas para o disparo?"
        descricao="Só clientes ativos · ordenado pela cobertura"
      >
        {coverage.rows.length === 0 ? (
          <EstadoVazio titulo="Sem dados de cobertura" descricao="Nenhum cliente ativo nas unidades regionais." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="num text-right">Clientes ativos</TableHead>
                  <TableHead className="num text-right">Já receberam</TableHead>
                  <TableHead className="num text-right">— Base Antiga</TableHead>
                  <TableHead className="num text-right">— Base Nova</TableHead>
                  <TableHead className="num text-right">Com WhatsApp</TableHead>
                  <TableHead className="num text-right">Sem contato</TableHead>
                  <TableHead className="text-right">Cobertura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.rows.map((u) => {
                  const pct = u.empresas > 0 ? Math.round((u.comWhatsapp / u.empresas) * 100) : null;
                  return (
                    <TableRow key={u.unidade}>
                      <TableCell className="font-medium">{u.unidade}</TableCell>
                      <TableCell className="num text-right">{NUM.format(u.empresas)}</TableCell>
                      <TableCell className="num text-right">{NUM.format(u.jaDisparadas)}</TableCell>
                      <TableCell className="num text-right text-muted-foreground">
                        {NUM.format(u.jaDisparadasBaseAntiga)}
                      </TableCell>
                      <TableCell className="num text-right text-muted-foreground">
                        {NUM.format(u.jaDisparadasBaseNova)}
                      </TableCell>
                      <TableCell className="num text-right">{NUM.format(u.comWhatsapp)}</TableCell>
                      <TableCell className="num text-right">{NUM.format(u.empresas - u.comWhatsapp)}</TableCell>
                      <TableCell className="text-right">
                        {pct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <StatusBadge tom={tomCobertura(pct)} className="num">
                            {pct}%
                          </StatusBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <Procedencia
          fonte={FONTE}
          atualizadoEm={dataUpdatedAt > 0 ? new Date(dataUpdatedAt) : null}
          regua="cobertura = com WhatsApp ÷ clientes ativos · ok a partir de 70%, atenção de 30% a 69%"
        />
      </Secao>
    </div>
  );
}
