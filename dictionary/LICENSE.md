# 辞書のライセンス

リポジトリのソースコードはMIT Licenseですが、この`dictionary/`ディレクトリの生成物は
別のライセンスに従います。

## 生成物（CC BY 4.0）

次のファイルは、国立国語研究所がCC BY 4.0で公開する教育語彙データベースから
語を選定・加工した二次的著作物です。原ライセンスを継承し、
**Creative Commons Attribution 4.0 International (CC BY 4.0)** で提供します。

- `05-output/dictionary.json`
- `02-candidates/source-pool.tsv`
- `03-selection/auto-selected-readings.tsv`
- `03-selection/unreviewed-readings.tsv`
- `02-candidates/rule-exclusions/*.txt`
- `04-analysis/capacity-by-state.tsv`
- `03-selection/excluded-readings.tsv`

帰属表示の詳細は[licenses/NINJAL-EDUCATIONAL-BASIC-VOCABULARY.md](licenses/NINJAL-EDUCATIONAL-BASIC-VOCABULARY.md)にあります。

## 人手入力（MIT）

次のファイルは作者が書いたものであり、リポジトリ本体と同じMIT Licenseです。
ただし記載された読み自体は上記データベースに由来します。

- `01-input/inclusions/manual.txt`
- `01-input/exclusions/sensitive.txt`
- `01-input/exclusions/uncommon.txt`
- `01-input/exclusions/confusable-groups.csv`

## 再配布パッケージ

npmおよびPyPIで配布する`codebook.json`は`05-output/dictionary.json`から抽出した部分集合であり、
同じくCC BY 4.0です。各パッケージにはこの帰属表示を同梱します。
