// Homologação de permissões do Cockpit do CEO com perfis reais, sem trocar de identidade de verdade.
//
// Para cada perfil, dentro de `begin transaction read only`: `set local role authenticated` e o JWT
// simulado com o id da pessoa (o mesmo padrão que o DECISIONS.md registra para validar RLS). Mede o
// que a RLS entrega (negócios, contas, manifesto da carteira) e as chaves que o cockpit consulta, e
// deduz o estado que a tela mostraria. Sai só o rótulo do perfil: nenhum nome, e-mail ou id.
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";

const UUID = /^[0-9a-f-]{36}$/;
const perfis = await consultar(
  `select 'super admin' rotulo, (select user_id::text from ops.user_roles where role='admin' order by user_id limit 1) id
   union all
   select 'sócio regional', (select user_id::text from ops.user_roles where role='socio_regional' order by user_id limit 1)
   union all
   select 'conta sem papel', (select u.id::text from auth.users u
      where not exists (select 1 from ops.user_roles r where r.user_id = u.id) order by u.created_at limit 1)`,
  { transacaoSomenteLeitura: true },
);

const resultado = [];
for (const p of perfis) {
  if (!p.id || !UUID.test(p.id)) {
    resultado.push({ perfil: p.rotulo, observacao: "nenhuma conta com esse perfil" });
    continue;
  }
  const claims = JSON.stringify({ sub: p.id, role: "authenticated" }).replace(/'/g, "''");
  const [r] = await consultar(
    `set local role authenticated;
     set local request.jwt.claims to '${claims}';
     select ops.monetizacao_can('view.aquario') aquario,
            ops.monetizacao_can('view.monetizacao') monetizacao,
            ops.monetizacao_can('view.clientes') clientes,
            (select count(*) from ops.monetizacao_deals)::int negocios_visiveis,
            (select count(*) from ops.monetizacao_contas)::int contas_visiveis,
            (select jsonb_path_query_array(ops.acesso_do_usuario('${p.id}'::uuid)->'areas', '$[*]')) areas`,
    { transacaoSomenteLeitura: true },
  ).catch((e) => [{ erro: e.message.slice(0, 200) }]);
  let manifesto = null;
  if (!r.erro && (r.aquario || r.monetizacao || r.clientes)) {
    const [m] = await consultar(
      `set local role authenticated;
       set local request.jwt.claims to '${claims}';
       select (ops.base_carteira_manifesto()->>'count')::int contas_no_manifesto`,
      { transacaoSomenteLeitura: true },
    ).catch((e) => [{ erro: e.message.slice(0, 160) }]);
    manifesto = m;
  }
  const acessoBase = !!(r.aquario || r.clientes);
  const acessoNegocios = !!(r.aquario || r.monetizacao);
  const temArea = Array.isArray(r.areas) && r.areas.includes("cockpit_ceo");
  resultado.push({
    perfil: p.rotulo,
    chaves: { aquario: r.aquario, monetizacao: r.monetizacao, clientes: r.clientes },
    rls: { negocios_visiveis: r.negocios_visiveis, contas_visiveis: r.contas_visiveis, manifesto },
    area_cockpit_ceo: temArea,
    cockpit_mostraria: !temArea
      ? "tela de sem acesso à área (nenhuma carga)"
      : !acessoBase && !acessoNegocios
        ? "acesso insuficiente em todos os números (sem carga)"
        : {
            comerciais: r.monetizacao ? "números" : "acesso insuficiente",
            contas_prontas: !acessoBase
              ? "acesso insuficiente"
              : !acessoNegocios
                ? "acesso insuficiente (sem negócios)"
                : "números",
          },
    coerencia:
      // A premissa do cockpit: sem aquario/monetizacao a RLS não entrega negócios.
      acessoNegocios || r.negocios_visiveis === 0
        ? "ok"
        : "DIVERGE: sem as chaves de negócios, a RLS entregou negócios",
    erro: r.erro,
  });
}

mkdirSync("docs/dev_notes/cockpit-ceo-piloto/homologacao", { recursive: true });
const arquivo = `docs/dev_notes/cockpit-ceo-piloto/homologacao/perfis-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(
  arquivo,
  JSON.stringify({ quando: new Date().toISOString(), resultado }, null, 2) + "\n",
);
console.log(JSON.stringify({ arquivo, resultado }, null, 2));
