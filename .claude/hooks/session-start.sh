#!/bin/bash
# Prepara cada sesión en la nube: CLI de Gemini (fotos, datos, revisiones) y dependencias de las pruebas.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if ! command -v gemini >/dev/null 2>&1; then
  npm install -g @google/gemini-cli >/dev/null 2>&1 || echo "Aviso: no se pudo instalar el CLI de Gemini" >&2
fi

# Con la clave en GEMINI_API_KEY, que no pregunte cómo identificarse.
mkdir -p "$HOME/.gemini"
if [ ! -f "$HOME/.gemini/settings.json" ]; then
  echo '{"security":{"auth":{"selectedType":"gemini-api-key"}},"privacy":{"usageStatisticsEnabled":false}}' > "$HOME/.gemini/settings.json"
fi

# Uso sin preguntas (gemini -p "…"): confiar en la carpeta del proyecto.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export GEMINI_CLI_TRUST_WORKSPACE=true' >> "$CLAUDE_ENV_FILE"
fi

npm install --no-audit --no-fund >/dev/null 2>&1 || echo "Aviso: falló npm install" >&2
