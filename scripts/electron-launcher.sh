#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Electron App Launcher
# Usage: ./electron-launcher.sh [app-path]
#
# Examples:
#   ./electron-launcher.sh                        # Run with devmode (no app)
#   ./electron-launcher.sh /path/to/app.asar      # Run asar archive
#   ./electron-launcher.sh /path/to/index.html    # Run HTML app
#   ./electron-launcher.sh /path/to/main.js       # Run JS app
#   ./electron-launcher.sh /path/to/app/          # Run from directory

APP_PATH="$1"

cd "$(dirname "$0")/../engine" || exit 1

if [ -z "$APP_PATH" ]; then
    # No app path provided, run in devmode
    python3 ./mach run --noprofile -jsconsole --setpref="electron.devmode=true"
else
    # Resolve to absolute path
    if [[ "$APP_PATH" == ~* ]]; then
        APP_PATH="${APP_PATH/#\~/$HOME}"
    fi
    if [[ "$APP_PATH" != /* ]]; then
        APP_PATH="$(cd "$(dirname "$0")/.." && pwd)/$APP_PATH"
    fi
    
    # Pass app path via environment variable and prefs
    export ELECTRON_APP_PATH="$APP_PATH"
    python3 ./mach run --noprofile -jsconsole --setpref="electron.devmode=true" --setpref="electron.appPath=$APP_PATH"
fi
