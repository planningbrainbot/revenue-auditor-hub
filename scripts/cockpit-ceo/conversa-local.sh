#!/usr/bin/env bash
# App local com "Perguntar ao Brain" ligado ao banco único e às fontes reais, com a SUA sessão.
#
# - .env.local (ignorado pelo Git) traz URL e chave pública do banco único e as credenciais de
#   servidor do Financeiro e do Growth que o cockpit já usa em produção (vercel env pull).
# - A chave do OpenRouter vem do Keychain (serviço planning-openrouter-cockpit-piloto) só no
#   servidor, e só porque COCKPIT_IA_KEYCHAIN=1; nunca vai para arquivo, log ou navegador.
# - Atenção: é o banco de produção. Conversas e visões gravadas aqui são reais (privadas por RLS).
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.local ] || { echo "Falta .env.local (vercel env pull)."; exit 1; }
set -a; source .env.local; set +a
export COCKPIT_IA_KEYCHAIN=1
export COCKPIT_IA_KEYCHAIN_SERVICO="${COCKPIT_IA_KEYCHAIN_SERVICO:-planning-openrouter-cockpit-2}"
export COCKPIT_CONVERSA_MODELO="${COCKPIT_CONVERSA_MODELO:-anthropic/claude-sonnet-5}"
export NODE_OPTIONS="--max-old-space-size=8192"
PORTA="${PORTA:-8082}"
echo "Entre em http://127.0.0.1:${PORTA}/auth e abra http://127.0.0.1:${PORTA}/cockpit-ceo/perguntar"
exec npx vite dev --force --host 127.0.0.1 --port "$PORTA" --strictPort
