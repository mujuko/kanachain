# kanachain

任意のバイト列を、ブロックをまたいでつながる日本語のしりとりへ可逆変換します。
符号方式は **Kana Chain Block Code / 仮名チェーンブロック符号（KCBC）**、
現在のフォーマット識別子は `A1/D1` です。依存パッケージはありません。

```console
pip install kanachain
```

## CLI

```console
kanachain serialize --text "こんにちは、KCBC"
kanachain serialize --input photo.png --output photo.kana
kanachain deserialize --input photo.kana --output restored.png
kanachain info
```

## API

符号化と復号のメソッド名は、しりとりの「尻」にかけて `serialize` / `deserialize` としています。

```python
from kanachain import create_kana_chain_block_code

codec = create_kana_chain_block_code()

serialized = codec.serialize("こんにちは")
print(serialized.text)
# CRC付きブロックごとに改行されたしりとり

deserialized = codec.deserialize(serialized.text)
print(deserialized.data.decode("utf-8"))  # こんにちは
```

`str`を渡すとUTF-8、UTF-16LE、それぞれのDEFLATE表現を比較し、出力語数が最少に
なるものを採用します。`bytes`を渡した場合は任意バイナリとしてrawとDEFLATEだけを
比較します。復号結果の`data`は常に`bytes`です。

出力の改行は正式なブロック境界ですが、改行のない単語列からも35語ごとに境界を
復元できます。復号時はひらがなとカタカナを区別しません。

同じ符号表を使うJavaScript実装（npm: `kanachain`）と相互運用できます。
両実装は`vectors/a1d1.json`の同じテストベクタを検証します。

## 仕様と辞書

フォーマット仕様、辞書の生成パイプライン、採用根拠は
[リポジトリ](https://github.com/mujuko/kanachain)にあります。

## ライセンス

コードはMIT。同梱する`codebook.json`は国立国語研究所のCC BY 4.0データに由来します。
[NOTICE.md](NOTICE.md)を参照してください。
