# kanachain

`kanachain`は、バイト列をブロック間でもつながるしりとりへ変換する「Kana Chain Block Code / 仮名チェーンブロック符号（KCBC）」の実装です。npmパッケージ、PyPIパッケージ、デモサイトを1つのリポジトリで管理します。現在のフォーマットはアルゴリズム版1・辞書版1（`A1/D1`）です。

## リポジトリの構成

| パス          | 内容                              |
| ------------- | --------------------------------- |
| `packages/js` | npmパッケージ `@mujuko/kanachain` |
| `packages/py` | PyPIパッケージ `kanachain`        |
| `apps/demo`   | デモサイト（Cloudflare Workers）  |
| `dictionary`  | 辞書の入力・生成物・出典          |
| `scripts`     | 辞書生成と符号表の配置            |
| `test`        | 辞書生成パイプラインの検証        |
| `vectors`     | JS・Python共通のテストベクタ      |
| `SPEC.md`     | A1/D1のフォーマット仕様           |

## デモ

https://kanachain.mujuko.workers.dev

変換はすべてブラウザ内で行われ、入力はどこにも送信されません。

## 試す

```console
npx @mujuko/kanachain serialize --text "こんにちは、KCBC" --output message.kana
npx @mujuko/kanachain deserialize --input message.kana --as-text
```

Pythonでも同じことができます。

```console
pipx run kanachain serialize --text "こんにちは、KCBC"
```

保存用の標準出力は、サイズを抑えるため単語をASCII空白で区切ります。全角空白で表示する場合は`--pretty`を付けます。ファイルも往復できます。

```console
npx @mujuko/kanachain serialize --input photo.png --output photo.kana
npx @mujuko/kanachain deserialize --input photo.kana --output restored.png
```

符号表では読みをひらがなに正規化します。出典の見出しがカタカナだけの語は符号化結果でもカタカナ表示しますが、復号時はひらがなとカタカナを区別しません。

両実装は同じ符号表と同じフォーマットを使うため、片方で符号化した列をもう片方で復号できます。`vectors/a1d1.json`の共通テストベクタで、フレーム写像と4モードの正規出力が一語単位で一致することを検証しています。

### JavaScript API

符号化と復号のメソッド名は、しりとりの「尻」にかけて`serialize` / `deserialize`としています。

```js
import { createKanaChainBlockCode } from "@mujuko/kanachain";

const codec = await createKanaChainBlockCode();
const serialized = codec.serialize("こんにちは");
const deserialized = codec.deserialize(serialized.text);
```

文字列を渡すとUTF-8、UTF-16LE、それぞれのDEFLATE表現を比較し、実際のKCBC出力語数が最少になるものを採用します。`Uint8Array`を渡した場合は任意バイナリとしてrawとDEFLATEだけを比較します。復号結果の`data`は常に`Uint8Array`です。

### Python API

```python
from kanachain import create_kana_chain_block_code

codec = create_kana_chain_block_code()
serialized = codec.serialize("こんにちは")
deserialized = codec.deserialize(serialized.text)
```

## A1/D1の概要

フォーマットの完全な定義は[SPEC.md](SPEC.md)にあります。

1. 入力のraw、DEFLATE、テキストならUTF-16LE候補も作る
2. `algorithmVersion`、`dictionaryVersion`、modeの3 bytesを先頭へ付ける
3. ストリームを最大18 bytesずつに分け、各ブロックへCRC-16/CCITT-FALSEを付ける
4. 第1ブロックの開始かなを同ブロックのCRCから67状態へ分散する
5. 通常ブロックを35語、最終ブロックを最大35語のしりとりへ写す
6. 128個の冗長なrank候補から、ブロック内に同じ語がなく、語長の種類が偏らない経路を選ぶ
7. 完成した4モード候補から、総語数を最優先に正規出力を選ぶ

現在の辞書は通常語2,748語、`ん`終端語428語、状態67個です。35語の通常経路は開始かなに応じて201〜207 bit、35語の終端経路は198〜204 bitの容量があります。

保存形式の改行は正式なブロック境界です。改行のない単語列からも35語ごとに境界を復元できます。UIでは文字列自体へ改行を足さず、CSSなどのソフトラップで表示だけを折り返します。通常ブロックの語数、ブロック間の接続、ブロック内の重複を検証し、データ整合性はブロックごとのCRC-16で判定します。このため破損位置をブロック番号で報告できます。

APIとエラーメッセージのブロック番号は0始まりです。

単語の再利用はブロックをまたぐ場合だけ許可し、同じブロック内では禁止します。`もも`や`まま`のように先頭と末尾が同じ語も候補にできます。辞書順と接続関係が符号表そのものなので、辞書を変更すると過去の符号列との互換性は失われます。

## 開発

```console
npm ci
npm test                 # JSの符号器と辞書パイプライン
npm run test:py          # Pythonの符号器と共通ベクタ
npm run test:cross       # JS/Pythonの正規出力一致と相互復号
npm run dev --workspace kanachain-demo
```

辞書を変更したら`npm run sync:codebook`で各パッケージへ符号表を配置し、
符号列の期待値が変わる場合は`npm run build:vectors`でテストベクタを作り直します。

### リリース

`v`で始まるタグを打つと、npm公開、PyPI公開、デモの本番デプロイが走ります。
どちらのレジストリもTrusted Publishing（OIDC）を使うため、APIトークンを
Secretsへ置く必要はありません。デプロイには`CLOUDFLARE_API_TOKEN`と
`CLOUDFLARE_ACCOUNT_ID`が必要です。

mainへのpushではデモの開発環境だけが更新されます。

辞書の再生成は国立国語研究所への通信を伴うため、通常のCIからは分離して
`Regenerate dictionary`ワークフローの手動実行にしています。

## 辞書生成パイプライン

辞書の入力・生成物・管理主体は [dictionary/README.md](dictionary/README.md) に整理しています。標準の更新順序は次のとおりです。

```console
python scripts/dictionary/generate.py
npm run sync:codebook
npm run build:vectors
```

スクリプトは取得元のSHA-256を照合し、入力が同じならバイト単位で同じ生成物を作ります。`dictionary/05-output/dictionary.json`は完全manifest（schemaVersion 2）、配布用codebookとパッケージ内codebookは互換性のためschemaVersion 1です。

## 出典とライセンス

ワードプールには、国立国語研究所がCC BY 4.0で公開する教育語彙データだけを使用します。帰属表示は[dictionary/licenses/NINJAL-EDUCATIONAL-BASIC-VOCABULARY.md](dictionary/licenses/NINJAL-EDUCATIONAL-BASIC-VOCABULARY.md)に収録しています。

- 教育基本語彙データベース（2009A）: https://mmsrv.ninjal.ac.jp/brfvep/kyoikukihongoi_2009A.csv
  - SHA-256: `ee003f2d98acbb4642e70f032cc04b5501361aabfabc1d603439935b878f3829`
- 日本語教育基本語彙データベース: https://mmsrv.ninjal.ac.jp/brfvep/rokusyutaisyo.csv
  - SHA-256: `80f190abebfe5fdfc52aec06a6c9c842eb4b1ff25b6687f135547a81902607af`

現在のJLPTは語彙・漢字・文法項目の公式一覧を公開していないため、非公式の「JLPT単語リスト」は採用根拠にしていません。
