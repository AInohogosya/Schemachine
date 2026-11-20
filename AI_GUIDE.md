# SCHEMACHINE AI向け JSON 設計ガイド (`.schemachine.json`)

このドキュメントは、SCHEMACHINE で読み込める **`.schemachine.json`** ファイルを AI が生成するための仕様書です。
ユーザーはゲーム内の **Load** ボタンでこのファイルを読み込み、回路＋3D機械として遊べます。

---

## 1. 概要

- **SCHEMACHINE** = 回路シミュレータ + 3D物理サンドボックス（Rapier3D） + パーツスタジオ
- **保存/読み込み**：ツールバーの **Save** で `.schemachine.json` をダウンロード、**Load** でファイル選択して復元
- **自動保存**：ローカルストレージ (`schemachine.autosave.v1`) に自動保存される
- **旧データ互換**：従来の `.fable.json` ファイルと `fablegame.autosave.v1` 自動保存はそのまま読み込める
- **AIワークフロー**：AI が JSON を生成 → ユーザーが Load → 即座に回路が解かれ、3D が物理演算で動く

---

## 2. 全体構造 (`ProjectData`)

```ts
interface ProjectData {
  version: number;      // 常に 1
  name: string;         // プロジェクト名（ファイル名にも使用）
  groundY: number;      // 地面の Y 座標（デフォルト 900）
  circuit: CircuitData; // 回路データ
  hardware: HardwareData; // ハードウェア（3D）データ
}
```

```ts
interface CircuitData {
  components: CircuitComponentData[];
  wires: WireData[];
}

interface HardwareData {
  parts: HardwarePartData[];
  joints: JointData[];
  meshes: CustomMesh[]; // パーツスタジオのカスタム形状ライブラリ
}
```

---

## 3. 座標系のルール

| 領域 | X | Y | Z | 角度 |
|------|---|---|---|------|
| **回路 (Schematic)** | 右が正 | **下が正** (画面座標系) | なし | なし |
| **ハードウェア (3D)** | 右が正 | **下が正** (データ上) | 手前が正 | 度数法、時計回りが正 |

- **groundY** (既定 900) = 地面の Y 座標。これより大きい Y は地面より下（埋まる）。
- 物理エンジン内部では Y が反転されるため、データ上は「下＝大きい Y」で OK。
- パーツの `z` は奥行き（手前が正）。2D 構成では 0 で可。
- ジョイントのアンカー `ax, ay, bx, by` は **各パーツのローカル座標**（回転前）で指定。

---

## 4. 回路コンポーネント (`CircuitComponentData`)

```ts
interface CircuitComponentData {
  id: string;        // 一意 (例: "c1", "c2"…)。ローダーで重複は除外される
  name: string;      // 表示名＋**バインディングキー**（大文字小文字無視で一致）
  type: CircuitComponentType; // 下表参照
  x: number;         // 回路キャンバス上の X
  y: number;         // 回路キャンバス上の Y (下向き正)
  props: CircuitProps; // 型ごとのプロパティ
}
```

### 4.1 コンポーネントタイプ一覧とピン定義

