/**
 * A copy of src/providers/thinking.js for the page (the browser can only import from src/ui); test/thinking.test.js keeps the two equal.
 * Which providers take a request field for how hard a model thinks (the Thinking choice in a model's Details), and which levels.
 */
export const THINKING_LEVELS = ['low', 'medium', 'high'];

const KNOWN = new Map([
  ['openai', THINKING_LEVELS], ['google', THINKING_LEVELS], ['openrouter', THINKING_LEVELS], ['groq', THINKING_LEVELS], ['xai', THINKING_LEVELS],
  ['deepseek', THINKING_LEVELS], ['together', THINKING_LEVELS], ['fireworks', THINKING_LEVELS], ['cerebras', ['low', 'high']], ['moonshot', ['low', 'high']],
]);

/** The levels a person may choose for this provider ([] when the provider's field is not known: the choice is then not shown). */
export const thinkingLevels = (providerId) => KNOWN.get(String(providerId)) ?? [];
