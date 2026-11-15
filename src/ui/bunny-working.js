/**
 * The little hopping bunny shown while Bunny works, with a word that matches the step
 * ("Nibbling src/app.js…", "Thumping npm run build…") and a timer. When something fails
 * it thumps its foot and gets grumpy for a moment, like a real bunny.
 */

export const WORDS = {
  waiting: ['Bunnying', 'Hopping', 'Hippity-hopping', 'Ear-perking', 'Nose-twitching', 'Bunny-brained', 'Bunnifying',
    'Charming the compiler', 'Sweet-talking the server', 'Being adorable', 'Doing it with love', 'Fluffing', 'Zooming'],
  thinking: ['Binkying', 'Bunnysplaining', 'Whisker-wiggling', 'Snuggling the code', 'Nose-twitching', 'Bunny-brained'],
  reading: ['Nibbling', 'Sniffing around', 'Burrowing into', 'Whisker-wiggling at'],
  searching: ['Sniffing around for', 'Burrowing for', 'Nose-twitching after'],
  running: ['Thumping', 'Hopping to', 'Zooming through'],
  writing: ['Bunnifying', 'Carrot-crunching', 'Fluffing up'],
  browsing: ['Hopping over to', 'Peeking at', 'Ear-perking at'],
  helping: ['Calling the other bunnies for', 'Sending a bunny to'],
  failed: ['Thumping at that error', 'Huffing', 'Puffing', 'Pouting', 'Sulking', 'Ears-back mode', 'Glaring at the compiler',
    'Side-eyeing the server', 'Counting to ten', 'Not mad, just disappointed', '"I\'m fine."', 'Hmph', 'Foot-stomping'],
  slow: ['Tapping her foot', 'Giving the model the silent treatment', 'Counting to ten', 'Hmph'],
  asking: ['Waiting… (arms crossed)'],
  retry: ['Asking nicely, one more time'],
  fallback: ['Not speaking to that model'],
};

const pick = (list, not) => {
  const options = list.length > 1 ? list.filter((w) => w !== not) : list;
  return options[Math.floor(Math.random() * options.length)];
};

/** What kind of step a tool line is ("Read src/app.js" is reading), and what it is about. */
export function moodOf(tool) {
  const text = String(tool ?? '').replace(/^.* › /, '').trim();
  const [verb] = text.split(/\s+/);
  const rest = text.slice(verb.length).trim().replace(/^["']|["']$/g, '');
  const kind = /^(Read|List|Open|Look|Show|Get|Inspect|Check)/i.test(verb) ? 'reading'
    : /^(Search|Find|Grep)/i.test(verb) ? 'searching'
      : /^(Run|Start|Stop|Install|Build|Test)/i.test(verb) ? 'running'
        : /^(Write|Edit|Create|Make|Delete|Rename|Save|Update)/i.test(verb) ? 'writing'
          : /^(Browse|Navigate|Visit|Click|Type|Scroll|Press|Screenshot)/i.test(verb) ? 'browsing'
            : /^(Helper|Ask(ed)? a helper|Delegate)/i.test(verb) ? 'helping'
              : 'waiting';
  return { kind, about: rest.length > 42 ? `${rest.slice(0, 41)}…` : rest };
}

export function createWorking(start = 'waiting') {
  const el = document.createElement('div');
  el.className = 'bunny-working';
  el.setAttribute('role', 'status');
  el.innerHTML = '<svg class="bunny-mark" viewBox="0 0 24 24" aria-hidden="true">'
    + '<ellipse class="ear" cx="8.5" cy="6" rx="2.2" ry="5.5" transform="rotate(-12 8.5 6)"/>'
    + '<ellipse class="ear" cx="15.5" cy="6" rx="2.2" ry="5.5" transform="rotate(12 15.5 6)"/>'
    + '<circle class="face" cx="12" cy="15" r="7"/>'
    + '<circle class="eye" cx="9.5" cy="14" r="1"/><circle class="eye" cx="14.5" cy="14" r="1"/>'
    + '<circle class="nose" cx="12" cy="16.6" r=".9"/></svg>'
    + '<span class="bunny-word"></span><span class="bunny-time">0s</span>';
  const word = el.querySelector('.bunny-word');
  const time = el.querySelector('.bunny-time');
  const began = Date.now();
  let kind = start;
  let about = '';
  let lastEvent = Date.now();
  let lastChange = 0;
  let grumpyUntil = 0;

  const show = (text) => {
    if (word.textContent === text) return;
    word.classList.add('is-swapping');
    setTimeout(() => { word.textContent = text; word.classList.remove('is-swapping'); }, 180);
  };
  const say = () => {
    const base = pick(WORDS[kind] ?? WORDS.waiting, word.textContent.replace(/ .*|…$/g, ''));
    show(base.includes('…') ? base : `${base}${about ? ` ${about}` : ''}…`);
    lastChange = Date.now();
  };

  const timer = setInterval(() => {
    const secs = Math.round((Date.now() - began) / 1000);
    time.textContent = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
    if (Date.now() < grumpyUntil) return;
    if (el.classList.contains('is-grumpy')) { el.classList.remove('is-grumpy'); kind = 'waiting'; about = ''; say(); return; }
    // Nothing has happened for a while: the model is slow, and the bunny lets you know.
    if (Date.now() - lastEvent > 25_000 && kind !== 'slow' && kind !== 'asking') { kind = 'slow'; about = ''; say(); return; }
    // A long step keeps its kind; only the playful word changes now and then.
    if (Date.now() - lastChange > 4000 && kind !== 'asking') {
      if (kind === 'fallback' || kind === 'retry') { kind = 'waiting'; about = ''; }
      say();
    }
  }, 1000);

  say();
  return {
    el,
    /** A new step or state: 'thinking', 'asking', 'retry', 'fallback', or a tool line. */
    set(next, detail = '') {
      lastEvent = Date.now();
      if (Date.now() < grumpyUntil) return;
      if (next === 'tool') ({ kind, about } = moodOf(detail));
      else { kind = next; about = detail; }
      say();
    },
    /** Something went wrong: a foot-thump, flattened ears and a grumpy word for a few seconds. */
    thump(detail = '') {
      lastEvent = Date.now();
      kind = 'failed';
      about = detail;
      grumpyUntil = Date.now() + 3500;
      el.classList.remove('is-thumping');
      void el.offsetWidth; // restart the thump
      el.classList.add('is-thumping', 'is-grumpy');
      say();
    },
    /** Words arrived: the model is alive again. */
    alive() { lastEvent = Date.now(); if (kind === 'slow') { kind = 'waiting'; say(); } },
    stop() { clearInterval(timer); el.remove(); },
  };
}
