import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { ResumoClientes } from "@/lib/cockpit-ceo/clientes-ativos";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import { EstadoBadge } from "./estado";

// Quantos clientes temos: as definições candidatas lado a lado, sem escolher uma. Cada linha é uma
// régua que já existe na casa; a sobreposição mostra o quanto elas contam as mesmas empresas.

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1).replace(".", ",")}%`);

export function ClientesAtivos({
  clientes,
  aviso,
}: {
  clientes: ResumoClientes | null;
  aviso: string | null;
}) {
  const titulo = (id: string) => clientes?.definicoes.find((d) => d.id === id)?.titulo ?? id;
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Clientes ativos por definição">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">Clientes ativos: definições candidatas</h3>
        <p className="text-xs text-muted-foreground">
          Cada linha conta CNPJs distintos por uma régua que já existe na casa. Elas não se somam, e
          a escolha de qual vale para cada contexto ainda não foi feita. Vale para a rede inteira: o
          filtro de unidade e o de período não se aplicam aqui.
        </p>
      </header>
      {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
      {clientes && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 font-medium">Definição</th>
                  <th className="py-1.5 text-right font-medium">CNPJs</th>
                  <th className="py-1.5 text-right font-medium">Contas na Base</th>
                  <th className="py-1.5 text-right font-medium">Sem conta</th>
                  {PRODUTOS.map((p) => (
                    <th key={p} className="py-1.5 text-right font-medium">
                      {NOMES[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientes.definicoes.map((d) => (
                  <tr key={d.id} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{d.titulo}</span>
                        {d.estado !== "disponivel" && <EstadoBadge estado={d.estado} />}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{d.definicao}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Fonte: {d.fonte}
                        {d.foraDoFormato
                          ? ` · ${d.foraDoFormato} documento(s) que não são CNPJ fora`
                          : ""}
                        {d.nota ? ` · ${d.nota}` : ""}
                      </p>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatarNumero(d.cnpjs, "contas")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatarNumero(d.contasBase, "contas")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatarNumero(d.semContaBase, "contas")}
                    </td>
                    {PRODUTOS.map((p) => {
                      const x = d.penetracao?.find((y) => y.produto === p);
                      return (
                        <td
                          key={p}
                          className="py-1.5 text-right tabular-nums"
                          title={x ? `${x.contas} de ${d.contasBase} contas` : undefined}
                        >
                          {x ? pct(x.parcela) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1 text-xs">
              <p className="font-medium">Sobreposição (CNPJs nas duas definições)</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {clientes.sobreposicao.map((s) => (
                  <li key={s.a + s.b}>
                    {titulo(s.a)} × {titulo(s.b)}:{" "}
                    <strong className="tabular-nums text-foreground">
                      {formatarNumero(s.ambos, "contas")}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1 text-xs md:text-right">
              <p>
                Em pelo menos uma:{" "}
                <strong className="tabular-nums">{formatarNumero(clientes.uniao, "contas")}</strong>
              </p>
              <p>
                Em todas:{" "}
                <strong className="tabular-nums">
                  {formatarNumero(clientes.emTodas, "contas")}
                </strong>
              </p>
              <p className="text-[11px] text-muted-foreground">CNPJs distintos</p>
            </div>
          </div>
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
            {clientes.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
