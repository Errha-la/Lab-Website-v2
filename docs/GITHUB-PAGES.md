# GitHub Pages 部署與檢查

儲存庫：`Errha-la/Lab-Website`
預設分支：`main`

## 部署設定

1. 將已驗證的整合分支合併到 `main`。
2. 前往 GitHub 儲存庫的 **Settings → Pages**。
3. 在 **Build and deployment** 選擇 **Deploy from a branch**。
4. 選擇 `main` 與 `/(root)`，儲存設定。
5. 等待 Pages 部署完成後再執行下方檢查。

根目錄已有正式入口 `index.html` 與 `.nojekyll`，不需要額外轉址或建置命令。

## 部署後檢查

- 根網址直接顯示網站，網址不含空白檔名或額外轉址。
- 導覽、雙語切換、行動版選單與團隊學年篩選可操作。
- `assets/images/` 的標頭、人像與輪播照片正常顯示。
- `assets/data/story-data.js` 可載入，六幕文案資料正確。
- 3D 產線可顯示；瀏覽器主控台沒有 404 或 module 載入錯誤。
- `tools/production-line-3d.html` 可開啟開發檢視器（新場景預覽，含進度 p 滑桿）。

## 外部資源

網站執行時會從 CDN 載入 React、Three.js、GSAP 與 Google Fonts。若部署環境加入 Content Security Policy，需同步允許實際使用的 CDN、字型與 Google Maps 來源。

## 主要路徑

| 用途 | 路徑 |
| --- | --- |
| 正式網站 | `index.html` |
| JavaScript | `assets/js/` |
| 幕文案資料 | `assets/data/story-data.js` |
| 圖片 | `assets/images/` |
| 設計系統 | `assets/design-system/` |
| 3D 開發工具 | `tools/production-line-3d.html` |
| 舊版網站 | `archive/lab-site-v2.html` |
| 畫面參考 | `docs/screens/` |
| 安全報告 | `security-reports/` |
