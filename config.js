// リモートAPIのエンドポイントを設定します。GitHub Pages などの静的ホスティングで
// 運用する場合は、Render の Web Service URL (例: https://pa-shift-api.onrender.com)
// を apiBaseUrl に入力してください。空文字の場合はブラウザの LocalStorage のみを利用します。
window.PA_SHIFT_CONFIG = Object.assign(
  {
    apiBaseUrl: "",
    apiTimeoutMs: 10000,
  },
  window.PA_SHIFT_CONFIG || {}
);
