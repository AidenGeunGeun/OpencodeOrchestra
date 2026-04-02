#!/usr/bin/env bash
set -euo pipefail

copy_tree() {
  local source=$1
  local destination=$2

  if [ ! -d "$source" ]; then
    printf 'Skipping %s (not found)\n' "$source"
    return
  fi

  mkdir -p "$destination"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --ignore-existing "$source/" "$destination/"
  else
    cp -Rn "$source/." "$destination/"
  fi

  printf 'Copied missing files from %s -> %s\n' "$source" "$destination"
}

copy_config_file() {
  local source=$1
  local destination=$2

  if [ ! -f "$source" ] || [ -f "$destination" ]; then
    return
  fi

  mkdir -p "$(dirname "$destination")"
  cp -p "$source" "$destination"
  printf 'Copied %s -> %s\n' "$source" "$destination"
}

config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
cache_home=${XDG_CACHE_HOME:-"$HOME/.cache"}
state_home=${XDG_STATE_HOME:-"$HOME/.local/state"}

copy_tree "$config_home/opencode" "$config_home/oco"
copy_tree "$data_home/opencode" "$data_home/oco"
copy_tree "$cache_home/opencode" "$cache_home/oco"
copy_tree "$state_home/opencode" "$state_home/oco"

copy_config_file "$config_home/opencode/opencode.jsonc" "$config_home/oco/oco.jsonc"
copy_config_file "$config_home/opencode/opencode.json" "$config_home/oco/oco.json"

printf 'Migration copy complete. Legacy paths were left untouched.\n'
