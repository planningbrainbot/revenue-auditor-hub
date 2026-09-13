// Em qual schema do Postgres as tabelas do Ops vivem.
//
// Nos bancos separados era `public`, o padrão do PostgREST. No banco único
// (`npknehhyyzelmrbbxvtu`) cada produto tem o seu, e o `public` de lá guarda só
// a identidade comum (`profiles`, `produtos`, `produto_acesso`). Sem declarar o
// schema, TODA leitura volta vazia — sem erro, sem log, igualzinho a "não há
// dado". É o modo de falha que o corte precisa evitar.
//
// Por que variável de ambiente e não `'ops'` no código: durante a transição o
// mesmo build precisa servir aos dois bancos. Sem a variável nada muda e a
// produção de hoje segue em `public`; com `VITE_SUPABASE_SCHEMA=ops` o mesmo
// código fala com o banco único. É também o caminho de volta se o corte precisar
// ser revertido: tirar a variável e redeployar.
//
// Lembrar que env de Vite é build-time: criar a variável na Vercel não basta,
// tem que redeployar.
const bruto =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_SCHEMA) ||
  (typeof process !== 'undefined' && process.env?.SUPABASE_SCHEMA) ||
  'public';

export const SUPABASE_SCHEMA = bruto as 'public';

// `db.schema` só entra quando não é o padrão: passar `{ schema: 'public' }` é
// inofensivo, mas deixa o diff do corte mais legível se o objeto simplesmente
// não existir enquanto nada mudou.
export const opcoesDeSchema =
  SUPABASE_SCHEMA === 'public' ? {} : { db: { schema: SUPABASE_SCHEMA } };
