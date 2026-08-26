function floorLog2(value) {
  if (value <= 0n)
    throw new RangeError("floorLog2 requires a positive integer");
  return value.toString(2).length - 1;
}

function edges(words, states, terminal) {
  const grouped = new Map(states.map((state) => [state, []]));
  for (const word of words) {
    const letters = [...word];
    grouped.get(letters[0]).push({ word, tail: letters.at(-1), terminal });
  }
  return grouped;
}

export class PathCodec {
  constructor({ normalWords, terminalWords, states, maximumWords = 35 }) {
    this.states = [...states];
    this.maximumWords = maximumWords;
    this.normalEdges = edges(normalWords, states, false);
    this.terminalEdges = edges(terminalWords, states, true);
    this.normalCounts = [new Map(states.map((s) => [s, 1n]))];
    this.terminalCounts = [new Map(states.map((s) => [s, 0n]))];
    for (let w = 1; w <= maximumWords; w += 1) {
      const normal = new Map();
      const terminal = new Map();
      for (const state of states) {
        normal.set(
          state,
          this.normalEdges
            .get(state)
            .reduce((sum, e) => sum + this.normalCounts[w - 1].get(e.tail), 0n),
        );
        terminal.set(
          state,
          w === 1
            ? BigInt(this.terminalEdges.get(state).length)
            : this.normalEdges
                .get(state)
                .reduce(
                  (sum, e) => sum + this.terminalCounts[w - 1].get(e.tail),
                  0n,
                ),
        );
      }
      this.normalCounts.push(normal);
      this.terminalCounts.push(terminal);
    }
  }
  normalPathCount(words, state) {
    return this.normalCounts[words]?.get(state) ?? 0n;
  }
  pathCount(words, state) {
    return this.terminalCounts[words]?.get(state) ?? 0n;
  }
  normalCapacityBitsFor(words, state) {
    const n = this.normalPathCount(words, state);
    return n ? floorLog2(n) : 0;
  }
  capacityBitsFor(words, state) {
    const n = this.pathCount(words, state);
    return n ? floorLog2(n) : 0;
  }
  #rankRaw(words, startState, normal) {
    const total = normal
      ? this.normalPathCount(words.length, startState)
      : this.pathCount(words.length, startState);
    if (!total) throw new Error("path is outside the dictionary graph");
    let rank = 0n;
    let state = startState;
    for (let i = 0; i < words.length; i += 1) {
      const all =
        normal || i < words.length - 1
          ? this.normalEdges.get(state)
          : [...this.normalEdges.get(state), ...this.terminalEdges.get(state)];
      let found = false;
      for (const edge of all) {
        let completions;
        if (edge.terminal) completions = i === words.length - 1 ? 1n : 0n;
        else {
          const remaining = words.length - i - 1;
          completions = normal
            ? this.normalPathCount(remaining, edge.tail)
            : this.terminalCounts[remaining].get(edge.tail);
        }
        if (!completions) continue;
        if (edge.word === words[i]) {
          found = true;
          state = edge.tail;
          break;
        }
        rank += completions;
      }
      if (!found)
        throw new Error(
          `word ${i + 1} (${words[i]}) is invalid; expected a dictionary word beginning with ${state}`,
        );
    }
    if (!normal && !words.at(-1).endsWith("ん"))
      throw new Error("path does not end with a terminal word");
    return {
      rank,
      wordCount: words.length,
      startState,
      endState: state,
      endWord: words.at(-1),
      characters: words.reduce((n, w) => n + [...w].length, 0),
    };
  }
  #unrankRaw(rank, wordCount, startState, normal) {
    const total = normal
      ? this.normalPathCount(wordCount, startState)
      : this.pathCount(wordCount, startState);
    if (rank < 0n || rank >= total)
      throw new RangeError(`path rank ${rank} is outside 0..${total - 1n}`);
    let residual = rank;
    let state = startState;
    const words = [];
    for (let i = 0; i < wordCount; i += 1) {
      const all =
        normal || i < wordCount - 1
          ? this.normalEdges.get(state)
          : [...this.normalEdges.get(state), ...this.terminalEdges.get(state)];
      let picked = null;
      for (const edge of all) {
        let completions;
        if (edge.terminal) completions = i === wordCount - 1 ? 1n : 0n;
        else {
          const remaining = wordCount - i - 1;
          completions = normal
            ? this.normalPathCount(remaining, edge.tail)
            : this.terminalCounts[remaining].get(edge.tail);
        }
        if (!completions) continue;
        if (residual < completions) {
          picked = edge;
          break;
        }
        residual -= completions;
      }
      if (!picked) throw new Error("internal error while unranking path");
      words.push(picked.word);
      state = picked.tail;
    }
    return {
      words,
      wordCount,
      startState,
      endState: state,
      endWord: words.at(-1),
      characters: words.reduce((n, w) => n + [...w].length, 0),
    };
  }
  rankNormal(words, state) {
    return this.#rankRaw(words, state, true);
  }
  unrankNormal(rank, words, state) {
    return this.#unrankRaw(rank, words, state, true);
  }
  rank(words, state) {
    return this.#rankRaw(words, state, false);
  }
  unrank(rank, words, state) {
    return this.#unrankRaw(rank, words, state, false);
  }
}

export { floorLog2 };
