import { StatusBadge, Procedencia } from "@/components/planning";
import type { TomStatus } from "@/components/planning";
import {
  consultoriaForaDeOferta,
  distratoForaDeOferta,
  ESTADOS_DISTRATO,
  propostasAbertas,
  reaisCurto,
  valorPropostas,
} from "@/lib/monetizacao/model";
import {
  dataBr,
  FONTE_CONSULTORIA,
  FONTE_TRATATIVAS,
  textoConsultoria,
  textoDistrato,
} from "@/lib/monetizacao/sinais";
import type { BaseMonetizacao, Conta } from "@/lib/monetizacao/types";
import { date, money } from "./common";

// Dois sinais externos na conta (DECISIONS 28/09/2026): o distrato pedido na Central de Tratativas
// do Pipefy e o vínculo com a plataforma da Consultoria. O selo diz o fato; o motivo da regra fica
// no título e na ficha, com a fonte e a data da carga. Textos em src/lib/monetizacao/sinais.ts.

const TOM_DISTRATO: Record<keyof typeof ESTADOS_DISTRATO, TomStatus> = {
  concluido: "perigo",
  tratativa: "atencao",
  revertido: "sucesso",
};

/** Selos da linha da tabela. Nada quando a conta não tem sinal. */
export function SelosSinais({ account: a }: { account: Conta }) {
  const d = a.base?.distrato;
  const c = a.base?.consultoria;
  const certas = propostasAbertas(a);
  const incertas = propostasAbertas(a, { incertas: true }).filter((p) => p.casamento === "nome");
  const contrato = c?.propostas.some((p) => p.casamento !== "nome" && p.categoria === "Contrato");
  if (!d && !c) return null;
  const titulo = (t: string, motivo?: string | null) => [t, motivo].filter(Boolean).join(" — ");
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {d && (
        <span title={titulo(textoDistrato(a), distratoForaDeOferta(a)?.reason)}>
          <StatusBadge tom={TOM_DISTRATO[d.estado]}>
            {ESTADOS_DISTRATO[d.estado]}
            {d.estado === "concluido" && d.data_churn ? ` · ${dataBr(d.data_churn)}` : ""}
          </StatusBadge>
        </span>
      )}
      {c?.cliente && (
        <span title={titulo(textoConsultoria(a), consultoriaForaDeOferta(a))}>
          <StatusBadge tom={c.cliente.ativo === false ? "neutro" : "info"}>
            {c.cliente.ativo === false ? "Ex-cliente da Consultoria" : "Cliente da Consultoria"}
            {c.cliente.casamento === "raiz" ? " · raiz do CNPJ" : ""}
            {c.cliente.valor_a_recuperar != null
              ? ` · ${reaisCurto(c.cliente.valor_a_recuperar)} a recuperar`
              : ""}
          </StatusBadge>
        </span>
      )}
      {!c?.cliente && contrato && (
        <span title={titulo(textoConsultoria(a), consultoriaForaDeOferta(a))}>
          <StatusBadge tom="info">Contrato da Consultoria</StatusBadge>
        </span>
      )}
      {certas.length > 0 && (
        <span title={titulo(textoConsultoria(a), consultoriaForaDeOferta(a))}>
          <StatusBadge tom="info">
            Proposta Consultoria
            {valorPropostas(certas).total ? ` · ${reaisCurto(valorPropostas(certas).total)}` : ""}
          </StatusBadge>
        </span>
      )}
      {incertas.length > 0 && (
        <span title="Proposta sem CNPJ na plataforma, casada só pelo nome da empresa. Confira antes de usar; não entra em regra nenhuma.">
          <StatusBadge tom="neutro">
            Proposta Consultoria? · pelo nome
            {valorPropostas(incertas).total
              ? ` · ${reaisCurto(valorPropostas(incertas).total)}`
              : ""}
          </StatusBadge>
        </span>
      )}
    </div>
  );
}

/** Procedência dos dois sinais, no pé da tabela da base (N3). */
export function ProcedenciaSinais({ data }: { data: BaseMonetizacao }) {
  return (
    <div className="mt-3 space-y-1">
      <Procedencia
        fonte={`Distrato: ${FONTE_TRATATIVAS} (pipe 307196408)`}
        atualizadoEm={data.sinais_at?.tratativas ?? null}
        regua="concluído sai da tabela e das ofertas; em tratativa fica fora do envio"
      />
      <Procedencia
        fonte={`Consultoria: ${FONTE_CONSULTORIA} (Pedro Siqueira)`}
        atualizadoEm={data.sinais_at?.consultoria ?? null}
        regua="CNPJ completo ou raiz; proposta sem CNPJ casa pelo nome e é incerta"
      />
    </div>
  );
}

