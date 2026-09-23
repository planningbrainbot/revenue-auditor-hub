// Adaptador real do Cockpit do CEO: somente leitura, sobre a carga que o app já faz.
//
// Não existe consulta nova ao banco. A fonte é o `useMonetizacao()` (carregarMonetizacao +
// carregarContasBase), com as permissões e a RLS que já valem para Base de clientes e Monetização.
// O cockpit, portanto, não expõe a ninguém um dado que a pessoa já não pudesse ler nessas telas.
//
// Erro não se esconde atrás da carga anterior: se a última leitura falhou, o cockpit diz que a
// fonte está indisponível em vez de mostrar números antigos como se fossem atuais.
import type { BaseMonetizacao } from "../monetizacao/types";
import type { FonteCockpit } from "./indicadores.ts";

export function mensagemDeErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : typeof erro === "string" ? erro : "";
  if (/unauthorized|jwt|token/i.test(texto))
    return "A sessão não foi reconhecida pelo servidor. Entre novamente para carregar os números.";
  return texto || "A carga de Base e Monetização falhou por um motivo não identificado.";
}

export interface AcessoCockpit {
  /** view.aquario ou view.clientes: lê a carteira. */
  acessoBase: boolean;
  /** view.aquario ou view.monetizacao: lê os negócios (RLS de ops.monetizacao_deals). */
  acessoNegocios: boolean;
}

/** Pessoa com a área do cockpit mas sem nenhuma chave de Base ou Monetização: nem carrega. */
export function fonteSemAcesso(hoje: string, agora: string): FonteCockpit {
  return {
    sintetico: false,
    hoje,
    agora,
    acessoBase: false,
    acessoNegocios: false,
    monetizacao: { estado: "sem_acesso", erro: null, dados: null },
  };
}

export function fonteDoBrain(
  q: { data?: BaseMonetizacao; error?: unknown; isLoading: boolean },
  acesso: AcessoCockpit,
  hoje: string,
  agora: string,
): FonteCockpit {
  const comum = { sintetico: false, hoje, agora, ...acesso };
  if (q.error)
    return {
      ...comum,
      monetizacao: { estado: "erro", erro: mensagemDeErro(q.error), dados: null },
    };
  if (q.isLoading || !q.data)
    return { ...comum, monetizacao: { estado: "carregando", erro: null, dados: null } };
  return { ...comum, monetizacao: { estado: "ok", erro: null, dados: q.data } };
}
