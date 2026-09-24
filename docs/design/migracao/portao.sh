#!/bin/zsh
# Portão do DS v2 com trava global: a máquina tem 8 GB e dois builds juntos fazem swap.
# Uso: portao.sh <diretório do worktree>. Roda build, tsc e design:lint:changed, um worktree por vez.
set -u
DIR="${1:-$PWD}"
LOCK="/private/tmp/claude-502/-Users-pluca-Desktop-AI-Projects/cd929927-c6e8-49b3-9ae4-50eb2a90f7fc/scratchpad/portao.lock"
until mkdir "$LOCK" 2>/dev/null; do
  # trava órfã (dono morto) é removida
  if [ -f "$LOCK/pid" ] && ! kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
  sleep 10
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
cd "$DIR" || exit 2
echo "== build ($DIR)"
NODE_OPTIONS=--max-old-space-size=6144 npx vite build > .portao-build.log 2>&1
B=$?; echo "build exit $B"; [ $B -ne 0 ] && tail -30 .portao-build.log
echo "== tsc"
npx tsc --noEmit -p . > .portao-tsc.log 2>&1
grep "error TS" .portao-tsc.log | sed 's/(.*//' | sort | uniq -c
echo "tsc erros: $(grep -c 'error TS' .portao-tsc.log) (a main tem 7)"
echo "== design:lint:changed"
npm run -s design:lint:changed 2>&1 | tail -25
rm -f .portao-build.log .portao-tsc.log
exit $B
