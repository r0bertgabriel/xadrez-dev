#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.xadrez-dev.pid"
LOG_FILE="$ROOT_DIR/.xadrez-dev.log"
PORT="${PORT:-5173}"

cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Erro: Node.js não está instalado ou não está no PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Erro: npm não está instalado ou não está no PATH."
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Xadrez Coach já está rodando (PID $OLD_PID)."
    echo "Acesse: http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ ! -d node_modules ]]; then
  echo "Instalando dependências..."
  npm install
else
  echo "Dependências já instaladas."
fi

echo "Preparando Stockfish 18..."
npm run prepare:engine

: > "$LOG_FILE"

echo "Iniciando Xadrez Coach na porta $PORT..."
if command -v setsid >/dev/null 2>&1; then
  nohup setsid npm run dev -- --host 0.0.0.0 --port "$PORT" >>"$LOG_FILE" 2>&1 < /dev/null &
else
  nohup npm run dev -- --host 0.0.0.0 --port "$PORT" >>"$LOG_FILE" 2>&1 < /dev/null &
fi

PID=$!
echo "$PID" > "$PID_FILE"

sleep 2
if ! kill -0 "$PID" 2>/dev/null; then
  echo "Erro: a aplicação encerrou durante a inicialização."
  echo "Últimas linhas do log:"
  tail -n 40 "$LOG_FILE" || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "Xadrez Coach iniciado com sucesso."
echo "PID: $PID"
echo "URL: http://localhost:$PORT"
echo "Log: $LOG_FILE"
echo "Para parar: ./stop.sh"