| type | ラベル | ピン (name, role) | デフォルト props |
|------|--------|-------------------|------------------|
| `battery` | Power Supply | `+` (positive), `-` (negative) | `voltage: 9, maxCurrent: 8` |
| `ground` | Ground | `G` (negative) | — |
| `resistor` | Resistor | `A` (passive), `B` (passive) | `resistance: 220` |
| `diode` | Diode | `A` (passive), `K` (passive) | `forwardVoltage: 0.7` |
| `led` | LED | `A` (passive), `K` (passive) | `forwardVoltage: 2.0, color: 'red'` |
| `switchPush` | Push Button | `A` (passive), `B` (passive) | `closed: false` |
| `switchSlide` | Slide Switch | `A` (passive), `B` (passive) | `closed: false` |
| `potentiometer` | Potentiometer | `A` (passive), `W` (passive), `B` (passive) | `resistance: 10000, position: 0.5` |
| `motor` | DC Motor | `+` (positive), `-` (negative) | `resistance: 2, ke: 1.0, maxCurrent: 10` |
| `buzzer` | Buzzer | `+` (positive), `-` (negative) | `resistance: 100, frequency: 440` |
| `gate` | Logic Gate | `IN1` (input), `IN2` (input), `OUT` (output) | `gateType: 'AND'` |
| `transistor` | Transistor | `B` (base), `C` (collector), `E` (emitter) | `transistorKind: 'NPN', rce: 2` |
| `fuse` | Fuse | `A` (passive), `B` (passive) | `maxCurrent: 1` |
| `capacitor` | Capacitor | `A` (passive), `B` (passive) | `capacitance: 0.001, initialVoltage: 0` |
| `inductor` | Inductor | `A` (passive), `B` (passive) | `inductance: 0.1, initialCurrent: 0` |
| `schottky` | Schottky Diode | `A` (passive), `K` (passive) | `forwardVoltage: 0.3` |
| `zenerDiode` | Zener Diode | `A` (passive), `K` (passive) | `forwardVoltage: 0.7, zenerVoltage: 5.1` |
| `rgbLed` | RGB LED | `R` (input), `G` (input), `B` (input), `K` (negative) | `forwardVoltage: 2.2, color: 'rgb'` |
| `incandescent` | Incandescent Lamp | `+` (positive), `-` (negative) | `resistance: 24, ratedPower: 12, maxCurrent: 2` |
| `photoresistor` | Photoresistor | `A` (passive), `B` (passive) | `resistance: 1000, darkResistance: 1000000, lightLevel: 0.5` |
| `thermistor` | Thermistor | `A` (passive), `B` (passive) | `resistance: 10000, beta: 3950, temperature: 25` |
| `relay` | Relay | `A` (input), `B` (input), `COM` (passive), `NO` (output), `NC` (output) | `resistance: 200, pickupVoltage: 5, maxCurrent: 5` |
| `mosfet` | MOSFET | `G` (base), `D` (collector), `S` (emitter) | `mosfetKind: 'N', thresholdVoltage: 2, rdsOn: 0.05` |
| `currentSource` | Current Source | `A` (positive), `B` (negative) | `current: 0.01` |
| `clock` | Clock | `OUT` (output), `GND` (negative) | `frequency: 1, amplitude: 5, dutyCycle: 0.5, outputResistance: 50` |
| `opAmp` | Operational Amplifier | `IN+` (input), `IN-` (input), `OUT` (output), `V+` (positive), `V-` (negative) | `gain: 100000, outputResistance: 5` |
| `solenoid` | Solenoid | `+` (positive), `-` (negative) | `resistance: 12, pickupVoltage: 3, maxCurrent: 2, ratedPower: 12` |
| `fan` | Fan | `+` (positive), `-` (negative) | `resistance: 4, ke: 0.5, maxCurrent: 3` |
| `speaker` | Speaker | `+` (positive), `-` (negative) | `resistance: 8, frequency: 440, ratedPower: 1` |

> **ゲートの IN2** は `gateType !== 'NOT'` の時のみ使用。NOT の場合は IN1 のみ。

### 4.2 `CircuitProps` リファレンス

