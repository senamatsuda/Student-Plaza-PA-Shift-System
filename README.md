# 学生プラザ3F 留学交流グループ シフト調整システム

学生 (PA) のシフト提出と管理者向け集計を 1 つの静的アプリで完結できるツールです。
Supabase に置いたデータベース (本番環境) と同期でき、GitHub Pages 等の静的ホスティングでも共通データを扱えます。
API を設定しない場合はブラウザの LocalStorage のみで動作します。

## 主な画面

- **PA入力タブ**: 平日だけを表示するカレンダーで午前/午後/1日/勤務不可/その他を選択して提出できます。
- **Admin › 特別日追加**: 授業振替日などを登録し、PA入力カレンダーと集計表に反映します。
- **Admin › PA編集**: シフト入力で選べる名前を追加・更新・削除できます。
- **Admin › シフト調整**: 提出済みデータを午前/午後スロットごとに並べ替えて確認し、確定済みのシフトを画像として保存できます。
- **Admin › 出勤日指定**: 夏季・冬季・春季休暇などにて、平日で出勤日がない日が事前に確定し、シフト提出が必要ない場合、「出勤なし」と指定できます。

## 使い方 (最短手順)

1. リポジトリをクローン、または ZIP を展開します。
2. `config.js` の `apiBaseUrl` を設定します。
   - 既定値は Render 上のデモ API (`https://student-plaza-pa-shift-system.onrender.com`) です。本番では Supabase の API Gateway 経由のエンドポイントに差し替えて運用しています。自身の環境で運用する場合は適宜変更してください。
   - 空文字にするとブラウザの LocalStorage のみを利用します。
3. `index.html` をブラウザで直接開くか、任意の HTTP サーバー (例: `python -m http.server 8000`) で公開します。
4. 「Admin › PA編集」でメンバーを登録し、「PA入力」で各自のシフトを入力してください。
5. 入力済みデータはブラウザの LocalStorage に保存され、同じ PC/ブラウザから再アクセスすると再読み込みされます。

> ⚠️ LocalStorage が利用できない環境 (シークレットウィンドウなど) の場合は、ページを閉じるとデータが失われます。

## GitHub Pages + API で運用する

1. **フロントエンドを GitHub Pages へ配置**
   - `main` ブランチを Pages (例: `https://<user>.github.io/Student-Plaza-PA-Shift-System/`) で公開します。
   - UI 側の更新は `index.html`, `script.js`, `styles.css`, `config.js` を編集して push するだけです。
2. **バックエンドの選択**
   - **本番運用:** Supabase に格納したデータベースを API サーバー経由で公開し、その URL を `config.js` に設定します。
   - **Render でのホスティング:** `render.yaml` で API サーバーとフロントエンドの両方を立ち上げる構成例があります。Supabase に接続する場合は Render の環境変数に `SUPABASE_URL` と `SUPABASE_SERVICE_KEY` を設定してください。
     - `DATA_FILE` は現行の Supabase 版 API では利用しないため、必要に応じて `render.yaml` 側で削除してください。
3. **API の URL をフロントに設定**
   - Supabase や Render など、利用するバックエンドで払い出された API URL を `config.js` の `apiBaseUrl` に入力し、GitHub に push します。
   - ページを再読み込みすると上部の同期ステータスが「同期済み」になります。失敗した場合は警告/エラー表示になります。
4. **更新と再デプロイ**
   - main ブランチへ push すると GitHub Pages と Render API が自動で再デプロイされます。Supabase を使う場合は DB がホスティングされているため、フロントエンドの再デプロイのみで済みます。

> Render 無料 Web Service は 15 分アクセスがないとスリープします。スリープ中は同期ステータスがオレンジ/赤になりますが、API が起動すると自動で緑に戻ります。

### API をローカルで確認したい場合

```
npm --prefix api install   # ネットワーク制限がある環境では失敗することがあります
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm --prefix api start
```

別ターミナルで `python -m http.server 8000` などを実行してフロントエンドを開き、`config.js` の `apiBaseUrl` を `http://localhost:10000` に変更してください。
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` を設定しないと API が起動しないため、ローカルで試す場合も環境変数が必須です。

### API サーバーの環境変数

| 変数名 | 役割 | 例 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase プロジェクトの URL | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase の Service Role Key | `eyJhbGci...` |
| `PORT` | API サーバーの待受ポート (任意) | `10000` |

## データの保存について

| 種別 | 保存先 | 備考 |
| --- | --- | --- |
| PA 名簿 | LocalStorage: `paShiftNames` / Supabase または Render API | API 設定時はサーバー側 DB にも同期されます |
| 特別日 | LocalStorage: `paShiftSpecialDays` / Supabase または Render API | 授業振替日などのメモを保存 |
| シフト提出 | LocalStorage: `paShiftSubmissions` / Supabase または Render API | 午前/午後/その他の時間帯を記録 |
| 確定シフト | LocalStorage: `paShiftConfirmedShifts` / Supabase または Render API | Admin 画面で確定した結果を保持 |
| 出勤日指定 | LocalStorage: `paWorkdayAvailability` / Supabase または Render API | Admin 画面で確定した結果を保持 |


### Supabase で利用するテーブル例

Render API と同じ JSON 形式で同期するため、Supabase でも以下のテーブルを用意してください（すべて `TEXT` で揃えています）。

```sql
-- 1) names: PA 名簿
CREATE TABLE IF NOT EXISTS names (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- 2) special_days: 特別日
CREATE TABLE IF NOT EXISTS special_days (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  note TEXT NOT NULL
);

