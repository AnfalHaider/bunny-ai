/**
 * Suggesting memories from a chat.
 *
 * A memory is something the person wants carried into later chats. The app
 * can suggest candidates from what was said, but it must never add one on its
 * own: a wrong memory is worse than none, so every suggestion waits for a
 * person to accept it.
 *
 * The patterns are deliberately plain. They look for the things people say
 * about themselves, and they do not guess.
 */

/** @typedef {{text: string, reason: string}} Suggestion */

/** @type {Array<{pattern: RegExp, reason: string, make: (match: RegExpMatchArray) => string}>} */
const PATTERNS = [
  {
    pattern: /\bmy name is ([A-Z][\w'-]{1,30}(?: [A-Z][\w'-]{1,30})?)/i,
    reason: 'you said your name',
    make: (m) => `My name is ${m[1]}`,
  },
  {
    pattern: /\bi(?:'m| am) called ([A-Z][\w'-]{1,30})/i,
    reason: 'you said what you are called',
    make: (m) => `I am called ${m[1]}`,
  },
  {
    pattern: /\bi (?:live|work|study) in ([A-Z][\w' -]{2,40})/,
    reason: 'you said where you are',
    make: (m) => `I live in ${m[1].trim()}`,
  },
  {
    pattern: /\bi work (?:at|for) ([A-Z][\w&' -]{2,40})/,
    reason: 'you said where you work',
    make: (m) => `I work at ${m[1].trim()}`,
  },
  {
    pattern: /\bi (?:prefer|like|always use) ([^.,!?\n]{3,60})/i,
    reason: 'you said what you prefer',
    make: (m) => `I prefer ${m[1].trim()}`,
  },
  {
    pattern: /\bi (?:don'?t like|dislike|hate) ([^.,!?\n]{3,60})/i,
    reason: 'you said what you do not like',
    make: (m) => `I do not like ${m[1].trim()}`,
  },
  {
    pattern: /\bremember that ([^.,!?\n]{3,80})/i,
    reason: 'you asked for it to be remembered',
    make: (m) => m[1].trim(),
  },
];

/**
 * Look for memories in a transcript.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Suggestion[]}
 */
export function suggestMemories(messages) {
  const out = [];
  const seen = new Set();

  for (const message of messages ?? []) {
    if (message.role !== 'user') continue;
    const content = String(message.content ?? '');
    for (const { pattern, reason, make } of PATTERNS) {
      const match = content.match(pattern);
      if (!match) continue;
      const text = make(match).trim();
      if (!text || text.length < 4) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, reason });
    }
  }
  return out.slice(0, 10);
}