```ts
interface CircuitProps {
  voltage?: number;           // バッテリ電圧
  resistance?: number;        // 抵抗値 Ω (resistor, potentiometer, motor, buzzer)
  forwardVoltage?: number;    // 順方向電圧 (diode, led)
  color?: 'red'|'green'|'blue'|'yellow'|'white'|'rgb'; // LED色
  gateType?: 'AND'|'OR'|'NOT'|'NAND'|'NOR'|'XOR'|'XNOR';
  transistorKind?: 'NPN'|'PNP';
  key?: string;               // キーボードバインド (例: 'Space', 'KeyW', 'ArrowUp')
  closed?: boolean;           // スイッチ初期状態
  position?: number;          // ポテンショメータ位置 0..1
  ke?: number;                // モータ/ファン逆起電圧定数 V/(rad/s)
  kv?: number;                // モータ速度ゲイン rad/s/V
  maxCurrent?: number;        // 最大電流 A (battery, motor, fuse, incandescent, solenoid, relay)
  frequency?: number;         // 周波数 Hz (buzzer, speaker, clock)
  tripped?: boolean;          // バッテリ遮断状態
  blown?: boolean;            // ヒューズ溶断状態
  bindHardware?: string;      // 逆方向バインディング: ハードウェア部品名
  rce?: number;               // トランジスタ飽和抵抗
  capacitance?: number;       // 静電容量 F (capacitor)
  inductance?: number;        // インダクタンス H (inductor)
  initialVoltage?: number;    // コンデンサ初期電圧 V (capacitor)
  initialCurrent?: number;    // インダクタ初期電流 A (inductor)
  zenerVoltage?: number;      // ツェナー電圧 V (zenerDiode)
  darkResistance?: number;    // 暗抵抗 Ω (photoresistor)
  lightLevel?: number;        // 明るさ 0..1 (photoresistor)
  beta?: number;              // NTC beta定数 (thermistor)
  temperature?: number;       // 温度 ℃ (thermistor)
  pickupVoltage?: number;     // 動作電圧 V (relay, solenoid)
  mosfetKind?: 'N'|'P';       // MOSFETチャネル種別
  thresholdVoltage?: number;  // ゲートしきい値電圧 V (mosfet)
  rdsOn?: number;             // オン抵抗 Ω (mosfet)
  current?: number;           // 電流 A (currentSource)
  dutyCycle?: number;         // デューティ比 0..1 (clock)
  amplitude?: number;         // 振幅 V (clock)
  gain?: number;              // 利得 (opAmp)
  ratedPower?: number;        // 定格電力 W (incandescent, solenoid, speaker)
  outputResistance?: number;  // 出力抵抗 Ω (clock, opAmp)
}
```

---

## 5. 配線 (`WireData`)

```ts
interface WireData {
  id: string;           // 一意 ("w1", "w2"…)
  from: WireEndpoint;   // 始点
  to: WireEndpoint;     // 終点
}
interface WireEndpoint {
  componentId: string;  // 接続先コンポーネントの id
  pin: string;          // そのコンポーネントのピン名 (上表の通り)
}
```

- **方向性なし**（電気的には無方向）。`from`/`to` は配置順のみ。
- ローダーは **存在しない componentId またはピン名を含むワイヤを破棄** します。
- 同一 id のワイヤは最初のものだけ採用。

---

## 6. ハードウェアパーツ (`HardwarePartData`)

```ts
interface HardwarePartData {
  id: string;           // 一意 ("p1", "p2"…)
  name: string;         // 表示名＋**バインディングキー**（大文字小文字無視）
  kind: HardwarePartType; // 下表参照
  x: number;            // ワールド X (右正)
  y: number;            // ワールド Y (下正、地面付近 ≈ groundY)
  z: number;            // 奥行き (手前正、既定 0)
  angle: number;        // 回転角度 度 (時計回り正)
  w: number;            // 幅 (箱) または直径 (円系) — **最小 4**
  h: number;            // 高さ (箱) — 円系では無視、**最小 4**
  props: HardwareProps;
}
```

### 6.1 パーツ種類 (`HardwarePartType`)

