---
description: 發正式版：把 android-latest 上現在的測試版原封不動升為 android-stable
argument-hint: "[給使用者看的更新說明（可省略，會自動整理）]"
---

把目前的 **測試版** 升成 **正式版**。不重新建置，用的是同一個 APK。

1. 讀 `android-latest` 的 `version.json`（`gh release download android-latest -R JJptt1980/JJptt -p version.json -O -`），以及 `android-stable` 的版次。
2. 測試版和正式版是同一版就說「已經是正式版」並停下。
3. 說明文字：有給參數就用它：$ARGUMENTS
   沒給就從上一個正式版到現在的 commit（`git log`）整理成給一般使用者看的中文條列，只寫使用者感受得到的改變，不寫內部細節。
4. 先把「要升的版次＋說明文字」給使用者看，等使用者說可以才執行：
   `gh workflow run android-stable.yml -R JJptt1980/JJptt --ref gh-pages -f notes='…'`
5. 在背景等 workflow 跑完，確認 `android-stable` 的 `version.json` 已經是那個版次，回報結果與 release 網址。
6. **發 FB 粉專文**（正式版確認上線後才做）：
   - 用步驟 3 的說明文字寫一篇粉專貼文，寫法照 `/promo` 的 FB 版：口語、短段落、適量 emoji，開頭寫「JJptt Android App 更新到 <版次>」，列出更新重點，附 App 下載網址 https://github.com/JJptt1980/JJptt/releases/tag/android-stable （提醒已經裝了 App 的人：首頁上方的版本號會變成綠色「更新到 …」，點它就能更新），結尾放 hashtag。文字放在程式碼區塊裡。
   - 使用者說過不用先問（11/17）：正式版上線後直接發，不必先給他看、也不必在「發佈」前確認。
   - 照 `/fb` 的規則和步驟發（`.claude/commands/fb.md`）：附一張**這次新畫**的 GB子 說明圖，畫出這次改了什麼（例如改前／改後對照），GB子 用一張還沒用過的。
   - 發完確認粉專上只出現一次，在回報裡附上貼文內容。
   - 使用者說這次不發，就跳過。
