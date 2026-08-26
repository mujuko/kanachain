# 辞書パイプライン

`01-input` だけを人が編集し、`02-candidates` から `05-output` までは生成ツールが更新します。番号はデータフローの順序です。

| 段階            | 役割                                               | 管理主体         | 編集 |
| --------------- | -------------------------------------------------- | ---------------- | ---- |
| `01-input`      | 手動追加と除外判断                                 | 人               | 可   |
| `02-candidates` | 外部ソースから抽出した候補と構造ルールの不合格結果 | generator        | 禁止 |
| `03-selection`  | 自動選定、未確認、除外の結果                       | generator        | 禁止 |
| `04-analysis`   | 開始かなごとの容量分析                             | generator        | 禁止 |
| `05-output`     | 完全manifestと配布元codebook                       | generator / sync | 禁止 |

`LICENSE.md` と `licenses/` はデータフロー外の出典・ライセンス文書です。生成ツールは `scripts/dictionary/` にあります。

## データフロー

1. 固定した国立国語研究所の教育語彙データを取得し、SHA-256を検証する。
2. 名詞、語彙配当、読みの長さ、文字種、接続可能性で候補を抽出する。
3. 教育資料の収録数による自動選定に手動追加を合わせ、除外入力を差し引く。
4. しりとりグラフを閉じ、35語の通常ブロックと最大35語の最終ブロックを構成できることを検証する。
5. レポートと完全manifestを生成し、そこから配布用codebookを同期する。

最終的な語集合は `(auto-selected + manual inclusions) - exclusions` です。自動選定では教育基本語彙7資料中3資料以上、かつ日本語教育基本語彙6資料中2資料以上を必要とし、2文字語だけは後者を3資料以上に強化します。ルールは `scripts/dictionary/rules.py` の名前付きPython述語として管理します。

## 人が編集する入力

| ファイル                                    | 用途                                        |
| ------------------------------------------- | ------------------------------------------- |
| `01-input/inclusions/manual.txt`            | 自動選定を通らないが採用する語。1行1読み    |
| `01-input/exclusions/sensitive.txt`         | センシティブなため除外する読み。1行1語      |
| `01-input/exclusions/uncommon.txt`          | 一般的でないため除外する読み。1行1語        |
| `01-input/exclusions/confusable-groups.csv` | 聞き分けにくい読み。1行1グループの可変列CSV |

手動追加語はUTF-8の1行1読みです。空行と `#` から始まるコメント行は無視します。

```text
# 弱い開始かなを補う語
ぱすた
```

`confusable-groups.csv` はヘッダーなしで、たとえば `ほや,ぼや,ほうわ,ほら` と記載します。手動追加と除外が重複した場合は生成エラーです。

除外する読みは外部のraw sourceに存在するものだけを記録します。現在の構造ルールで候補に入らない読みも、将来候補になり得るなら除外入力へ残せます。

## 自動生成されるファイル

| ファイル                                  | 用途                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `02-candidates/source-pool.tsv`           | 全候補、根拠、自動選定の不合格理由、最終statusを持つ台帳         |
| `02-candidates/rule-exclusions/*.txt`     | 構造ルールごとの不合格読み。1行1読み、重複なし、非空ファイルのみ |
| `03-selection/auto-selected-readings.tsv` | 自動選定された読み                                               |
| `03-selection/unreviewed-readings.tsv`    | 自動選定にも手動判断にも該当しない読み                           |
| `03-selection/excluded-readings.tsv`      | 除外理由、グループ、入力位置、候補への収録有無                   |
| `04-analysis/capacity-by-state.tsv`       | 開始かな別の保証容量と語数。容量の小さい順                       |
| `05-output/dictionary.json`               | 採用根拠と来歴を含む完全manifest                                 |
| `05-output/codebook.json`                 | ランタイムが読む符号表の抜粋。各パッケージへの同期元             |

完全manifestは `schemaVersion: 2` です。`dictionaryVersion` は符号上の辞書版、`codebookSha256` は順序付きの語だけから求めた互換性ハッシュ、`buildSha256` と `buildInputs` は生成全体の再現性を表します。配布codebookはランタイム互換性のため `schemaVersion: 1` を維持します。

## 再生成

リポジトリのルートで次の順に実行します。

```console
python scripts/dictionary/generate.py
npm run sync:codebook
npm run build:vectors
```

`generate.py` は入力が同じならバイト単位で同じ生成物を作ります。符号表の内容が変わらず `codebookSha256` が同じなら、共通ベクタの再生成は省略できます。

構造ルール除外は `minimum-2-characters.txt` のようにルール名ごとに出力します。1つの読みが複数ルールに失敗した場合は該当するすべてのファイルへ掲載し、失敗する読みがないルールのファイルは作りません。再生成時にはこのディレクトリ内の生成済み `.txt` を清掃します。