| kind | 説明 | 代表的用途 | 既定 depth (Z厚) |
|------|------|------------|------------------|
| `board` | 板/梁 | フレーム、床、壁 | 24 |
| `chassis` | 車体フレーム | 車台 | 40 |
| `wheel` | 車輪/タイヤ | 移動用車輪 | 30 |
| `gear` | ギア | 歯車機構 | 26 |
| `propeller` | プロペラ | 推進、発電 | 12 |
| `wing` | 翼 | 揚力、飛行 | 20 |
| `axle` | 軸 | 車輪取り付け軸 | 16 |
| `duck` | アヒル | 浮遊物体 | 34 |
| `block` | ブロック | 重り、土台 | 50 |
| `deco` | 装飾 | 見た目用 | 40 |
| `plant` | 植物 | 見た目用 | 40 |
| `thruster` | スラスタ | 推力発生 | 30 |
| `ledBulb` | LED電球 | 回路LEDと連動発光 | 24 |
| `switchPad` | スイッチパッド | 回路スイッチと連動 | 22 |
| `speaker` | スピーカー | ブザー音連動 | 44 |
| `batteryPack` | バッテリパック | バッテリ残量表示 | 34 |
| `emitter` | パーティクル放出 | エフェクト | 26 |
| `water` | 水域 | 流体領域 (静的) | 120 |

> **電気的パーツ** (`ledBulb`, `switchPad`, `speaker`, `batteryPack`, `thruster`) は `props.boundComponent` で回路コンポーネントの `name` を指定して連動させる。

### 6.2 `HardwareProps` リファレンス

```ts
interface HardwareProps {
  material?: 'wood'|'steel'|'iron'|'acrylic'|'rubber'|'plastic'|'organic';
  color?: string;            // CSS色 (#rrggbb 等)
  isStatic?: boolean;        // 固定剛体にする (床、壁等)
  boundComponent?: string;   // 回路側の name と一致 (大文字小文字無視)
  direction?: number;        // 向きオフセット度 (thruster, ledBulb, emitter)
  force?: number;            // スラスタ推力係数
  rate?: number;             // エミッタ放出率 (個/秒)
  density?: number;          // water 密度 (既定 0.001)
  flowX?: number;            // water 流れ X
  flowY?: number;            // water 流れ Y
  teeth?: number;            // gear 歯数
  collisionR?: number;       // 円形パーツの衝突半径上書き
  depth?: number;            // Z方向厚み (省略時は kind 既定)
  meshId?: string;           // カスタムメッシュID (Part Studio で作成)
  v0?: { x: number; y: number }; // 初速度 px/s (データ座標系、Y下正)
  assist?: boolean;          // 飛行アシスト (weathervane)
  meta?: Record<string, unknown>; // 自由メタデータ
}
```

---

## 7. ジョイント (`JointData`)

```ts
interface JointData {
  id: string;              // 一意 ("j1", "j2"…)
  type: 'weld'|'pin'|'motor'|'slider';
  a: string;               // 側Aパーツ id (親/ステータ側)
  b: string;               // 側Bパーツ id (子/可動側)
  ax: number;              // Aローカル座標での接続点 X
  ay: number;              // Aローカル座標での接続点 Y
  bx: number;              // Bローカル座標での接続点 X
  by: number;              // Bローカル座標での接続点 Y
  props: JointProps;
}
```

### 7.1 タイプ別挙動

| type | 説明 | 典型用途 |
|------|------|----------|
| `weld` | 完全剛体結合 (同一ボディ化) | フレーム組み立て |
| `pin` | 自由ヒンジ (Z軸回転) | 車輪軸、関節 |
| `motor` | 駆動ヒンジ (回路 motor と連動) | 車輪駆動、ロボット関節 |
| `slider` | 直線拘束 (スライド) | ラック&ピニオン、シリンダ |

- **アンカー座標**: `ax,ay` はパーツAのローカル座標 (中心原点、回転前)。`bx,by` も同様。
- `weld` で結ばれたグループは **単一剛体** になり、内部で衝突しない。
- `pin`/`motor` で繋がった根は **衝突グループ分け** され、互いに衝突しなくなる。

### 7.2 `JointProps`

