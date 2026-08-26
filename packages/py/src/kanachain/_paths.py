"""Raw path counts and rank/unrank for Algorithm 1."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass


@dataclass(frozen=True)
class Path:
    words: list[str]
    word_count: int
    start_state: str
    end_state: str
    end_word: str
    rank: int = 0


class PathCodec:
    def __init__(self, normal_words, terminal_words, states, maximum_words=35):
        self.states = list(states)
        self.state_index = {s: i for i, s in enumerate(self.states)}
        self.maximum_words = maximum_words
        self.normal = {s: [] for s in states}
        self.terminal = {s: [] for s in states}
        for w in normal_words:
            self.normal[w[0]].append((w, w[-1]))
        for w in terminal_words:
            self.terminal[w[0]].append((w, w[-1]))
        self.normal_counts = [{s: 1 for s in states}]
        self.terminal_counts = [{s: 0 for s in states}]
        for n in range(1, maximum_words + 1):
            self.normal_counts.append(
                {
                    s: sum(self.normal_counts[n - 1][t] for _, t in self.normal[s])
                    for s in states
                }
            )
            self.terminal_counts.append(
                {
                    s: (
                        len(self.terminal[s])
                        if n == 1
                        else sum(
                            self.terminal_counts[n - 1][t] for _, t in self.normal[s]
                        )
                    )
                    for s in states
                }
            )
        self.normal_index = {
            s: {w: i for i, (w, _) in enumerate(self.normal[s])} for s in states
        }
        self.terminal_index = {
            s: {w: i for i, (w, _) in enumerate(self.terminal[s])} for s in states
        }
        self.normal_prefix = [[{} for _ in states] for _ in range(maximum_words + 1)]
        self.terminal_prefix = [[{} for _ in states] for _ in range(maximum_words + 1)]
        for n in range(1, maximum_words + 1):
            for si, s in enumerate(states):
                p = []
                total = 0
                for _, t in self.normal[s]:
                    total += self.normal_counts[n - 1][t]
                    p.append(total)
                self.normal_prefix[n][si] = p
                q = []
                total = 0
                choices = self.terminal[s] if n == 1 else self.normal[s]
                for _, t in choices:
                    total += 1 if n == 1 else self.terminal_counts[n - 1][t]
                    q.append(total)
                self.terminal_prefix[n][si] = q

    def normal_path_count(self, n, s):
        return self.normal_counts[n].get(s, 0)

    def path_count(self, n, s):
        return self.terminal_counts[n].get(s, 0)

    def normal_capacity_bits_for(self, n, s):
        return self.normal_path_count(n, s).bit_length() - 1

    def capacity_bits_for(self, n, s):
        return self.path_count(n, s).bit_length() - 1

    def _rank(self, words, start, normal):
        n = len(words)
        total = (
            self.normal_path_count(n, start) if normal else self.path_count(n, start)
        )
        if not total:
            raise ValueError("path is outside the dictionary graph")
        rank = 0
        state = start
        for i, actual in enumerate(words):
            remaining = n - i
            si = self.state_index[state]
            if normal or remaining > 1:
                idx = self.normal_index[state].get(actual)
                if idx is None:
                    raise ValueError(f"word {i + 1} ({actual}) is invalid")
                prefix = (self.normal_prefix if normal else self.terminal_prefix)[
                    remaining
                ][si]
                rank += prefix[idx - 1] if idx else 0
                state = self.normal[state][idx][1]
            else:
                idx = self.terminal_index[state].get(actual)
                if idx is None:
                    raise ValueError(f"word {i + 1} ({actual}) is invalid")
                prefix = self.terminal_prefix[1][si]
                rank += prefix[idx - 1] if idx else 0
                state = self.terminal[state][idx][1]
        if not normal and not words[-1].endswith("ん"):
            raise ValueError("path does not end with a terminal word")
        return Path(list(words), n, start, state, words[-1], rank)

    def _unrank(self, rank, n, start, normal):
        total = (
            self.normal_path_count(n, start) if normal else self.path_count(n, start)
        )
        if rank < 0 or rank >= total:
            raise ValueError("path rank is outside the path space")
        words = []
        state = start
        residual = rank
        for i in range(n):
            remaining = n - i
            si = self.state_index[state]
            if normal or remaining > 1:
                prefix = (self.normal_prefix if normal else self.terminal_prefix)[
                    remaining
                ][si]
                idx = bisect_right(prefix, residual)
                before = prefix[idx - 1] if idx else 0
                word, tail = self.normal[state][idx]
            else:
                prefix = self.terminal_prefix[1][si]
                idx = bisect_right(prefix, residual)
                before = prefix[idx - 1] if idx else 0
                word, tail = self.terminal[state][idx]
            residual -= before
            words.append(word)
            state = tail
        return Path(words, n, start, state, words[-1])

    def rank_normal(self, words, state):
        return self._rank(words, state, True)

    def unrank_normal(self, rank, n, state):
        return self._unrank(rank, n, state, True)

    def rank(self, words, state):
        return self._rank(words, state, False)

    def unrank(self, rank, n, state):
        return self._unrank(rank, n, state, False)