-- 3) submissions: シフト提出データ
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  monthKey TEXT NOT NULL,
  shiftType TEXT NOT NULL,
  start TEXT,
  "end" TEXT
);

-- 4) confirmed_shifts: 確定シフト (Admin での確定結果)
CREATE TABLE IF NOT EXISTS confirmed_shifts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  shiftType TEXT NOT NULL,
  start TEXT,
  "end" TEXT,
  note TEXT
);

-- 5) workday_availability: 出勤日指定
CREATE TABLE IF NOT EXISTS workday_availability (
  date TEXT PRIMARY KEY,
  isAvailable BOOLEAN NOT NULL DEFAULT TRUE
);
```

- `config.js` の `apiBaseUrl` を設定すると、起動時に Supabase (または Render) の API から JSON を取得し、以降の更新も数秒以内に同期されます。
- API が未設定、またはネットワーク障害がある場合は同期ステータスが警告/エラー表示となり、ブラウザ内のみで保存されます。
- LocalStorage の内容を完全に削除したい場合はブラウザの開発者ツール等から対象サイトのデータをクリアしてください。

## 開発メモ

- ビルド工程はありません。`index.html`, `styles.css`, `script.js`, `config.js` を直接編集してください。
- 祝日データは `https://holidays-jp.github.io/api/v1/date.json` から取得します (取得できない場合は祝日ハイライトなしで動作します)。
- Admin 画面でシフトを確定すると、その状態を画像としてエクスポートできます。

## macOS で毎日 0 時にバックアップする

このリポジトリには、API の `/api/data` を毎日自動取得して macOS に JSON 保存するためのスクリプトと `launchd` テンプレートが含まれています。

- スクリプト: `scripts/backup-pa-shift.mjs`
- `launchd` テンプレート: `ops/com.studentplaza.pa-shift.backup.plist`
- 既定の取得先: `https://student-plaza-pa-shift-system.onrender.com/api/data`
- 既定の保存先: `~/Documents/PA-Shift-Backups`
- 既定の保持期間: 30 日
- 既定のタイムアウト: 60 秒
- 既定の再試行: 3 回、15 秒間隔
- 既定のタイムゾーン: `Asia/Tokyo`

### 1. 手動で疎通確認する

```bash
node scripts/backup-pa-shift.mjs
```

別の API を使う場合は `--api-base-url` で上書きできます。

```bash
node scripts/backup-pa-shift.mjs \
  --api-base-url https://your-api.example.com \
  --output-dir ~/Documents/PA-Shift-Backups \
  --retention-days 30 \
  --timeout-ms 60000 \
  --max-attempts 3 \
  --retry-delay-ms 15000 \
  --timezone Asia/Tokyo
```

成功すると次の 2 ファイルが更新されます。

- `~/Documents/PA-Shift-Backups/pa-shift-backup-YYYY-MM-DD.json`
- `~/Documents/PA-Shift-Backups/latest.json`

Render 無料 Web Service のコールドスタートで最初の応答が遅いことがあるため、既定では 60 秒待機し、失敗時は 15 秒おきに最大 3 回まで再試行します。

### 2. LaunchAgent を配置する

テンプレートの `ProgramArguments`, `WorkingDirectory`, `StandardOutPath`, `StandardErrorPath` に含まれるプレースホルダを自分の環境の絶対パスへ置き換えてください。Node の実体パスは `which node` で確認できます。

```bash
cp ops/com.studentplaza.pa-shift.backup.plist ~/Library/LaunchAgents/
```

`~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist` を編集したら、次のいずれかで有効化できます。

```bash
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist
launchctl kickstart -k "gui/$(id -u)/com.studentplaza.pa-shift.backup"
```

`bootstrap` で既に読み込まれていると言われた場合は、いったん解除してから再読込します。

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist
```

古い macOS の互換手順としては次も使えます。

```bash
launchctl load -w ~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist
```

### 3. 0 時実行に寄せるため wake / power on を設定する

0 時ちょうどにバックアップしたい場合、Mac がその直前に起きている必要があります。毎日 23:59 に wake / power on を設定する例です。

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 23:59:00
```

現在のスケジュール確認:

```bash
pmset -g sched
```

電源イベントを解除する場合:

```bash
sudo pmset repeat cancel
```

### 4. 停止 / 解除する

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist
rm ~/Library/LaunchAgents/com.studentplaza.pa-shift.backup.plist
```

バックアップファイル自体を消したくない場合は `~/Documents/PA-Shift-Backups` はそのまま残してください。

### 5. 復元する

保存された JSON は `/api/data` と同じ payload 形式です。復元時は対象の JSON を `POST /api/data` に送れば同形式で戻せます。

例:

```bash
curl \
  -X POST \
  -H "Content-Type: application/json" \
  --data @~/Documents/PA-Shift-Backups/latest.json \
  https://student-plaza-pa-shift-system.onrender.com/api/data
```

別の API 環境へ復元する場合は URL を差し替えてください。
