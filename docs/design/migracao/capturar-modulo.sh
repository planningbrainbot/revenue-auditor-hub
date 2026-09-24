#!/bin/zsh
# Sobe o app de um worktree na porta 8080, fotografa as rotas de um módulo e derruba o servidor.
# Uso: capturar-modulo.sh <worktree> <saida> <modulo>
#   modulo: monetizacao | rede | base | receita | people | admin
# Pré-requisito: `node capturar-telas.mjs login 8080` feito uma vez (e o Chrome do login fechado).
# Usa a trava do portão para não subir junto com um build (máquina de 8 GB).
set -u
WT="$1"; SAIDA="$2"; MOD="$3"
AQUI="${0:A:h}"
ENV_ORIGEM="/Users/pluca/Desktop/AI Projects/PM Work/execution/planning-brain-ds-v2-migracao/.env.local"
LOCK="/private/tmp/claude-502/-Users-pluca-Desktop-AI-Projects/cd929927-c6e8-49b3-9ae4-50eb2a90f7fc/scratchpad/portao.lock"

typeset -A ROTAS
ROTAS[monetizacao]="/monetizacao /monetizacao?aba=follow-day /monetizacao?aba=temporal /monetizacao?aba=forecast /monetizacao?aba=capacidade /monetizacao?aba=funil /monetizacao?aba=pessoas /monetizacao?aba=roteiros /monetizacao?aba=distribuicao /fila-cella /clientes?view=monetizacao /clientes?view=produtos /clientes?view=pendencias /clientes?view=contratos /clientes?view=gates"
ROTAS[rede]="/rede-overview /indicadores-trimestre /idu /rede-realizado /rede-ltv /rede-headcount"
ROTAS[base]="/painel-cs /nps /auditoria-interna /reforma-tributaria /disparos-whatsapp /base-contatos"
ROTAS[receita]="/receita-overview /funil-receita /contas-receber /unidades /unidades/royalties /unidades/funil-cac /unidades/split /comissoes /ebit-operacional"
ROTAS[people]="/gente?tela=minha-vez /gente?tela=meu-time /gente?tela=um-a-um /gente?tela=lideranca /gente?tela=feedback /gente?tela=elogios /gente?tela=avaliacao /gente?tela=pdi /gente?tela=cadastro /gente?tela=clima /gente?tela=adocao /broker /broker/admin /painel-unidade /meus-royalties /minhas-auditorias"
ROTAS[admin]="/admin/usuarios /admin/niveis /admin/perfis /admin/permissoes /admin/acessos-financeiro /admin/credenciais /admin/integracoes /admin/validacao /equipe /atividade /inicio /financeiro-partners /pagamentos-unidades"

[ -n "${ROTAS[$MOD]:-}" ] || { echo "módulo desconhecido: $MOD"; exit 2; }
[ -f "$WT/.env.local" ] || cp "$ENV_ORIGEM" "$WT/.env.local"

until mkdir "$LOCK" 2>/dev/null; do
  if [ -f "$LOCK/pid" ] && ! kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
  sleep 10
done
echo $$ > "$LOCK/pid"
cd "$WT" || exit 2
NODE_OPTIONS=--max-old-space-size=4096 npx vite dev --port 8080 --strictPort > /dev/null 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null; pkill -P $VITE 2>/dev/null; rm -rf "$LOCK"' EXIT
for i in {1..120}; do curl -s -o /dev/null http://localhost:8080/ && break; sleep 1; done
node "$AQUI/capturar-telas.mjs" capturar 8080 "$SAIDA" ${=ROTAS[$MOD]}
