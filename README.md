# NTUST 先進製程與設備智能輔助實驗室網站

國立臺灣科技大學先進製程與設備智能輔助實驗室的雙語互動式官方網站。專案以純靜態檔案運作，主頁結合 Three.js 3D 產線、研究成果、團隊資訊、交通方式與中英文切換，可直接部署到 GitHub Pages。

## 快速開始

1. 在專案根目錄啟動本機 HTTP 伺服器：

   ```bash
   python -m http.server 8000
   ```

2. 開啟 [http://localhost:8000](http://localhost:8000)。

網站會使用 ES modules 與 `fetch()` 載入 3D 模型和工站資料，因此請勿以 `file://` 直接雙擊開啟。

## 主要功能

- 以捲動敘事呈現六站式閉環智慧製造 3D 產線
- 行動版導覽、觸控操作、響應式卡片與較大的互動目標
- 中文／英文即時切換
- 研究成果的卡片、清單與關聯圖檢視
- 團隊成員與入學學年篩選
- 實驗室照片輪播、教授介紹與交通資訊
- 支援鍵盤操作、降低動態效果偏好與分頁隱藏時暫停動畫

## 專案結構

```text
.
├─ index.html                 # 正式網站入口與內容資料
├─ assets/
│  ├─ data/
│  │  └─ story-data.js  # 六幕的中英文文案與對話（唯一來源）
│  ├─ design-system/         # 色彩、字體與元件設計系統
│  ├─ images/                # 教授、成員、實驗室與活動照片
│  └─ js/
│     ├─ factory-scene.js    # Three.js 首頁 AI 製造場景（捲動進度 p 的純函式）
│     ├─ runtime.js          # 宣告式頁面執行環境（產生檔）
│     ├─ story-timeline.js   # 首頁捲動時間軸與鏡頭樣條（純函式）
│     └─ three-d-stage.js    # 3D 檢視器 Web Component
├─ archive/
│  ├─ lab-site-v2.html       # 舊版網站，保留供比對
│  ├─ line-model.js          # 舊版 U 形產線幾何（首頁改版前）
│  └─ production-line-3d.html # 舊版產線預覽工具
├─ docs/
│  ├─ GITHUB-PAGES.md        # GitHub Pages 維護與部署說明
│  └─ screens/               # 設計與畫面參考
├─ security-reports/
│  └─ 2026-08-20/            # 歷史安全掃描產物
├─ tools/
│  └─ production-line-3d.html # 新場景 3D 預覽／匯出工具
└─ .nojekyll                 # 讓 GitHub Pages 原樣提供靜態資源
```

## 日常內容維護

| 要修改的內容 | 檔案／位置 |
| --- | --- |
| 論文與研究成果 | `index.html` 的 `PAPERS` |
| 教授學歷與經歷 | `index.html` 的 `EDU`、`EXP` |
| 成員、照片與入學學年 | `index.html` 的 `MEMBERS`、`assets/images/` |
| 實驗室照片輪播 | `index.html` 的 `LAB_PHOTOS` |
| 交通方式與地圖 | `index.html` 的 `TRANSIT`、`TRANSIT_LINK`、`MAP_SRC` |
| 各幕標題、說明、技術標籤與對話 | `assets/data/story-data.js` |
| 3D 設備造型、尺寸與取景點 | `assets/js/factory-scene.js` |
| 各幕捲動區間與鏡頭插值 | `assets/js/story-timeline.js` |
| 色彩、字體與元件樣式 | `assets/design-system/` |

`assets/js/runtime.js` 是產生的執行環境檔案，除非同步更新產生來源，否則不建議手動編輯。

## 3D 開發工具

啟動本機伺服器後，開啟 [http://localhost:8000/tools/production-line-3d.html](http://localhost:8000/tools/production-line-3d.html)。工具支援：

- 進度 p 滑桿（等同首頁捲動進度）、全景與檢測取景（桌機／手機）、良品／裂痕／缺角特寫
- 線架、法線與低細節模式
- OBJ／GLB 匯出

## 技術組成

- 純 HTML、CSS、JavaScript，無本機套件安裝與建置步驟
- Three.js 0.184（ES module CDN）
- GSAP 3.12.5 與 ScrollTrigger
- React／ReactDOM 18.3.1（供自訂頁面執行環境使用）
- Google Fonts：Barlow、Barlow Condensed、Noto Sans TC
- 自訂宣告式模板與 `runtime.js`

## GitHub Pages 部署

正式入口已是根目錄 `index.html`，不需要轉址。合併到 `main` 後，將 GitHub Pages 設為從 `main` 分支根目錄部署即可。詳細檢查清單請見 [docs/GITHUB-PAGES.md](docs/GITHUB-PAGES.md)。

## 後續改進方向

- **優先移除核心 CDN 依賴**：將 React／ReactDOM 18.3.1 從 CDN 下載至 `assets/vendor/`，再把 `index.html` 與 `archive/lab-site-v2.html` 改為載入本機檔案。React 載入失敗會使整個 `runtime.js` 無法渲染頁面，因此優先級最高。
- **視需求移植其他前端依賴**：若網站需要離線使用、校園網路限制下穩定開啟，再將 Three.js、GSAP／ScrollTrigger 與 Google Fonts 一併本機化。
- **保留外部服務備援**：Google Maps 可維持 iframe，但應提供地址文字與地圖連結，避免地圖服務不可用時聯絡資訊消失。
- **建立依賴更新流程**：本機化後由專案自行負責版本更新、安全修補、授權檔案與檔案大小管理；每次更新後需重新執行本機 HTTP 與 GitHub Pages 檢查。
- **評估內容與程式分離**：將 `index.html` 內的論文、成員與履歷常數逐步移到 JSON 或 Markdown，再加入格式驗證，降低直接修改大型 HTML 的風險。

## 安全掃描

[2026-08-20 安全報告](security-reports/2026-08-20/report.md)記錄了歷史版本的離線靜態掃描，當時沒有可回報的發現。該報告針對提交 `30aea51`，不代表目前分支的即時安全狀態。

## 授權

此儲存庫目前未宣告開源授權。網站內容、照片與程式碼的使用權仍由專案擁有者保留。