```ts
interface JointProps {
  boundComponent?: string; // motor: 回路 motor コンポーネント名
  kv?: number;             // motor 速度ゲイン (省略時は回路側から継承)
  maxAccel?: number;       // motor 角加速度制限 rad/s²
  minAngle?: number;       // pin/motor 角度下限 度 (相対角)
  maxAngle?: number;       // pin/motor 角度上限 度
  axis?: number;           // slider 軸方向 度 (0=+X)
  axis3d?: 'z'|'y';        // pin/motor 回転軸: 'z'(画面内) or 'y'(垂直/方位)
  ratio?: number;          // slider ラックピニオン: ラジアンあたり移動量
  driveBy?: string;        // slider を駆動する motor ジョイント id
  stiffness?: number;      // weld 剛性 0..1
}
```

---

## 8. カスタムメッシュ / Part Studio (`CustomMesh`)

```ts
interface CustomMesh {
  id: string;                // 一意
  name: string;              // 表示名
  base: 'plate'|'cylinder'|'sphere';
  w: number; h: number; depth: number; // 基本プリミティブ寸法
  segments: number;          // 分割数 (1..48)
  ops: DisplaceOp[];         // 変形スタンプ (最大 500)
  stl?: StlBlob;             // インポートSTL (base64)
}
interface DisplaceOp {
  x: number; y: number; z: number; // メッシュローカル座標
  radius: number;      // ブラシ半径
  strength: number;    // +で膨らみ, -で窪み (-200..200)
  falloff: number;     // 減衰指数 (0.5..6)
}
interface StlBlob {
  positions: string;     // Base64 LE Float32 (x,y,z × vertexCount)
  indices: string;       // Base64 LE Uint32 (三角形インデックス × 3)
  vertexCount: number;
  triangleCount: number;
}
```

- `meshId` をパーツの `props.meshId` に指定すると、その形状で置き換わる。
- STL は ASCII/バイナリ両対応。ローダーで頂点数 60M / インデックス 80M で打ち切り。

---

## 9. バリデーション / ローダーの挙動 (`parseProjectFile`)

`src/ui/io.ts` のローダーは以下を実施し、**致命的エラー時は例外を投げます**：

1. **JSONパース** 失敗 → `Not a valid JSON file.`
2. トップレベルがオブジェクトでない → `Project file must be a JSON object.`
3. **component.type** が既知29種以外 → 除外
4. **component.id** 重複/空 → 除外 (最初の1つ採用)
5. **wire** が存在しない componentId またはピン名を参照 → 除外
6. **part.kind** が既知18種以外 → 除外
7. **part.id** 重複/空 → 除外
8. **part.w / h** < 4 → 4 にクランプ
9. **joint.type** が 4種以外 → 除外
10. **joint.a/b** が存在しない part、または a===b → 除外
11. **有効な component または part が 1 つもない** → `File contains no valid components or parts.`
12. **カスタムメッシュ** は `base` が 3種以外、id重複、ops 500超などで除外
13. **STL** はサイズ上限で切り詰め

> **結果**: 修復済みの `ProjectData` (version=1 強制) が返る。元ファイルの不明フィールドは無視される。

---

## 10. バインディング (回路 ↔ ハードウェア)

- **双方向・名前ベース・大文字小文字無視** (`trim().toLowerCase()` で比較)
- ハードウェア側: `part.props.boundComponent = "回路コンポーネント名"`
- 回路側: `component.props.bindHardware = "ハードウェアパーツ名"`
- どちらか片方だけ指定してもリンク成立。
- インスペクタのドロップダウンは `bindingPools()` で自動生成される。

---

## 11. 完全な動作例: 「LED ランプ」

Space キーで押しボタン → LED 点灯。3D側に `ledBulb` と `switchPad` が同期。

