---
description: 在 Android 模擬器建置並開啟 debug 版 App，接上 CDP 以便直接操作 WebView
argument-hint: "[要檢查的東西，例如「推文顏色」（可省略）]"
---

在本機模擬器跑 App 的 **debug 版**。

1. SDK 在 `$HOME/Library/Android/sdk`，AVD 是 `Medium_Phone_API_37.0`。`adb devices` 沒有模擬器就在背景啟動：`$HOME/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_37.0 -no-snapshot-save`，等 `adb wait-for-device` 並確認 `sys.boot_completed` 是 1。
2. 建置：根目錄 `npm run build`，然後 `cd mobile && node build.js && npx cap sync android`，再 `cd android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleDebug`。
3. 安裝：`adb install -r app/build/outputs/apk/debug/app-debug.apk`。如果因簽章不同失敗（裝著的是 release 版），先問使用者能不能 `adb uninstall` 再裝；解除安裝會清掉 App 裡的設定和登入。
4. 啟動 App，找它的 pid（`adb shell pidof com.jjptt.app`；啟動用 `adb shell monkey -p com.jjptt.app 1`），然後
   `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`，
   從 `http://localhost:9333/json` 取 `webSocketDebuggerUrl`。
5. 用 `node .claude/tools/cdp.mjs <ws url> '<js>'` 在 WebView 裡執行程式；`pttchrome.app.mobile` 是 App 物件。畫面用 `adb exec-out screencap -p > <scratchpad>/x.png` 截圖再讀圖確認。
6. 不要自己在模擬器裡登入 PTT 或 Google 帳號，也不要代輸密碼（不論從哪裡取得）。需要文章時用不必登入的看板／網頁版文章。

## 已登入的專用模擬器 `JJptt_Login`（要走 BBS 的測試用這台）

站長自己在這台的 App 裡登入了 PTT（密碼存在模擬器的 Android Keystore），App 開啟就會自動登入。需要登入才能測的東西（BBS 代讀、篩選列表開文章、推文、回文）都用這台：

- 啟動：`$HOME/Library/Android/sdk/emulator/emulator -avd JJptt_Login -port 5570 -no-boot-anim`（在背景），之後 adb 一律加 `-s emulator-5570`。
- 安裝新版只能 `adb -s emulator-5570 install -r`（debug 版都用 repo 裡的 debug keystore 簽，可以直接覆蓋）。
- **絕對不要**在這台 `adb uninstall com.jjptt.app`、`pm clear`、`-wipe-data`、刪除或重建 AVD、刪除快照，必須先問站長。這些都會把登入清掉。
- 快照 `logged-in` 是登入後的狀態。登入不見時，先問站長，再用 `adb -s emulator-5570 emu avd snapshot load logged-in` 載回來。
- 要假裝網頁版故障：在 WebView 裡執行 `PttReader.markWebDown('https://www.ptt.cc/bbs/Gossiping/index.html')`（看板列表），文章、搜尋各換成對應的網址。測完用 `PttReader.markWebUp(...)` 恢復。
- 篩選列表的標準檢查流程：Gossiping → 爆 → 止爆 → XX，各點前幾篇，比對打開的標題和作者。
- 自動跑這個流程：`.claude/tools/emu-cdp.sh "$(cat .claude/tools/emu-flow.js)"`。它會讓 App 以為網頁版故障（`window.SIM_DOWN`，預設列表、搜尋、文章全部故障；`{list:1, article:1}` 是「搜尋從網頁版、文章用代碼走 BBS」），依序開 爆文 → 止爆 → 噓爆 的前 4 篇，逐篇印出載入毫秒數和作者／標題對不對（`ok`）。可調 `SIM_QUERIES`、`SIM_N`、`SIM_PAUSE`、`SIM_READ`。目標：全部 `ok`，每篇 1 秒內。

要檢查的東西：$ARGUMENTS
沒有指定就只確認 App 開得起來、首頁正常，並附一張截圖。
