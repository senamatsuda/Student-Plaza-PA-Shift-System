# 学生プラザ3F 留学交流グループ シフト調整システム

学生 (PA) のシフト提出と管理者向け集計を 1 つのアプリで完結させるツールです。フロントエンドは静的 HTML/JS で構成され、`api/` 配下の Express + SQLite バックエンドと通信してデータを永続化します。

## 主な機能

- **PA シフト入力フォーム**: 対象月の平日だけが表示され、午前/午後/1日/その他 (任意時間帯) を選択して提出できます。
- **祝日・特別日のハイライト**: 日本の祝日 API から取得した祝日と、管理画面から登録した特別日をカレンダーや集計表上で強調表示します。
- **Admin 集計ビュー**: 名前フィルタと対象月を切り替えながら、提出済みシフトを午前/午後スロットで一覧確認できます。確定したシフトの画像出力も可能です。
- **特別日・PA 名簿の管理**: Admin タブで特別日と PA 名簿を CRUD 操作でき、その結果が即座に全体へ反映されます。
- **API キー + CORS**: GitHub Pages 等の静的ホスティングから安全にバックエンドへアクセスできるよう、`x-api-key` ヘッダーと CORS 許可リストを導入しています。

## セットアップ手順

### 1. API サーバーの起動

1. `cd api`
2. `cp .env.example .env` で設定ファイルを作成し、`API_KEY` や `ALLOWED_ORIGINS` (例: `https://<your-account>.github.io`) を編集します。
3. 依存関係をインストールします: `npm install`
4. 開発モードで起動する場合は `npm run dev`、本番起動は `npm start`

初回起動時に `data.sqlite` が自動作成され、既定の PA 名簿と特別日がシードされます。DB は SQLite のため、バックアップはファイルコピーのみで完結します。

### 2. フロントエンドの公開

1. `index.html` の `<head>` にあるメタタグへ API の URL と API キーを設定します。

   ```html
   <meta name="pa-shift-api-base-url" content="https://example.com" />
   <meta name="pa-shift-api-key" content="my-secret-key" />
   ```

   ※ 環境によっては `window.PA_SHIFT_API_BASE_URL` / `window.PA_SHIFT_API_KEY` を別スクリプトで定義しても構いません。

2. 任意の HTTP サーバーでルートディレクトリを公開します (例: `python -m http.server 8000`)。
3. ブラウザで該当 URL を開き、PA は「PA入力」タブから提出、Admin は「Admin」タブから集計や各種 CRUD を行います。`Admin` タブの「再取得」ボタンで API から最新データを再読込できます。

### 3. Render へのデプロイ

`render.yaml` に Render Web Service の定義を追加しました。リポジトリを Render に接続すると、このファイルの内容がそのまま適用されます。GUI で手動設定する場合は以下を参考にしてください。

1. **Service**: Type = `Web Service`, Runtime = `Node`, Root Directory = `api`。
2. **Build / Start Command**: `npm install` / `npm start`。
3. **Environment**: `PORT` は Render が自動注入します。手動で以下を追加します。
   - `API_KEY`: フロントエンドで利用するシークレット。
   - `ALLOWED_ORIGINS`: `https://<your-account>.github.io` などカンマ区切り。`https://example.com/foo/bar` のようにパス付き URL を指定しても、サーバー側でオリジン (`https://example.com`) へ自動的に正規化されます。
   - `DATABASE_FILE`: `/var/data/pa-shift-data.sqlite`
4. **Persistent Disk**: "Add Disk" から 1GB 程度のディスクを追加し、Mount Path を `/var/data` に設定します。`DATABASE_FILE` の値と一致させることで SQLite ファイルがデプロイ間で保持されます。
5. **Health Check**: Path を `/health` にすることで Render の自動ヘルスチェックが `server.js` の `/health` エンドポイントを参照します。

デプロイ後は Render のサービス URL を `index.html` のメタタグ `pa-shift-api-base-url` に設定し、同じ `API_KEY` を `pa-shift-api-key` にセットしてください。

## 認証と CORS

- すべての API エンドポイントは `x-api-key` ヘッダーを必須としています。`api/.env` の `API_KEY` と同じ値をフロントエンドに設定してください。
- `ALLOWED_ORIGINS` にホワイトリストを設定すると、指定ドメイン以外からのブラウザアクセスを CORS で拒否できます。未設定の場合は全オリジンを許可します。

## API エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/names` | PA 名簿の一覧 (昇順ソート済み) |
| POST | `/names` | 新しい名前を追加 |
| PUT | `/names/:id` | 名前の更新 |
| DELETE | `/names/:id` | 名前の削除 |
| GET | `/special-days` | 特別日の一覧 |
| POST | `/special-days` | 特別日を追加 |
| PUT | `/special-days/:id` | 特別日の更新 |
| DELETE | `/special-days/:id` | 特別日の削除 |
| GET | `/submissions[?monthKey=YYYY-MM&name=PA名]` | シフト提出データの取得 (クエリは任意) |
| POST | `/submissions` | { name, monthKey, entries } を受け取り、同じ name+monthKey の既存レコードを置換 |

レスポンスはすべて JSON です。`entries` には `shiftType`/`start`/`end`/`date`/`monthKey` を含めてください。

## データ永続化

- Express サーバーは SQLite を使用しており、`api/data.sqlite` に `names` / `special_days` / `submissions` テーブルを保持します。
- フロントエンドは `fetch` で API を呼び、取得結果をメモリ上に保持して描画します。LocalStorage には保存しません。

## 開発メモ

- 祝日データは `https://holidays-jp.github.io/api/v1/date.json` からロードしているため、ネットワーク環境に応じてキャッシュやリトライを検討してください。
- `script.js` は ES Module なので、必要に応じてビルドステップを追加する場合は `<script type="module">` に合わせて設定してください。
