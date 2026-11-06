#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -f "$root/dist/cli.js" || { echo 'Run pnpm build first.' >&2; exit 1; }
mkdir -p "$HOME/.local/bin" "$HOME/.codex/skills/pensieve" "$HOME/.claude/commands"
copy_new() {
  if test -e "$2"; then
    cmp -s "$1" "$2" || { echo "Existing file differs; preserved: $2" >&2; return 1; }
  else
    cp "$1" "$2"
  fi
}
copy_new "$root/skills/pensieve/SKILL.md" "$HOME/.codex/skills/pensieve/SKILL.md"
copy_new "$root/integrations/claude/pensieve.md" "$HOME/.claude/commands/pensieve.md"
launcher="$(mktemp)"
printf '#!/usr/bin/env bash\nexec node %q "$@"\n' "$root/dist/cli.js" > "$launcher"
copy_new "$launcher" "$HOME/.local/bin/pensieve"
chmod +x "$HOME/.local/bin/pensieve"
printf 'Installed pensieve, Codex $pensieve, and Claude Code /pensieve.\n'
printf 'If needed, add ~/.local/bin to PATH. Start a new agent session to discover the skill.\n'
