#!/usr/bin/env zsh
# Opens 5CR1PT3R5 in your browser, starting the local host first if it isn't running.
# Used by the 5CR1PT3R5 app (scripts/install-app.zsh). Close the window, or press Ctrl+C, to
# stop the host. Agents already working keep going either way.
#   Usage: ./scripts/start-office.zsh [port]
emulate -L zsh
setopt err_exit no_unset pipe_fail

readonly root=${0:A:h:h}
readonly port=${1:-4777}
readonly url="http://127.0.0.1:${port}/"

if curl --silent --fail --max-time 2 "${url}api/snapshot" >/dev/null 2>&1; then
  open "$url" 2>/dev/null || xdg-open "$url"
  exit 0
fi

# Started from the Dock or Finder, PATH can miss Homebrew and Node version managers.
# Appended, so whatever your shell already finds first still wins.
path+=(
  /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.volta/bin"
  "$HOME/.local/share/fnm/aliases/default/bin" "$HOME/Library/Application Support/fnm/aliases/default/bin"
  "$HOME"/.nvm/versions/node/v*/bin(N/nOn) # nvm: newest version first
)

if ! command -v node >/dev/null 2>&1; then
  print -u2 'Node.js was not found. Install it from https://nodejs.org (or: brew install node)'
  exit 1
fi

print -P "%F{green}Starting 5CR1PT3R5 at $url%f"
print 'Keep this window open while you use the office. Close it (or press Ctrl+C) to stop the host.'

# On a Mac, keep it from idle-sleeping while the office is open so running agents aren't paused.
# Closing the lid on battery still sleeps.
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i node "$root/bin/office.mjs" ui --port "$port"
fi
exec node "$root/bin/office.mjs" ui --port "$port"
