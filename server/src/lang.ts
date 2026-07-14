/**
 * Tiny language heuristics used by the mocks, the demo and TTS routing when
 * the client does not declare a language. Good enough to route Japanese
 * replies to VOICEVOX; real deployments can always pass an explicit lang.
 */

/** Hiragana, Katakana and CJK unified ideographs. */
const JA_CHARS = /[぀-ヿ一-鿿]/;

/** Guess "ja" or "en" from the characters in `text`. */
export function guessLang(text: string): string {
  return JA_CHARS.test(text) ? "ja" : "en";
}

/** Primary language subtag, lower-cased ("ja-JP" -> "ja"). */
export function normalizeLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const primary = lang.split(/[-_]/)[0];
  return primary ? primary.toLowerCase() : undefined;
}
