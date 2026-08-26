# kanachain

任意のバイト列を、ブロックをまたいでつながる日本語のしりとりへ可逆変換します。
符号方式は **Kana Chain Block Code / 仮名チェーンブロック符号（KCBC）**、
現在のフォーマット識別子は `A1/D1` です。

```console
npm install @mujuko/kanachain
```

## CLI

```console
npx @mujuko/kanachain serialize --text "こんにちは、KCBC"
npx @mujuko/kanachain serialize --input photo.png --output photo.kana
npx @mujuko/kanachain deserialize --input photo.kana --output restored.png
npx @mujuko/kanachain info
```

## API

符号化と復号のメソッド名は、しりとりの「尻」にかけて `serialize` / `deserialize` としています。

```js
import { createKanaChainBlockCode } from "@mujuko/kanachain";

const codec = await createKanaChainBlockCode();

const serialized = codec.serialize("こんにちは");
console.log(serialized.text); // CRC付きブロックごとに改行されたしりとり

const deserialized = codec.deserialize(serialized.text);
console.log(new TextDecoder().decode(deserialized.data)); // こんにちは
```

文字列を渡すとUTF-8、UTF-16LE、それぞれのDEFLATE表現を比較し、出力語数が最少に
なるものを採用します。`Uint8Array`を渡した場合は任意バイナリとしてrawとDEFLATEだけを
比較します。復号結果の`data`は常に`Uint8Array`です。

出力の改行は正式なブロック境界ですが、改行のない単語列からも35語ごとに境界を
復元できます。復号時はひらがなとカタカナを区別しません。

## 実行環境

Node.js 22以降のほか、ブラウザ、Cloudflare Workers、Deno、Bunで動きます。
バイト列は`Uint8Array`、ハッシュ検証はWeb Cryptoを使い、Node固有のAPIには
依存しません。圧縮はNodeでは`node:zlib`、ブラウザでは`fflate`を使います。

バンドル済みの符号表を直接渡すこともできます。

```js
import { createKanaChainBlockCode } from "@mujuko/kanachain";
import codebook from "@mujuko/kanachain/codebook.json";

const codec = await createKanaChainBlockCode({ codebook });
```

## 仕様と辞書

フォーマット仕様、辞書の生成パイプライン、採用根拠は
[リポジトリ](https://github.com/mujuko/kanachain)にあります。

辞書を変更すると過去の符号列との互換性は失われます。`codebook.json`の
`codebookSha256`が符号表の同一性を示します。

## ライセンス

コードはMIT。同梱する`codebook.json`は国立国語研究所のCC BY 4.0データに由来します。
[NOTICE.md](NOTICE.md)を参照してください。
