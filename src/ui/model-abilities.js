/**
 * What each model can do, which job a message is, and which model Auto picks.
 *
 * Abilities come from the provider where it says (OpenRouter publishes input and
 * output modalities) and from the model's name otherwise. "Runs here" is separate
 * from "can": Bunny talks to providers through the chat API, so a model only
 * counts for image / video / speech when its output comes back through chat.
 * Pure functions, no DOM: the server can use them too.
 */
export const JOBS = {
  chat: { label: 'Chat', hint: 'Talk, write, explain', icon: 'message' },
  code: { label: 'Code', hint: 'Models strong at coding and tools', icon: 'code' },
  image: { label: 'Image', hint: 'Make or edit pictures', icon: 'photo' },
  video: { label: 'Video', hint: 'Make short clips', icon: 'movie' },
  see: { label: 'See', hint: 'Understand images and screenshots', icon: 'eye' },
  research: { label: 'Research', hint: 'Long answers with web sources', icon: 'world' },
  speech: { label: 'Speech', hint: 'Writes it, then speaks it with a Windows voice', icon: 'volume' },
};

const has = (re, s) => re.test(s);

/** { abilities: Set<job>, utility: boolean, runs: Set<job> } */
export function modelAbilities(m) {
  const id = `${m.id} ${m.displayName ?? ''}`.toLowerCase();
  const out = new Set((m.outputModalities ?? []).map(String));
  const inp = new Set((m.inputModalities ?? []).map(String));
  const abilities = new Set();
  const runs = new Set();

  // Not chat models at all: embeddings, rerankers, safety classifiers, reward models.
  if (has(/embed|rerank|retriever|guard|safety|moderation|reward|nv-?clip|\bclip\b|parse|ocdr|detector|-pii|nemoretriever/, id)) {
    return { abilities, utility: true, runs };
  }

  const makesImage = out.has('image') || has(/flux|stable-diffusion|\bsdxl\b|\bsd3|sana|imagen|dall-?e|-image\b|image-gen|nano-banana/, id);
  // Video makers only: cosmos-reason understands video, and "inkling" is not Kling.
  const makesVideo = out.has('video')
    || (has(/\bvideo-?gen|cosmos-?(predict|transfer)|\bwan-?2|\bveo-?\d|\bsora\b|\bkling\b/, id) && !has(/reason/, id));
  const makesSpeech = out.has('audio') || has(/\btts\b|text-to-speech|fastpitch|magpie|lyria|-audio\b/, id);
  if (makesImage) { abilities.add('image'); if (out.has('image')) runs.add('image'); }
  if (makesVideo) abilities.add('video');
  if (makesSpeech) abilities.add('speech');

  // Pure generators (an image or video model without text output) are not chat models.
  const pureGenerator = (makesImage || makesVideo || makesSpeech) && !out.has('text') && (out.size > 0 || !has(/gemini|gpt|omni/, id));
  if (!pureGenerator) {
    abilities.add('chat'); runs.add('chat');
    abilities.add('research'); runs.add('research');
    // Speech runs through any chat model: it writes the words, a Windows voice says them.
    abilities.add('speech'); runs.add('speech');
    if (inp.has('image') || has(/vision|[-_.]vl\b|\bvl[-_]|llava|vila|pixtral|omni|gemma-?[34]|llama-?3\.2-(11|90)b|llama-?4|phi-?[34].*vision|qwen.*vl|gpt-4o|gpt-[45]|gemini|claude|nemotron.*vl|kimi-k2/, id)) {
      abilities.add('see'); runs.add('see');
    }
    if (has(/cod(e|er|estral|ing)|starcoder|devstral|deepseek|qwen-?[23]|qwen.*coder|kimi|glm|gpt-|claude|gemini|mistral-large|nemotron-?(super|ultra)|llama-?(3\.[13]|4)|gpt-oss|minimax|grok/, id)) {
      abilities.add('code'); runs.add('code');
    }
  }
  return { abilities, utility: false, runs };
}

/** How good a model is likely to be for a job (bigger is better). Heuristic, explainable. */
export function scoreModel(m, job) {
  const id = String(m.id).toLowerCase();
  let score = 0;
  const size = Number(/(\d+(?:\.\d+)?)\s?b\b/.exec(id)?.[1] ?? 0);
  score += Math.min(size, 700) / 10;                       // parameters
  if (m.contextLength) score += Math.min(m.contextLength, 1_000_000) / 100_000;
  const families = [
    [/gpt-5|claude|gemini-?3|gemini-.*pro|grok-?4/, 40],
    [/gemini|gpt-4|deepseek-v[34]|kimi-k2|qwen-?3|glm-?[45]|mistral-large|llama-?4|nemotron-?(super|ultra)|minimax/, 28],
    [/llama-?3\.[13]-70b|gemma-?[34]|qwen-?2\.5|mixtral|gpt-oss/, 16],
  ];
  for (const [re, bonus] of families) if (re.test(id)) { score += bonus; break; }
  if (job === 'code' && /cod(e|er|estral)|devstral|qwen.*coder/.test(id)) score += 15;
  if (job === 'research' && /reason|think|r1|pro|ultra|super/.test(id)) score += 8;
  if (job === 'image' && /pro|gpt-5/.test(id)) score += 6;
  if (/mini|nano|lite|small|tiny|flash-lite|\b[1-8]b\b/.test(id)) score -= 8;
  if (m.free) score += 2;                                  // a tie goes to the free one
  return score;
}

/** The job a message most likely is. */
export function detectJob(text, { hasImage = false, workMode = 'chat' } = {}) {
  const t = String(text ?? '').toLowerCase();
  if (/\b(video|clip|animation|animate|movie|reel)\b/.test(t) && /\b(make|create|generate|render|produce)\b/.test(t)) return 'video';
  if (/\b(say|speak|read( this)? aloud|voice ?over|text to speech|narrat)/.test(t) && /\b(audio|voice|aloud|speech|narrat)/.test(t)) return 'speech';
  if (/\b(draw|sketch|paint|illustrat|logo|icon|poster|wallpaper|picture|image|photo|render|artwork)\b/.test(t)
    && /\b(make|create|generate|draw|design|paint|give me|produce|render)\b/.test(t)) return 'image';
  if (hasImage) return 'see';
  if (workMode === 'code' || /```|\b(code|function|bug|error|stack trace|refactor|typescript|javascript|python|sql|regex|compile|api|class|repo)\b/.test(t)) return 'code';
  if (/\b(research|latest|news|today|current|sources?|compare|look up|search( the)? (web|internet)|find out)\b/.test(t)) return 'research';
  return 'chat';
}

/** Models ordered best-first for a job; only ones that can actually run it here. */
export function rankModels(models, job) {
  return models
    .filter((m) => !m.unavailable)
    .filter((m) => modelAbilities(m).runs.has(job))
    .map((m) => ({ m, s: scoreModel(m, job) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

/** Which jobs have at least one model that can see it through here. */
export function jobAvailability(models) {
  const out = {};
  for (const job of Object.keys(JOBS)) {
    const capable = models.filter((m) => !m.unavailable && modelAbilities(m).abilities.has(job));
    const runnable = capable.filter((m) => modelAbilities(m).runs.has(job));
    out[job] = { capable: capable.length, runnable: runnable.length };
  }
  return out;
}
