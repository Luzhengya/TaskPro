# ローカル開発（CloudBase「Web 安全域名」対策）

## 背景 / なぜ必要か

CloudBase（腾讯云开发）のデータベースゲートウェイは、リクエスト元のドメインが
**「Web 安全域名」ホワイトリスト**に登録されているかを検証します。登録外のドメイン
からのリクエストは、セキュリティルール評価より前に **403 Forbidden** で拒否されます。

`localhost` はホワイトリストに登録できない環境（特に微搭/WeDa ワークスペース）が
多く、その場合 `http://localhost:3000` で起動するとデータベースの読み書きと
リアルタイム監視（watch）が必ず失敗します。

- `.get()` → `403 Forbidden`
- `watch()` → `SDK_DATABASE_REALTIME_LISTENER_INIT_WATCH_FAIL`（握手段階で拒否）

## 解決策

ブラウザの **Origin** が「ホワイトリスト済みの托管ドメイン」になればゲートウェイを
通過します。そこで、**ホワイトリスト済みの托管ドメインを hosts で 127.0.0.1 に向け、
そのドメイン + HTTPS でローカル開発サーバを起動**します。

> 使うドメインは CloudBase コンソールの「安全配置 > Web 安全域名」に表示されている
> 托管ドメイン。例（このプロジェクトの環境）:
> `limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com`
>
> ⚠️ 本番の托管にデプロイ済みだと、同じドメインがローカルに向くため本番サイトを
> ブラウザで開けなくなります。開発が終わったら hosts のエントリをコメントアウト
> してください。

---

## 手順

以降、托管ドメインを `<HOST_DOMAIN>` と表記します。本プロジェクトでは:

```
limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com
```

### 1. hosts に托管ドメインを追加

托管ドメインを 127.0.0.1 に向けます。

- macOS / Linux: `/etc/hosts`
- Windows: `C:\Windows\System32\drivers\etc\hosts`（管理者権限）

```
127.0.0.1   limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com
```

### 2. ローカル証明書を作成

#### 方法 A: mkcert（推奨・ブラウザ警告なし）

```bash
# mkcert 未インストールなら: brew install mkcert  /  choco install mkcert など
mkcert -install
mkdir -p certs
mkcert -key-file certs/local-key.pem \
       -cert-file certs/local-cert.pem \
       limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com
```

#### 方法 B: openssl（自己署名・ブラウザ警告は手動で許可）

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/local-key.pem -out certs/local-cert.pem \
  -subj "/CN=limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com" \
  -addext "subjectAltName=DNS:limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com"
```

> `certs/` と `*.pem` は `.gitignore` 済み。証明書はコミットしないでください。

### 3. .env に証明書パスを設定

`.env`（`.env.example` 参照）に追記:

```
SSL_KEY_FILE="./certs/local-key.pem"
SSL_CERT_FILE="./certs/local-cert.pem"
```

`SSL_KEY_FILE` / `SSL_CERT_FILE` が実在すると `server.ts` は HTTPS で起動します
（未設定なら従来通り HTTP）。

### 4. 起動してアクセス

```bash
npm run dev
```

ブラウザで **托管ドメイン**を開きます（`localhost` ではない点に注意）:

```
https://limoworkspace-d1gjntro8c7fb56db-1439150095.tcloudbaseapp.com:3000
```

これでブラウザの Origin がホワイトリストのドメインと一致し、データベースの
読み書き・watch が 403 にならずに動作します。

---

## トラブルシュート

- **まだ 403**: ブラウザのアドレスバーが `localhost` のままではないか確認。必ず
  托管ドメインで開くこと。hosts が効いているかは `ping <HOST_DOMAIN>` が 127.0.0.1
  を返すかで確認。
- **証明書エラー（NET::ERR_CERT_…）**: 方法 B（自己署名）の場合はブラウザの警告画面
  で「続行」。方法 A（mkcert）にすると警告は出ません。
- **ポートを変えたい**: `PORT` 環境変数で変更可（既定 3000）。安全域名はホスト名で
  判定されるためポートは任意で構いません。
- **本番サイトが開けない**: 手順 1 の hosts エントリをコメントアウト/削除してください。
