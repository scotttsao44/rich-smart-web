# 富智慧／糙米健康平台 網站（rich-smart-web）

富智慧 CRM SaaS 與糙米健康平台的網站原始碼（Next.js 14 App Router），涵蓋會員管理、佣金計算、商城、品牌頁、微信登入／支付等功能。線上網址備案號：蘇ICP備2026083440號-1。

## 目錄結構

| 路徑 | 說明 |
|---|---|
| `app/` | Next.js 頁面與 API 路由（`app/api/*`、`app/cn/*` 大陸站） |
| `components/` | React 元件 |
| `lib/` | 業務邏輯、資料存取、微信／簡訊／郵件整合 |
| `public/` | 靜態資源（圖片、影片、PDF） |
| `scripts/` | 測試與檢查腳本 |
| `seed-data/` | 僅保留空白範本；真實資料不入庫 |
| `docs/` | 專案文件：需求、架構、進度、工作規則 |
| `mqtt/` | MQTT broker（Mosquitto）設定與腳本 |
| `Dockerfile.prebuilt` | 伺服器端使用的執行映像（只打包已編譯產物） |

## 建置與部署

1. **在建置機（box）上編譯**
   ```bash
   npm ci
   npm run build        # 產出 .next/standalone 與 .next/static
   ```
2. **上傳到伺服器**（上海 ECS，`/opt/caomi-cn`）：將 `.next/standalone`、`.next/static`、`public`、`Dockerfile.prebuilt` 同步過去。
3. **在伺服器上建映像並啟動**
   ```bash
   docker build -f Dockerfile.prebuilt -t caomi-cn:latest .
   docker compose up -d   # 依伺服器上的 compose 設定與 .env
   ```

## 機密資訊

本倉庫**不含任何機密**。所有金鑰、密碼、憑證（微信支付 APIv3 key、AccessKey、SMTP 密碼、TLS 憑證、MQTT passwd 等）只存放於伺服器的 `.env`（`/opt/caomi-cn/.env.aliyun`）與伺服器本地檔案。`.env.example` 只列出所需的鍵名。
