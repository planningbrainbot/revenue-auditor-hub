// Ligação do adaptador Jev ao piloto: qual chave, qual ledger, quais exemplos.
//
// Só funciona com COCKPIT_JEV_PILOTO=1 e fora de produção. Aceita apenas os exemplos fictícios
// fixos de contrato.ts: nenhum texto livre, nenhum dado do banco.
import { fileURLToPath } from "node:url";
import { criarLedgerArquivo, decidirJev, obterChaveKeychain } from "./adaptador.server.ts";
import type { FalhaJev, ResultadoJev } from "./adaptador.server.ts";
import {
  payloadRoteamento,
  payloadTesteEmail,
  pilotoJevAtivo,
  resumirOrcamento,
} from "./contrato.ts";
import type { IdPerguntaCeo, RegistroChamada, ResumoOrcamento } from "./contrato.ts";

// Caminho fixo, relativo a este arquivo: rodar o script de outro diretório (ou com outra variável
// de ambiente) não pode abrir um ledger novo e, com ele, outras 10 chamadas.
export const caminhoLedger = () =>
  fileURLToPath(
    new URL("../../../../docs/dev_notes/cockpit-ceo-piloto/jev-chamadas.jsonl", import.meta.url),
  );

const desativado = (): FalhaJev => ({
  estado: "desativado",
  codigo: "desativado",
  mensagem:
    "Jev desligado: só funciona no piloto autorizado (COCKPIT_JEV_PILOTO=1), fora de produção.",
});

export function rotearPerguntaPiloto(id: IdPerguntaCeo): Promise<ResultadoJev | FalhaJev> {
  if (!pilotoJevAtivo(process.env)) return Promise.resolve(desativado());
  return decidirJev(payloadRoteamento(id), {
    obterChave: obterChaveKeychain,
    ledger: criarLedgerArquivo(caminhoLedger()),
    exemplo: "ceo:" + id,
  });
}

export function testeEmailPiloto(): Promise<ResultadoJev | FalhaJev> {
  if (!pilotoJevAtivo(process.env)) return Promise.resolve(desativado());
  return decidirJev(payloadTesteEmail(), {
    obterChave: obterChaveKeychain,
    ledger: criarLedgerArquivo(caminhoLedger()),
    exemplo: "email-exploratorio",
  });
}

export interface StatusJev {
  ativo: boolean;
  chaveCadastrada: boolean;
  orcamento: ResumoOrcamento | null;
  /** Desfechos sem texto analisado: id opaco, exemplo, modelo, duração, custo e respostas. */
  chamadas: Omit<RegistroChamada, "tokens" | "formato">[];
}

export async function statusPiloto(): Promise<StatusJev> {
  if (!pilotoJevAtivo(process.env))
    return { ativo: false, chaveCadastrada: false, orcamento: null, chamadas: [] };
  const registros = await criarLedgerArquivo(caminhoLedger()).ler();
  return {
    ativo: true,
    // Só diz se existe; o valor não sai desta função.
    chaveCadastrada: (await obterChaveKeychain()) !== null,
    orcamento: resumirOrcamento(registros),
    chamadas: registros
      .filter((r) => r.estado !== "reservada")
      .map(({ tokens: _tokens, formato: _formato, ...r }) => r),
  };
}
