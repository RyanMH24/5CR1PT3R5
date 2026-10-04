#!/usr/bin/env zsh
# Builds a 5CR1PT3R5 app in ~/Applications (Spotlight, Launchpad, drag it to the Dock).
# Opening it shows the office page if the host is running; otherwise it opens a Terminal window
# that starts the host. Close that window to stop the host. Run again after moving this folder.
#   Usage: zsh scripts/install-app.zsh [port]
emulate -L zsh
setopt err_exit no_unset pipe_fail

if [[ $OSTYPE != darwin* ]]; then
  print -u2 'This builds a macOS app. On Windows use scripts\install-shortcut.ps1.'
  exit 1
fi

readonly root=${0:A:h:h}
readonly port=${1:-4777}
readonly app="$HOME/Applications/5CR1PT3R5.app"
readonly contents="$app/Contents"

rm -rf "$app"
mkdir -p "$contents/MacOS" "$contents/Resources"

# Terminal runs .command files, so the host gets a window you can watch and close.
cat > "$contents/Resources/start-office.command" <<EOF
#!/bin/zsh
exec /bin/zsh ${(q)root}/scripts/start-office.zsh $port
EOF

cat > "$contents/MacOS/5CR1PT3R5" <<EOF
#!/bin/zsh
# Host already up: just open the page. Otherwise start it in a Terminal window.
if /usr/bin/curl --silent --fail --max-time 2 'http://127.0.0.1:$port/api/snapshot' >/dev/null 2>&1; then
  exec /usr/bin/open 'http://127.0.0.1:$port/'
fi
exec /usr/bin/open -a Terminal "\${0:A:h:h}/Resources/start-office.command"
EOF

cat > "$contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>5CR1PT3R5</string>
  <key>CFBundleDisplayName</key><string>5CR1PT3R5</string>
  <key>CFBundleIdentifier</key><string>local.5cr1pt3r5.office</string>
  <key>CFBundleExecutable</key><string>5CR1PT3R5</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
EOF

chmod +x "$contents/MacOS/5CR1PT3R5" "$contents/Resources/start-office.command" "$root/scripts/start-office.zsh"

make_icon() {
  local png=$root/scripts/mac/AppIcon.png
  local iconset=$(mktemp -d)/AppIcon.iconset
  local s
  mkdir -p "$iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$png" --out "$iconset/icon_${s}x${s}.png" >/dev/null || return 1
    sips -z $((s * 2)) $((s * 2)) "$png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null || return 1
  done
  iconutil -c icns "$iconset" -o "$contents/Resources/AppIcon.icns"
}
if ! make_icon 2>/dev/null; then
  print -u2 'Could not build the icon; the app will use the default one.'
fi
touch "$app" # nudge Finder to pick up the icon

print -P "%F{green}Created $app%f"
print 'Open it from Spotlight or Launchpad, or drag it from ~/Applications to the Dock.'
