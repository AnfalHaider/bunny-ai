/**
 * W4-13b: the Thinking choice. Which providers take a request field for how hard a model thinks, and what to send. Only providers whose field is
 * known are listed (the Researcher's note, docs/research/thinking-params.md): for any other provider the choice is not offered at all.
 *
 * The levels are the ones every model of that provider takes (Cerebras and Kimi have no "medium"; some models cannot be switched off, so there is no
 * "Off"). "Default" sends nothing. A model that still refuses the field is asked again without it (see refusesThinking in chat.js).
 */
export const THINKING_LEVELS = ['low', 'medium', 'high'];

const effort = (level) => ({ reasoning_effort: level });
const CONTROLS = new Map([
  ['openai', { levels: THINKING_LEVELS, body: effort }],
  ['google', { levels: THINKING_LEVELS, body: effort }],
  ['openrouter', { levels: THINKING_LEVELS, body: (level) => ({ reasoning: { effort: level } }) }],
  ['groq', { levels: THINKING_LEVELS, body: effort }],
  ['xai', { levels: THINKING_LEVELS, body: effort }],
  ['deepseek', { levels: THINKING_LEVELS, body: effort }], // DeepSeek maps medium to high itself
  ['together', { levels: THINKING_LEVELS, body: effort }], // Together maps low and medium to high itself
  ['fireworks', { levels: THINKING_LEVELS, body: effort }],
  ['cerebras', { levels: ['low', 'high'], body: effort }],
  ['moonshot', { levels: ['low', 'high'], body: effort }],
]);

/** The levels a person may choose for this provider ([] when the provider's field is not known). */
export const thinkingLevels = (providerId) => CONTROLS.get(String(providerId))?.levels ?? [];

/** The fields to add to the request, or null (Default, an unknown provider, or a level the provider does not take). */
export function thinkingBody(providerId, level) {
  const control = CONTROLS.get(String(providerId));
  if (!control || !control.levels.includes(level)) return null;
  return control.body(level);
}
