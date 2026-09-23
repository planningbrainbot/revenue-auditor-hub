#!/usr/bin/env bash
# App local ligado ao banco único do Planning Brain, para homologar o Cockpit do CEO com a SUA sessão.
#
# Usa só a URL e a chave pública do projeto (as mesmas que o navegador recebe em produção), em
# .env.producao.local (ignorado pelo Git). Nada roda com chave de serviço: você entra com seu login
# e a RLS de sempre decide o que aparece. O Jev fica desligado neste modo.
#
# Atenção: é o banco de produção. As outras telas deste app local também gravam de verdade.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.producao.local ] || { echo "Falta .env.producao.local (URL e chave pública do projeto)."; exit 1; }
set -a; source .env.producao.local; set +a
unset COCKPIT_JEV_PILOTO
export NODE_OPTIONS="--max-old-space-size=8192"
PORTA="${PORTA:-8081}"
echo "Entre em http://127.0.0.1:${PORTA}/auth e depois abra http://127.0.0.1:${PORTA}/cockpit-ceo"
exec npx vite dev --host 127.0.0.1 --port "$PORTA" --strictPort
