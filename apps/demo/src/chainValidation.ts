export type WordPosition = { blockIndex: number; wordIndex: number; word: string };
export type ChainBreak = { before: WordPosition; after: WordPosition };

export function normalizeReading(value: string): string {
  return [...value.normalize("NFC")]
    .map((character) =>
      character >= "ァ" && character <= "ヶ"
        ? String.fromCodePoint(character.codePointAt(0)! - 0x60)
        : character,
    )
    .join("");
}

export function findChainBreak(blocks: readonly (readonly string[])[]): ChainBreak | null {
  let before: WordPosition | null = null;
  for (const [blockIndex, block] of blocks.entries()) {
    for (const [wordIndex, word] of block.entries()) {
      const after = { blockIndex, wordIndex, word };
      if (before) {
        const beforeReading = [...normalizeReading(before.word)];
        const afterReading = [...normalizeReading(after.word)];
        if (beforeReading.length && afterReading.length && beforeReading.at(-1) !== afterReading[0]) {
          return { before, after };
        }
      }
      before = after;
    }
  }
  return null;
}
