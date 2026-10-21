import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  PageHeader,
  StatusBadge,
} from "@/components/planning";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import { usePermissions } from "@/hooks/use-permissions";
import { tipoDoErro } from "@/lib/faturamento/erros";
import { podePedir, rotuloSituacao, tomSituacao } from "@/lib/faturamento/rotulos";
import type { Contexto } from "@/lib/faturamento/tipos";

/**
 * Moldura comum das telas do Portal de Faturamento (contrato `docs/design/contratos/faturamento.md` §1):
 * o portão de acesso por área, o selo da situação (um rótulo, um tom), a procedência da página, o botão
 * "Novo pedido" e os estados de erro. As cinco telas da E1 usam daqui, para não repetirem cada uma o seu.
 */

export const AREA_FATURAMENTO = "faturamento";
export const AREA_TESOURARIA = "faturamento_tesouraria";
export const AREA_CONTROLADORIA = "faturamento_controladoria";

/** Contêiner de página da área. */
export function PaginaFaturamento({ children }: { children: ReactNode }) {
  return <div className="space-y-6 p-4 md:p-6">{children}</div>;
}

/**
 * Portão da área (N8). O layout já barra os caminhos exatos do menu; as páginas com parâmetro
 * (`/faturamento/pedido/$id`) e o formulário, que não são item, conferem aqui. Quem decide o dado continua
 * sendo a RPC: isto só evita a consulta e diz o que falta.
 */
export function PortaoFaturamento({
  area = AREA_FATURAMENTO,
  oQueFalta = "Faturamento",
  titulo,
  pergunta,
  carregando = "pagina",
  children,
}: {
  area?: string;
  oQueFalta?: string;
  titulo: string;
  pergunta?: string;
  carregando?: "kpis" | "tabela" | "pagina";
  children: ReactNode;
}) {
  const { temArea, loading } = usePermissions();
  if (loading)
    return (
      <PaginaFaturamento>
        <Carregando variante={carregando} />
      </PaginaFaturamento>
    );
  if (!temArea(area))
    return (
      <PaginaFaturamento>
        <PageHeader area={AREA_FATURAMENTO} titulo={titulo} pergunta={pergunta} />
        <EstadoSemAcesso oQueFalta={oQueFalta} />
      </PaginaFaturamento>
    );
  return <>{children}</>;
}

/** A situação do pedido com ícone e palavra (V7), no tom da tabela do contrato (§1.2). */
export function SeloSituacao({ situacao }: { situacao: string }) {
  return <StatusBadge tom={tomSituacao(situacao)}>{rotuloSituacao(situacao)}</StatusBadge>;
}

/**
 * "Novo pedido", a ação principal (`default`) do cabeçalho de Meu faturamento e de Pedidos. Para quem não
 * pede em nenhuma empresa (tesouraria, controladoria), desabilitado com o motivo (N8).
 */
export function BotaoNovoPedido({
  contexto,
  emissora,
}: {
  contexto: Contexto | undefined;
  emissora?: string;
}) {
  if (!contexto) return null;
  if (!podePedir(contexto))
    return (
      <BotaoComMotivo
        rotulo="Novo pedido"
        motivo="Quem pede faturamento é dono, gestor ou solicitante de uma empresa."
        icone={<Plus className="size-4" aria-hidden />}
        size="sm"
      />
    );
  // Leva a empresa quando o filtro tem uma só e a pessoa pode pedir por ela.
  const umaSo =
    emissora && !emissora.includes(",")
      ? contexto.emissoras.find((e) => e.apelido === emissora && e.pode_pedir)?.apelido
      : undefined;
  return (
    <Button asChild size="sm">
      <Link to="/faturamento/novo" search={umaSo ? { emissora: umaSo } : {}}>
        <Plus className="size-4" aria-hidden />
        Novo pedido
      </Link>
    </Button>
  );
}

/**
 * O erro de uma consulta da área, no estado certo: sem acesso não é erro (N4, N8), e "a função ainda não
 * existe" diz isso em vez de parecer defeito.
 */
export function ErroDaArea({
  erro,
  oQueFalta = "Faturamento",
  tentarNovamente,
}: {
  erro: unknown;
  oQueFalta?: string;
  tentarNovamente?: () => void;
}) {
  const tipo = tipoDoErro(erro);
  const mensagem = erro instanceof Error ? erro.message : "Erro desconhecido.";
  if (tipo === "sem_acesso") return <EstadoSemAcesso oQueFalta={oQueFalta} />;
  return (
    <EstadoErro
      titulo={
        tipo === "indisponivel"
          ? "O Portal de Faturamento está fora do ar agora"
          : "Não foi possível carregar o Portal de Faturamento"
      }
      detalhe={mensagem}
      tentarNovamente={tipo === "indisponivel" ? undefined : tentarNovamente}
    />
  );
}
