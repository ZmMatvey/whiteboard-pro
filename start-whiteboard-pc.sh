#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Установите LTS-версию с https://nodejs.org"
  exit 1
fi

if [ ! -d "node_modules/tsx" ] || [ ! -d "node_modules/ssh2" ] || [ ! -d "node_modules/express" ]; then
  echo "[1/2] Устанавливаем зависимости (первый запуск)..."
  npm install --no-audit --no-fund
fi

echo "[2/2] Запускаем сервер Whiteboard Pro..."
echo "Браузер откроется автоматически, как только сервер будет готов."
echo "Не закрывайте это окно во время урока."

PORT=3000 WB_OPEN_BROWSER=1 npm run dev
