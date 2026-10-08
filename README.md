# Event Cam — 結婚式・イベント向け共有カメラ（PWA）

ゲストが QR コードを読み取ると、スマホが「枚数限定のインスタントカメラ」になります。
撮った写真は主催者が決めた時刻（現像日時）まで誰にも見えず、時刻になると一斉に公開されます。

- Next.js 16（App Router / TypeScript）+ Tailwind CSS v4 + lucide-react
- Supabase（匿名認証 / Postgres + RLS / Storage / Realtime）
- browser-image-compression（WebP・長辺1920px・500KB以下・quality 0.8）
- Vercel にそのままデプロイ可能

## セットアップ

### 1. Supabase

1. https://supabase.com でプロジェクトを作成
2. **Authentication → Sign In / Providers → 「Allow anonymous sign-ins」を ON**
3. **SQL Editor** に `supabase/schema.sql` を丸ごと貼り付けて実行
   （テーブル・RLS・枚数上限トリガー・Storage バケット `event-photos`・Realtime 設定まで一括で作られます）

### 2. 環境変数

```bash
cp .env.local.example .env.local
```

`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（旧 anon key でも可）を
Supabase の Project Settings → API からコピーして設定します。

### 3. 起動

```bash
npm install
npm run dev          # http://localhost:3000
```

**スマホ実機でカメラを試すには HTTPS が必須** です（`getUserMedia` の制約）。

```bash
npm run dev:https    # 自己署名証明書つきで起動。同じWi-FiのスマホからPCのIPで開く
```

もしくは Vercel にデプロイして本番 URL で確認するのが確実です。

### 4. Vercel へデプロイ

1. GitHub に push → Vercel で Import
2. Environment Variables に `.env.local` と同じ値を設定
3. （任意）`NEXT_PUBLIC_SITE_URL` に本番 URL を入れると QR コードがその URL になります

## 画面

| パス | 内容 |
| --- | --- |
| `/` | トップ。このブラウザで作成したイベント一覧 |
| `/admin/create` | イベント作成（名前・1人あたり枚数・現像日時） |
| `/admin/events/[eventId]` | 管理画面：QR コード / 印刷用カード / 参加者・撮影枚数のリアルタイム集計 / 今すぐ現像 |
| `/event/[eventId]/join` | ニックネーム入力 → 匿名ログイン → 参加 |
| `/event/[eventId]/camera` | カメラ（3:4 ファインダー・残り枚数・フラッシュ演出・インカメラ切替） |
| `/event/[eventId]/gallery` | 現像前：カウントダウン + ぼかしプレビュー / 現像後：グリッド + Realtime + 拡大・保存 |

## 元の指示書からの変更点（意図的なもの）

- **RLS を本番向けに強化**：元案の `FOR ALL USING (true)` は誰でも全写真を読み書き・削除できるため置き換えました。
  - 写真は「自分が撮ったもの」「主催者」「参加者かつ現像済み」の場合のみ読める
  - **現像前の写真は API・Storage・Realtime のどこからも取得できない**（フロントで隠すだけではない）
  - 撮影枚数の上限は DB トリガーでも強制（連打・複数タブ・改ざん対策）
  - Storage は非公開バケット + 署名付き URL。アップロードは `{eventId}/{自分のguestId}_*.webp` のみ許可
- `events` に `owner_uid` を追加：管理画面は作成したブラウザ（匿名ユーザー）だけが開けます
- `guests` に `unique(event_id, auth_uid)`：同じ端末で再参加しても重複しません
- **iPhone（Safari）は canvas から WebP を書き出せない**ため、その場合は自動で JPEG（同じ圧縮条件）にフォールバックします
- Next.js 16 が既定で有効にする `cacheComponents` は、全画面がクライアント側で Supabase と通信する本アプリでは不要なため無効にしています

## 補足・今後の拡張候補

- 主催者の権限は「作成したブラウザの匿名セッション」に紐づきます。Cookie を消すと管理画面に入れなくなるので、
  本格運用ではメールリンク認証などで主催者ログインを追加するのがおすすめです
  （Supabase の匿名ユーザーは `linkIdentity` / `updateUser({ email })` で正式アカウントに昇格できます）
- オフライン対応（Service Worker で撮影キューを保持して再送）、まとめてダウンロード（ZIP）、不適切な写真の削除 UI など
