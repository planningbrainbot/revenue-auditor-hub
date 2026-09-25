// Cache por pessoa da carga da conversa. A chave é SEMPRE o id do usuário: a carga de uma pessoa
// nunca serve outra. Carga com parte em erro vale só `validadeComErroMs`; carga que falhou inteira
// não fica guardada.
export function criarCachePorPessoa<T>(opcoes: {
  validadeMs: number;
  validadeComErroMs: number;
  temErro: (v: T) => boolean;
}) {
  const guardadas = new Map<string, { ate: number; valor: Promise<T> }>();
  return {
    obter(userId: string, agora: number, montar: () => Promise<T>): Promise<T> {
      const g = guardadas.get(userId);
      if (g && agora < g.ate) return g.valor;
      const valor = montar();
      guardadas.set(userId, { ate: agora + opcoes.validadeMs, valor });
      valor.then(
        (v) => {
          if (opcoes.temErro(v) && guardadas.get(userId)?.valor === valor)
            guardadas.set(userId, { ate: agora + opcoes.validadeComErroMs, valor });
        },
        () => {
          if (guardadas.get(userId)?.valor === valor) guardadas.delete(userId);
        },
      );
      return valor;
    },
    limpar(userId?: string) {
      if (userId) guardadas.delete(userId);
      else guardadas.clear();
    },
  };
}
