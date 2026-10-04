#!/usr/bin/env zsh
# Installs the `office` command and its zsh tab completion. Safe to run again.
#   Usage: zsh scripts/install.zsh
emulate -L zsh
setopt err_exit no_unset pipe_fail

readonly root=${0:A:h:h}
readonly zshrc=${ZDOTDIR:-$HOME}/.zshrc
readonly marker='# 5CR1PT3R5 tab completion'

if ! command -v node >/dev/null 2>&1; then
  print -u2 'Node.js 22.18+ is required: https://nodejs.org (or: brew install node)'
  exit 1
fi
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)'; then
  print -u2 "Node.js $(node --version) is too old; 5CR1PT3R5 needs 22.18+ (brew upgrade node)"
  exit 1
fi

# Copied over from Windows (zip, USB, cloud drive), the scripts lose their executable bit and
# may carry the download quarantine flag.
chmod +x "$root"/bin/*.mjs "$root"/scripts/*.zsh
xattr -dr com.apple.quarantine "$root" 2>/dev/null || true

(cd "$root" && npm install --no-fund --no-audit)

# npm link needs a writable global prefix (fine with Homebrew Node, not with the nodejs.org
# installer). Fall back to a symlink in ~/.local/bin, where Claude Code's installer also lives.
if ! (cd "$root" && npm link --no-fund --no-audit >/dev/null 2>&1); then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$root/bin/office.mjs" "$HOME/.local/bin/office"
  print "Linked office into ~/.local/bin"
  if (( ! ${path[(Ie)$HOME/.local/bin]} )) && ! grep -qF '.local/bin' "$zshrc" 2>/dev/null; then
    print "\nexport PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$zshrc"
    print "Added ~/.local/bin to PATH in $zshrc"
  fi
fi

if ! grep -qF "$marker" "$zshrc" 2>/dev/null; then
  {
    print ''
    print "$marker"
    print "fpath=(\"$root/completions\" \$fpath)"
    print 'autoload -Uz compinit && compinit'
  } >> "$zshrc"
  print "Added tab completion to $zshrc"
fi

print '\nInstalled. Open a new terminal (or run: exec zsh), then try:'
print '  office doctor'
print '  office roster'
[[ $OSTYPE == darwin* ]] && print '\nFor a Dock / Launchpad app: zsh scripts/install-app.zsh'
exit 0