/** Bloco da ficha da conta: o que cada fonte diz, com data. */
export function SinaisDetalhe({ account: a }: { account: Conta }) {
  const d = a.base?.distrato;
  const c = a.base?.consultoria;
  return (
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-lg border p-3">
        <strong>Distrato · Central de Tratativas</strong>
        {d ? (
          <>
            <p className="mt-1">
              <StatusBadge tom={TOM_DISTRATO[d.estado]}>{ESTADOS_DISTRATO[d.estado]}</StatusBadge>
            </p>
            <p className="mt-2">
              Fase: {d.fase || "não informada"}
              {d.data_churn ? ` · churn em ${dataBr(d.data_churn)}` : ""}
            </p>
            {d.categoria && <p className="mt-1">Categoria: {d.categoria}</p>}
            {d.cards > 1 && (
              <p className="mt-1">
                {d.cards} cards para esta conta; vale o mais recente pela ordem tratativa,
                concluído, retido.
              </p>
            )}
            <p className="mt-2 text-muted-foreground">
              {distratoForaDeOferta(a)?.reason ?? "Retido: nenhuma regra de oferta muda."}
            </p>
            <p className="mt-2">
              <a
                className="text-primary-text underline"
                href={`https://app.pipefy.com/open-cards/${d.card_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir o card no Pipefy
              </a>
            </p>
            <p className="mt-1 text-muted-foreground">
              Casado pelo{" "}
              {d.casamento === "pipefy" ? "cliente do card no Pipefy" : "negócio do Pipedrive"} ·
              lido em {date(d.sincronizado_em)}
            </p>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Nenhum card da Central de Tratativas casa com esta conta.
          </p>
        )}
      </div>
      <div className="rounded-lg border p-3">
        <strong>Consultoria · plataforma</strong>
        {c ? (
          <>
            {c.cliente ? (
              <div className="mt-1 space-y-1">
                <p>
                  <StatusBadge tom={c.cliente.ativo === false ? "neutro" : "info"}>
                    {c.cliente.ativo === false ? "Ex-cliente" : "Cliente"} da Consultoria
                  </StatusBadge>
                </p>
                <p>
                  {c.cliente.razao_social || "Razão social não informada"} · CNPJ {c.cliente.cnpj}
                  {c.cliente.casamento === "raiz" ? " (outro estabelecimento, mesma raiz)" : ""}
                </p>
                <p>
                  Na plataforma desde {date(c.cliente.cadastrado_em)}
                  {c.cliente.regime_tributario ? ` · ${c.cliente.regime_tributario}` : ""}
                  {c.cliente.parceiro ? ` · parceiro ${c.cliente.parceiro}` : ""}
                </p>
                <p>
                  Valor a recuperar:{" "}
                  {c.cliente.valor_a_recuperar != null
                    ? `${money(c.cliente.valor_a_recuperar)}${c.cliente.valor_a_recuperar_em ? ` em ${dataBr(c.cliente.valor_a_recuperar_em)}` : ""}`
                    : "a plataforma ainda não informa"}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">Não é cliente na plataforma.</p>
            )}
            {c.propostas.length > 0 && (
              <ul className="mt-2 space-y-2">
                {c.propostas.map((p) => (
                  <li key={p.id} className="rounded border p-2">
                    <p className="font-medium">
                      {p.categoria || "Proposta"}
                      {p.valor_total != null ? ` · ${money(p.valor_total)}` : " · sem valor"}
                      {p.percentual_exito != null ? ` · êxito ${p.percentual_exito}%` : ""}
                    </p>
                    <p>{p.produto || p.linha_produto || "Produto não informado"}</p>
                    <p className="text-muted-foreground">
                      Enviada em {dataBr(p.data_envio) || "data não informada"}
                      {p.data_ultimo_fup ? ` · último FUP ${dataBr(p.data_ultimo_fup)}` : ""}
                      {p.responsavel ? ` · ${p.responsavel}` : ""}
                    </p>
                    <p
                      className={p.casamento === "nome" ? "text-warning" : "text-muted-foreground"}
                    >
                      {p.casamento === "nome"
                        ? "Casada só pelo nome: incerta, não entra em regra."
                        : p.casamento === "raiz"
                          ? "Casada pela raiz do CNPJ."
                          : "Casada pelo CNPJ."}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-muted-foreground">
              {consultoriaForaDeOferta(a) ?? "Nenhuma regra de oferta muda por este vínculo."}
            </p>
            <p className="mt-1 text-muted-foreground">Lido em {date(c.sincronizado_em)}</p>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Sem cliente nem proposta da Consultoria casados com esta conta.
          </p>
        )}
      </div>
    </div>
  );
}
