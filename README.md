# SCHEMACHINE

**インタラクティブな回路設計・機械組立・リアルタイム物理シミュレーションをひとつのワークスペースで。**

SCHEMACHINE は、回路の配置と配線、機械パーツの組立、Rapier ベースの 3D 物理演算をブラウザ上で統合したサンドボックスです。回路の状態をモーター、LED、スピーカー、スイッチなどのハードウェアパーツへ双方向にバインドできます。

<p align="center">
  <img src="thumbnail.png" alt="SCHEMACHINE" width="900">
</p>

## 主な機能

- 回路エディター：バッテリー、抵抗、ダイオード、トランジスタ、MOSFET、オペアンプなどの部品と配線
- リアルタイム回路解析：スイッチ、モーター、LED、ブザー、リレー、センサーなどを即時シミュレーション
- 3D メカニカルスタジオ：板、シャーシ、車輪、ギア、翼、スラスター、プロペラなどを配置・結合
- 物理演算：Three.js による 3D 表示と Rapier による剛体・ジョイント・衝突シミュレーション
- ジョイント：溶接、ピン、モーター、スライダージョイント
- 回路とハードウェアの連動：コンポーネント名による双方向バインディング
- プロジェクト保存：`.schemachine.json` への保存・読み込みとブラウザのローカルストレージへの自動保存
- Part Studio：カスタムメッシュ生成と STL インポート
- プリセット：ゲームやサンプル構成から素早く開始
- Undo/Redo、ズーム、グリッド、インスペクターなどの操作機能

## 技術スタック

- React 18 / TypeScript
- Vite 5
- Three.js
- Rapier3D compat
- Express
- tsx

## 必要環境

- Node.js 18 以上を推奨
- npm
- モダンブラウザ（WebGL 対応）

## セットアップ

```bash
git clone https://github.com/AInohogosya/Schemachine.git
cd Schemachine
npm install
npm run dev
```

ブラウザで <http://localhost:5173> を開きます。

Windows では付属の `start.bat`、Linux/macOS では `start.sh` を実行してセットアップと起動をまとめて行えます。

## 本番ビルド

```bash
npm run build
npm run preview
```

ビルド済みファイルは `dist/` に出力されます。

Express サーバーで配信する場合:

```bash
npm start
```

または、ビルド後に以下を実行します。

```bash
npm run serve
```

既定のサーバーポートは環境に応じて設定されます。

## テスト

```bash
npm test
```

個別のテストも実行できます。

```bash
npm run test:components
npm run test:undo
npm run test:runtime
npm run test:headless
npm run test:render
```

型チェックと本番ビルドの確認:

```bash
npm run typecheck
npm run build
```

## プロジェクトの保存と読み込み

ツールバーの **Save** を押すと、現在の回路とハードウェア構成を `.schemachine.json` としてダウンロードできます。**Load** からファイルを選択すると復元できます。

また、編集内容は `localStorage` に自動保存されます。従来の `.fable.json` ファイルおよび `fablegame.autosave.v1` データにも互換読み込み対応しています。

AI が生成するプロジェクトファイルの詳細な形式は [AI_GUIDE.md](AI_GUIDE.md) を参照してください。

## ディレクトリ構成

```text
.
├── src/
│   ├── circuit/       回路コンポーネントと配線
│   ├── physics/       物理演算・剛体・ジョイント
│   ├── presets/       プリセットプロジェクト
│   ├── render/        2D 描画
│   ├── render3d/      Three.js による 3D 描画
│   ├── sim/           回路・ランタイムシミュレーション
│   ├── studio/        パーツスタジオ
│   ├── sync/          回路とハードウェアの同期
│   ├── ui/            React UI・エディター・入出力
│   ├── main.tsx       アプリケーションエントリーポイント
│   ├── store.ts       状態管理
│   └── types.ts       共通データ型
├── server/            Express 配信サーバー
├── test/              headless・統合・レンダーテスト
├── AI_GUIDE.md        .schemachine.json 形式ガイド
├── index.html         HTML エントリーポイント
├── package.json       スクリプトと依存関係
└── vite.config.ts     Vite 設定
```

## ライセンス

このリポジトリには現在ライセンスファイルがありません。利用・再配布・改変の条件はリポジトリ管理者に確認してください。
