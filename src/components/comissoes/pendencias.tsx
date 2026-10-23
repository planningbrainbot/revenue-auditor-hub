// Pendências da revisão: o que a rotina da prévia não decide sozinha (PRD, R-01, R-06, R-07, R-09, P-06).
// Cada bloco só aparece quando tem item; quem age é o líder, menos as datas, que são do financeiro (P-03).
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHAVE_COMISSOES, comissoes } from "@/lib/comissoes/api";
import { mesCurto, type Pendencias } from "@/lib/comissoes/tipos";
import { brl, dia, useAcao } from "./comum";

function Bloco({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden className="size-4 text-warning" />
        {titulo}
      </h3>
      <p className="text-sm text-muted-foreground">{texto}</p>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Item({
  titulo,
  detalhe,
  children,
}: {
  titulo: string;
  detalhe: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
      <span className="grid">
        <b className="font-medium">{titulo}</b>
        <span className="text-[13px] text-muted-foreground">{detalhe}</span>
      </span>
      {children ? <span className="flex flex-wrap items-center gap-2">{children}</span> : null}
    </li>
  );
}

function RegistrarData({
  contrato,
  tipo,
}: {
  contrato: number;
  tipo: "assinatura" | "pagamento_cliente";
}) {
  const [valor, setValor] = useState("");
  const acao = useAcao(
    (d: string) => comissoes.registrarData(contrato, tipo, d),
    "Data registrada.",
  );
  return (
    <>
      <Input
        type="date"
        aria-label="Data"
        className="h-8 w-[160px]"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!valor || acao.isPending}
        onClick={() => acao.mutate(valor)}
      >
        Registrar
      </Button>
    </>
  );
}

function IncluirMetade({ contrato }: { contrato: number }) {
  const [motivo, setMotivo] = useState("");
  const acao = useAcao(
    (m: 1 | 2) => comissoes.incluirMetade(contrato, m, motivo),
    "Metade incluída.",
  );
  const ok = motivo.trim().length >= 3 && !acao.isPending;
  return (
    <>
      <Input
        aria-label="Motivo"
        placeholder="Motivo"
        className="h-8 w-[200px]"
        maxLength={500}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      <Button size="sm" variant="outline" disabled={!ok} onClick={() => acao.mutate(1)}>
        Incluir 1ª
      </Button>
      <Button size="sm" variant="outline" disabled={!ok} onClick={() => acao.mutate(2)}>
        Incluir 2ª
      </Button>
    </>
  );
}

function Vincular({ pessoa }: { pessoa: number }) {
  const [escolhido, setEscolhido] = useState("");
  const q = useQuery({
    queryKey: [...CHAVE_COMISSOES, "candidatos"],
    queryFn: comissoes.candidatos,
    retry: false,
  });
  const acao = useAcao((u: string) => comissoes.vincular(pessoa, u), "Vínculo gravado.");
  const livres = (q.data ?? []).filter((c) => !c.pessoa);
  return (
    <>
      <select
        aria-label="Login"
        className="h-8 max-w-[260px] rounded-md border border-input bg-background px-2 text-[13px]"
        value={escolhido}
        onChange={(e) => setEscolhido(e.target.value)}
      >
        <option value="">
          {livres.length ? "Escolher login" : "Ninguém com a área Comissões sem vínculo"}
        </option>
        {livres.map((c) => (
          <option key={c.id} value={c.id}>
            {c.email}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!escolhido || acao.isPending}
        onClick={() => acao.mutate(escolhido)}
      >
        Vincular
      </Button>
    </>
  );
}

function EscolherParcela({ item }: { item: number }) {
  const acao = useAcao((p: 1 | 2 | 3) => comissoes.escolherParcela(item, p), "Parcela definida.");
  return (
    <>
      {([1, 2, 3] as const).map((n) => (
        <Button
          key={n}
          size="sm"
          variant="outline"
          disabled={acao.isPending}
          onClick={() => acao.mutate(n)}
        >
          {n === 3 ? "As duas" : `${n}ª`}
        </Button>
      ))}
    </>
  );
}

export function BlocosPendencias({
  pend,
  lider,
  financeiro,
  editavel,
}: {
  pend: Pendencias;
  lider: boolean;
  financeiro: boolean;
  editavel: boolean;
}) {
  return (
    <div className="space-y-3">
      {pend.sem_parcela.length ? (
        <Bloco
          titulo="Parcela não definida na apuração"
          texto="O item entrou na apuração sem dizer se é 1ª ou 2ª parcela. Escolha qual metade ele libera."
        >
          {pend.sem_parcela.map((p) => (
            <Item
              key={p.item_id}
              titulo={p.cliente}
              detalhe={`${p.unidade} · apuração de ${mesCurto(p.mes_referencia)} · ${brl(p.cac)}`}
            >
              {lider ? <EscolherParcela item={p.item_id} /> : null}
            </Item>
          ))}
        </Bloco>
      ) : null}
      {pend.aguardando_data.length ? (
        <Bloco
          titulo="Aguardando data"
          texto="Onde não há CAC, a comissão sai quando o cliente paga o 1º honorário. Em Recife, a 1ª metade conta pela assinatura. Quem registra a data é o financeiro."
        >
          {pend.aguardando_data.map((p) => (
            <Item
              key={p.contrato_id}
              titulo={p.cliente}
              detalhe={`${p.unidade} · ganho em ${dia(p.ganho_em)} · ${p.tipo === "assinatura" ? "data da assinatura" : "data do pagamento do cliente"}`}
            >
              {financeiro ? <RegistrarData contrato={p.contrato_id} tipo={p.tipo} /> : null}
            </Item>
          ))}
        </Bloco>
      ) : null}
      {pend.regra_antiga.length ? (
        <Bloco
          titulo="Venda da regra antiga na apuração"
          texto="Contrato ganho antes de 01/10/2026: a comissão foi paga pela planilha. Inclua só se ela ainda não foi paga."
        >
          {pend.regra_antiga.map((p) => (
            <Item
              key={p.item_id}
              titulo={p.cliente}
              detalhe={`${p.unidade} · ganho em ${dia(p.ganho_em)} · ${p.parcela ? `${p.parcela}ª parcela` : "sem parcela"}`}
            >
              {lider && editavel ? <IncluirMetade contrato={p.contrato_id} /> : null}
            </Item>
          ))}
        </Bloco>
      ) : null}
      {pend.sem_closer.length ? (
        <Bloco
          titulo="Contrato sem closer ou sem SDR"
          texto="Corrija no Pipedrive; a metade de quem falta nasce na próxima atualização."
        >
          {pend.sem_closer.map((p) => (
            <Item
              key={p.contrato_id}
              titulo={p.cliente}
              detalhe={`${p.unidade} · falta ${p.falta}`}
            />
          ))}
        </Bloco>
      ) : null}
      {pend.pipe_a_confirmar.length ? (
        <Bloco
          titulo="Contrato sem pipe no Pipedrive"
          texto="Está na apuração, mas o contrato não diz de que pipe veio. Se for do Inside Sales, corrija no Pipedrive."
        >
          {pend.pipe_a_confirmar.map((p) => (
            <Item key={p.contrato_id} titulo={p.cliente} detalhe={p.unidade} />
          ))}
        </Bloco>
      ) : null}
      {pend.pessoa_trocada.length ? (
        <Bloco
          titulo="Closer ou SDR trocado depois da 1ª metade"
          texto="A 2ª metade segue quem recebeu a 1ª. Se a troca deve valer, ajuste ou exclua a linha."
        >
          {pend.pessoa_trocada.map((p) => (
            <Item
              key={`${p.contrato_id}-${p.papel}`}
              titulo={p.cliente}
              detalhe={`${p.papel === "closer" ? "Closer" : "SDR"}: ${p.na_linha} na comissão, ${p.no_pipedrive ?? "vazio"} no Pipedrive`}
            />
          ))}
        </Bloco>
      ) : null}
      {pend.sem_vinculo.length && lider ? (
        <Bloco
          titulo="Pessoas sem login"
          texto="Nome como vem do Pipedrive. Sem o vínculo, a pessoa não vê as próprias comissões."
        >
          {pend.sem_vinculo.map((p) => (
            <Item key={p.pessoa_id} titulo={p.nome} detalhe="sem login ligado">
              <Vincular pessoa={p.pessoa_id} />
            </Item>
          ))}
        </Bloco>
      ) : null}
    </div>
  );
}
