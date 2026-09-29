#!/usr/bin/env bash
# App local do Cockpit do COO ligado ao banco único e às fontes reais, com a SUA sessão.
#
# - .env.local (ignorado pelo Git): URL e chave pública do banco único e as credenciais de servidor
#   do Financeiro e do Growth (vercel env pull).
# - A chave de serviço do banco único (escritas do ClickUp, triagem) é buscada AGORA pela Management
#   API com o PAT do Brain e fica só no ambiente deste processo: nunca vai para arquivo nem log.
# - OpenRouter (Jev e Perguntar ao Brain): Keychain, só no servidor (COCKPIT_IA_KEYCHAIN=1).
# - Atenção: é o banco de produção. "Virar compromisso" e as ações da fila gravam no ClickUp de verdade.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.local ] || { echo "Falta .env.local (vercel env pull)."; exit 1; }
set -a; source .env.local; set +a
PAT_ENV="/Users/pluca/Desktop/AI Projects/PM Work/execution/brain-financeiro-planning/.deploy.local.env"
SBTOK=$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' "$PAT_ENV" | cut -d= -f2- | tr -d '"'"'"' \r')
export SUPABASE_SERVICE_ROLE_KEY=$(curl -s "https://api.supabase.com/v1/projects/npknehhyyzelmrbbxvtu/api-keys?reveal=true" \
  -H "Authorization: Bearer $SBTOK" -H "User-Agent: curl/8" \
  | python3 -c "import json,sys;print([k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'][0])")
unset SBTOK
export COCKPIT_IA_KEYCHAIN=1
export COCKPIT_IA_KEYCHAIN_SERVICO="${COCKPIT_IA_KEYCHAIN_SERVICO:-planning-openrouter-cockpit-2}"
export COCKPIT_COO_JEV="${COCKPIT_COO_JEV:-1}"
export COCKPIT_COO_MODELO="${COCKPIT_COO_MODELO:-openai/gpt-5.5}"
export NODE_OPTIONS="--max-old-space-size=6144"
PORTA="${PORTA:-8083}"
echo "Entre em http://127.0.0.1:${PORTA}/auth e abra http://127.0.0.1:${PORTA}/cockpit-coo"
exec npx vite dev --host 127.0.0.1 --port "$PORTA" --strictPort
