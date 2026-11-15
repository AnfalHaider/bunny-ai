/**
 * The greeting on a fresh chat: playful, bunny-flavoured, with the person's name, and
 * matched to the time of day. {name} is what they asked Bunny to call them.
 */

export const GREETINGS = {
  morning: [
    'Good morning, {name}. The carrots are fresh and so is my memory.',
    'Morning, {name}! I\'ve been binkying since sunrise.',
    'Rise and hop, {name}.',
    'Morning, {name}. Coffee for you, dandelions for me.',
  ],
  afternoon: [
    'Good afternoon, {name}. Ears up, ready to go.',
    'Hey {name}, what are we burrowing into today?',
    'Afternoon, {name}. I promise not to chew the cables.',
  ],
  evening: [
    'Good evening, {name}. One more thing before the burrow?',
    'Evening, {name}. Let\'s make something before snack time.',
    'Hi {name}. The moon\'s out and so are my ears.',
  ],
  night: [
    'Still up, {name}? Me too. Bunnies are crepuscular, you know.',
    'Burning the midnight carrot, {name}?',
    'It\'s late, {name}. Let\'s be quick and then sleep.',
  ],
  anytime: [
    'Hop in, {name}. What\'s on your mind?',
    '{name}! You came back. I didn\'t thump at all while you were gone.',
    'Whiskers twitching, {name}. Give me something to do.',
    'Ready when you are, {name}. Carrot-powered and caffeine-free.',
    'What are we making today, {name}?',
  ],
  grumpy: [
    'Oh, it\'s you, {name}. Fine. What do you need? (Just kidding.)',
    '{name}. I\'ve been waiting. *thump*',
  ],
};

export const TAGLINES = [
  'Pick a model, then tell me what you need.',
  'Ask anything: code, plans, ideas, carrots.',
  'Type below. I\'ll do the hopping.',
];

/** One greeting and one tagline. random() is injectable so tests can pin the choice. */
export function pickGreeting({ name, hour = new Date().getHours(), random = Math.random } = {}) {
  const who = String(name ?? '').trim() || 'friend';
  const time = hour < 5 || hour >= 23 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  // Mostly the time of day; sometimes an any-time line; rarely a grumpy one.
  const roll = random();
  const pool = roll < 0.05 ? GREETINGS.grumpy : roll < 0.35 ? GREETINGS.anytime : GREETINGS[time];
  const line = pool[Math.floor(random() * pool.length) % pool.length];
  const title = line.replaceAll('{name}', who);
  // Shown as a short headline (the first sentence) and the rest as a softer line, so long
  // greetings do not wrap into a ragged block. Hyphenated words never break at the hyphen.
  const keep = (s) => s.replace(/(\p{L})-(\p{L})/gu, '$1‑$2');
  const cut = title.search(/[.!?](\s|$)/);
  const head = cut > 0 && cut < title.length - 1 ? title.slice(0, cut + 1) : title;
  return {
    title,
    head: keep(head),
    rest: keep(title.slice(head.length).trim()),
    tagline: TAGLINES[Math.floor(random() * TAGLINES.length) % TAGLINES.length],
  };
}
