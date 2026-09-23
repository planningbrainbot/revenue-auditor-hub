#!/usr/bin/env bash
# Preview local do Cockpit do CEO (piloto), só com fonte sintética.
#
# Supabase aponta para um endereço local morto: nenhuma tela deste servidor alcança o banco único.
# Rotas autenticadas redirecionam para /auth e param ali; o preview é /piloto/cockpit-ceo.
#
# Jev real: liga só com COCKPIT_JEV_PILOTO=1 e lê a chave do Keychain do macOS no servidor
# (serviço planning-openrouter-cockpit-piloto). A chave nunca vai para variável de ambiente,
# arquivo, log ou navegador. Sem a chave, o painel Jev mostra a pendência.
set -euo pipefail
cd "$(dirname "$0")/../.."
export VITE_SUPABASE_URL="http://127.0.0.1:9"
export VITE_SUPABASE_PUBLISHABLE_KEY="piloto-sem-supabase"
export SUPABASE_URL="$VITE_SUPABASE_URL"
export SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY"
export COCKPIT_JEV_PILOTO="${COCKPIT_JEV_PILOTO:-1}"
export NODE_OPTIONS="--max-old-space-size=8192"
PORTA="${PORTA:-8080}"
echo "Preview: http://127.0.0.1:${PORTA}/piloto/cockpit-ceo"
exec npx vite dev --host 127.0.0.1 --port "$PORTA" --strictPort