```json
{
  "version": 1,
  "name": "LED Lamp",
  "groundY": 900,
  "circuit": {
    "components": [
      { "id": "c1", "name": "Battery", "type": "battery", "x": 100, "y": 160, "props": { "voltage": 9, "maxCurrent": 8 } },
      { "id": "c2", "name": "Switch", "type": "switchPush", "x": 240, "y": 160, "props": { "closed": false, "key": "Space" } },
      { "id": "c3", "name": "R1", "type": "resistor", "x": 380, "y": 160, "props": { "resistance": 220 } },
      { "id": "c4", "name": "Power LED", "type": "led", "x": 520, "y": 160, "props": { "forwardVoltage": 2, "color": "red" } },
      { "id": "c5", "name": "GND", "type": "ground", "x": 520, "y": 320, "props": {} }
    ],
    "wires": [
      { "id": "w1", "from": { "componentId": "c1", "pin": "+" }, "to": { "componentId": "c2", "pin": "A" } },
      { "id": "w2", "from": { "componentId": "c2", "pin": "B" }, "to": { "componentId": "c3", "pin": "A" } },
      { "id": "w3", "from": { "componentId": "c3", "pin": "B" }, "to": { "componentId": "c4", "pin": "A" } },
      { "id": "w4", "from": { "componentId": "c4", "pin": "K" }, "to": { "componentId": "c1", "pin": "-" } },
      { "id": "w5", "from": { "componentId": "c1", "pin": "-" }, "to": { "componentId": "c5", "pin": "G" } }
    ]
  },
  "hardware": {
    "parts": [
      { "id": "p1", "name": "Base", "kind": "board", "x": 600, "y": 890, "z": 0, "angle": 0, "w": 120, "h": 20, "props": { "material": "wood", "isStatic": true, "depth": 60 } },
      { "id": "p2", "name": "Lamp Bulb", "kind": "ledBulb", "x": 600, "y": 830, "z": 0, "angle": 0, "w": 20, "h": 26, "props": { "boundComponent": "Power LED", "depth": 24 } },
      { "id": "p3", "name": "Lamp Switch", "kind": "switchPad", "x": 660, "y": 870, "z": 0, "angle": 0, "w": 28, "h": 16, "props": { "boundComponent": "Switch", "depth": 22 } }
    ],
    "joints": [
      { "id": "j1", "type": "weld", "a": "p1", "b": "p2", "ax": 0, "ay": -60, "bx": 0, "by": 0, "props": {} },
      { "id": "j2", "type": "weld", "a": "p1", "b": "p3", "ax": 60, "ay": -20, "bx": 0, "by": 0, "props": {} }
    ],
    "meshes": []
  }
}
```

**座標メモ**:
- 回路: バッテリ(100,160) → スイッチ(240,160) → 抵抗(380,160) → LED(520,160) → GND(520,320)
- ハードウェア: Base を地面直上 (y=890) に固定。ledBulb を Base 上 60px (ay=-60) に溶接。switchPad を右横 20px 上 (ax=60, ay=-20) に溶接。

---

## 12. もう一つの例: モーター駆動風車 (モータージョイント)

回路: バッテリ + スライドスイッチ + モーター。ハードウェア: 土台 + プロペラを motor ジョイントで駆動。

