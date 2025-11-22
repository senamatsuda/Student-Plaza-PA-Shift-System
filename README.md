# 学生プラザ3F 留学交流グループ シフト調整システム

学生 (PA) のシフト提出と管理者向け集計を 1 つの静的アプリで完結できるツールです。
v2 では Render (無料 Web Service + 永続ディスク) に配置したシンプルな JSON API と同期でき、GitHub Pages 等の静的ホスティングから
でも共通データを扱えます。API を設定しない場合は従来通り、閲覧中ブラウザの LocalStorage のみで動作します。

## 主な画面

- **PA入力タブ**: 平日だけを表示するカレンダーで午前/午後/1日/その他を選択して提出できます。
- **Admin › 特別日追加**: 授業振替日などを登録し、PA入力カレンダーと集計表へ反映します。
- **Admin › PA編集**: シフト入力で選べる名前を追加・更新・削除できます。
- **Admin › シフト調整**: 提出済みデータを午前/午後スロットごとに並べ替えて確認し、確定済みのシフトを画像として保存できます。

## 使い方

1. リポジトリをクローン、または ZIP を展開します。
2. `index.html` をブラウザで直接開くか、任意の HTTP サーバー
   (例: `python -m http.server 8000`) で公開します。
3. 「Admin › PA編集」でメンバーを登録し、「PA入力」で各自のシフトを入力してください。
4. 入力済みデータはブラウザの LocalStorage に保存されるため、同じ PC/ブラウザから再度アクセスすると再読み込みされます。

> ⚠️ LocalStorage が利用できない環境 (シークレットウィンドウなど) の場合は、ページを閉じるとデータが失われます。

## GitHub Pages + Render API で運用する

1. **フロントエンドを GitHub Pages へ配置**
   - `main` ブランチを Pages (例: `https://<user>.github.io/Student-Plaza-PA-Shift-System/`) で公開します。
   - UI 側の更新は `index.html`, `script.js`, `styles.css`, `config.js` を編集して push するだけです。
2. **Render 無料枠に API をデプロイ**
   - Render で「New +」→「Blueprint」を選択し、このリポジトリを指定します。
   - `render.yaml` により
     - `student-plaza-pa-shift-api` (Web Service, Node 18, 永続ディスク `/data` 付き)
     - `student-plaza-pa-shift-system` (Static Site: GitHub Pages を使う場合は停止可)
     の 2 サービスが作成されます。
   - API サービスには `DATA_FILE=/data/data.json` が設定され、Render の永続ディスクに JSON が保存されます。
3. **API の URL をフロントに設定**
   - Render で払い出された API URL (例: `https://student-plaza-pa-shift-api.onrender.com`) を `config.js` の `apiBaseUrl` に入力し、
     GitHub に push します。
   - ページを再読み込みすると上部の同期ステータスが「Render と同期済み」になります。失敗した場合は警告/エラー表示になります。
4. **更新と再デプロイ**
   - main ブランチへ push すると GitHub Pages と Render API が自動で再デプロイされ、ディスク上のデータは保持されます。

> Render 無料 Web Service は 15 分アクセスがないとスリープします。スリープ中は同期ステータスがオレンジ/赤になりますが、API が
> 起動すると自動で緑に戻ります。

### API をローカルで確認したい場合

```
npm --prefix api install   # ネットワーク制限がある環境では失敗することがあります
DATA_FILE=./api/dev-data.json npm --prefix api start
```

別ターミナルで `python -m http.server 8000` などを実行してフロントエンドを開き、`config.js` の `apiBaseUrl` を
`http://localhost:10000` に変更してください。

## データの保存について

| 種別 | 保存先 | 備考 |
| --- | --- | --- |
| PA 名簿 | LocalStorage: `paShiftNames` / Render API | API 設定時は Render にも同期されます |
| 特別日 | LocalStorage: `paShiftSpecialDays` / Render API | 授業振替日などのメモを保存 |
| シフト提出 | LocalStorage: `paShiftSubmissions` / Render API | 午前/午後/その他の時間帯を記録 |

- `config.js` の `apiBaseUrl` を設定すると、起動時に Render API から JSON を取得し、以降の更新も数秒以内に同期されます。
- API が未設定、またはネットワーク障害がある場合は同期ステータスが警告/エラー表示となり、ブラウザ内のみで保存されます。
- LocalStorage の内容を完全に削除したい場合はブラウザの開発者ツール等から対象サイトのデータをクリアしてください。

## 開発メモ

- ビルド工程はありません。`index.html`, `styles.css`, `script.js` を直接編集してください。
- 祝日データは `https://holidays-jp.github.io/api/v1/date.json` から取得します (取得できない場合は祝日ハイライトなしで動作します)。
- Admin 画面でシフトを確定すると、その状態を画像としてエクスポートできます。
