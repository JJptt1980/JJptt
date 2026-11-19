#!/bin/bash
# usage: cdp.sh '<js>'  -- runs in the JJptt_Login emulator's WebView
A=$HOME/Library/Android/sdk/platform-tools/adb
PID=$($A -s emulator-5570 shell pidof com.jjptt.app | tr -d '\r')
$A -s emulator-5570 forward tcp:9334 localabstract:webview_devtools_remote_$PID >/dev/null
WS=$(curl -s localhost:9334/json | python3 -c 'import json,sys;print([p for p in json.load(sys.stdin) if p.get("type")=="page"][0]["webSocketDebuggerUrl"])')
node /Users/taiwanpapi/JJptt/.claude/tools/cdp.mjs "$WS" "$1"