```json
{
  "version": 1,
  "name": "Windmill",
  "groundY": 900,
  "circuit": {
    "components": [
      { "id": "c1", "name": "Battery", "type": "battery", "x": 100, "y": 200, "props": { "voltage": 12, "maxCurrent": 10 } },
      { "id": "c2", "name": "Power Switch", "type": "switchSlide", "x": 250, "y": 200, "props": { "closed": false, "key": "KeyW" } },
      { "id": "c3", "name": "Wind Motor", "type": "motor", "x": 400, "y": 200, "props": { "resistance": 2, "ke": 1, "maxCurrent": 5 } },
      { "id": "c4", "name": "GND", "type": "ground", "x": 400, "y": 350, "props": {} }
    ],
    "wires": [
      { "id": "w1", "from": { "componentId": "c1", "pin": "+" }, "to": { "componentId": "c2", "pin": "A" } },
      { "id": "w2", "from": { "componentId": "c2", "pin": "B" }, "to": { "componentId": "c3", "pin": "+" } },
      { "id": "w3", "from": { "componentId": "c3", "pin": "-" }, "to": { "componentId": "c1", "pin": "-" } },
      { "id": "w4", "from": { "componentId": "c1", "pin": "-" }, "to": { "componentId": "c4", "pin": "G" } }
    ]
  },
  "hardware": {
    "parts": [
      { "id": "p1", "name": "Tower", "kind": "board", "x": 600, "y": 700, "z": 0, "angle": 0, "w": 30, "h": 300, "props": { "material": "steel", "isStatic": true, "depth": 30 } },
      { "id": "p2", "name": "Propeller", "kind": "propeller", "x": 600, "y": 580, "z": 0, "angle": 0, "w": 160, "h": 160, "props": { "material": "plastic", "depth": 12 } }
    ],
    "joints": [
      { "id": "j1", "type": "motor", "a": "p1", "b": "p2", "ax": 0, "ay": -120, "bx": 0, "by": 0, "props": { "boundComponent": "Wind Motor", "maxAccel": 40 } }
    ],
    "meshes": []
  }
}
```

- `axis3d: 'z'` (既定) で画面内回転。垂直回転が必要なら `axis3d: 'y'`。
- `maxAccel` で急激な加速を抑制。

---

## 13. AI生成時のチェックリスト

| 項目 | 確認内容 |
|------|----------|
| **一意な id** | `c1..`, `w1..`, `p1..`, `j1..`, `mesh1..` 等、各配列内で重複なし |
| **name の一意性** | バインディング用なので、回路・ハードウェア間で**同名を使わない**（大文字小文字無視） |
| **ピン名の正確さ** | 表 4.1 のピン名 (`+`, `-`, `A`, `K`, `IN1`, `OUT` 等) をタイポなく |
| **kind / type のスペル** | 既知リスト完全一致 (ケースセンシティブ) |
| **w, h ≥ 4** | 4 未満はローダーで 4 にされるが、意図しない小ささに注意 |
| **joint アンカー整合** | `ax,ay` は A のローカル中心基準。`weld` なら Bの中心が A上のどこにあるか計算 (`dx,dy` を A角度で逆回転) |
| **groundY とパーツ y** | 動くパーツは `groundY` より十分上 (例: 800〜880)。`isStatic: true` の床は groundY 付近 |
| **motor ジョイント** | `boundComponent` が回路側 `motor` タイプの `name` と一致 |
| **バインディング名** | `ledBulb.boundComponent = "LED名"`, `switchPad.boundComponent = "Switch名"` 等 |
| **最小構成** | 回路コンポーネント ≥1 またはハードウェアパーツ ≥1 (両方ゼロは拒否) |

---

## 14. 検証方法 (開発者向け)

生成した JSON を即座に検証するには、プロジェクト内で：

```bash
# 1. リポジトリで依存インストール済みなら
npx tsx -e "
import { parseProjectFile } from './src/ui/io';
import fs from 'fs';
const txt = fs.readFileSync('generated.schemachine.json', 'utf8');
try { const p = parseProjectFile(txt); console.log('OK:', p.name, p.circuit.components.length, 'comps,', p.hardware.parts.length, 'parts'); }
catch(e) { console.error('FAIL:', e.message); process.exit(1); }
"
```

またはブラウザで **Load** ボタンから選択 → トーストで成功/失敗表示。

---

## 15. 補足: 既存機能の確認

> **JSON保存/読み込み機能はすでに実装済み** です (`src/ui/io.ts`, `src/ui/App.tsx` のツールバー Save/Load、localStorage 自動保存)。テスト (`npm run test:headless`) で全プリセットのラウンドトリップ検証済み (181 passed, 0 failed)。追加実装は不要です。このガイドを使って AI が `.schemachine.json` を生成し、ユーザーが Load するだけで動作します。

---

**作成日**: 2025-09-19  
**対象バージョン**: SCHEMACHINE `version: 1` (CURRENT_VERSION = 1)