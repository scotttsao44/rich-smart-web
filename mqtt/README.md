# caomi-mqtt（Mosquitto broker 設定）

伺服器路徑：`/opt/caomi-mqtt`，以 `docker compose up -d` 啟動（eclipse-mosquitto:2，埠 1883 / 8883）。

- `config/mosquitto.conf`、`config/acl`：broker 與主題權限設定
- `add-device.sh`：新增設備帳號；`sync-cert.sh`：同步 TLS 憑證；`mqtt_e2e_test.sh`：端對端測試
- **不含** `config/passwd`、`certs/`、`data/`、`log/`——這些只存在伺服器上。
