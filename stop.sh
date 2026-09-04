#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.xadrez-dev.pid"

cd "$ROOT_DIR"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Nenhum processo registrado em $PID_FILE."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "PID inválido removido."
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "A aplicação já não está em execução."
  exit 0
fi

echo "Parando Xadrez Coach (PID $PID)..."

# star.sh usa setsid quando disponível; nesse caso encerramos todo o grupo
# para não deixar Vite ou processos filhos órfãos.
if kill -- -"$PID" 2>/dev/null; then
  true
else
  kill "$PID" 2>/dev/null || true
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -P "$PID" 2>/dev/null || true
  fi
fi

for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Xadrez Coach parado."
    exit 0
  fi
  sleep 0.25
done

echo "Processo não encerrou normalmente; forçando finalização..."
kill -KILL "$PID" 2>/dev/null || true
if command -v pkill >/dev/null 2>&1; then
  pkill -KILL -P "$PID" 2>/dev/null || true
fi
rm -f "$PID_FILE"
echo "Xadrez Coach parado."
