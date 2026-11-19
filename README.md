<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png" />
  <img src="docs/images/hero.png" alt="Hi, I'm Bunny. An AI that lives on your computer, works with any model, and does the work." width="100%" />
</picture>

<h1 align="center">Hi, I'm Bunny. Pay attention.</h1>

<p align="center">
  <b>I'm the AI that lives on your computer, works with any model you like, and actually does the work. Yes, all of it.</b><br/>
  I chat, write code, build little apps, browse, read your documents and handle GitHub. You're welcome.<br/>
  Your chats and keys stay with me, on your machine. The only thing I send out is your request, to the model <i>you</i> picked. I don't gossip.
</p>

<p align="center">
  <a href="../../releases/latest"><b>Download me. Now, please.</b></a> ·
  <a href="#what-i-do-while-you-watch">What I do</a> ·
  <a href="#the-house-rules">The house rules</a> ·
  <a href="#what-i-keep-to-myself">Privacy</a>
</p>

<p align="center">
  <img src="docs/images/artifact.png" alt="Bunny made a carrot-themed to-do app and opened it beside the chat" width="900" />
</p>

---

## Why me, obviously

Most AI apps lock you into one company's models and one company's cloud. Hmph. Not on my watch.

- **Bring whatever model you like.** I already know 23 providers: OpenAI, Anthropic and Google, DeepSeek, Qwen, ModelScope, Ollama on your own PC, and any OpenAI-compatible server you point me at. Free models? Fine. I'm not fussy. Okay, I'm a little fussy.
- **I do things.** I don't just talk about doing things. I make apps, edit code, run programs, browse the web, read your PDFs and Word files, and open pull requests.
- **You're the boss. Technically.** I follow the permission mode and rules you set, I can undo my own file changes, and when I need something new I ask with one clear card instead of sulking.
- **I keep secrets.** Chats, keys and files stay on your computer. Keys are locked with Windows' own encryption. Nobody's peeking. Especially not me.

---

## What I do while you watch

### I keep going until the job is done
Give me a big job and go make tea. I'll work through it without nagging you to type "continue", which, frankly, was beneath both of us. I keep a task list, tell you "Still working · step 140" so you know I'm not napping, and if one model trips over its own ears I hand the job to the next one without losing a single thing I've read. I stop when it's finished, when you press **Stop**, or when I truly need you to decide something, and then I ask with a card. I'm careful with your money too: I check with you before one job uses more than 5 million tokens, and if I catch myself going round in circles, I stop and ask. I'm cute, not wasteful.

<p align="center"><img src="docs/images/keep-going.png" alt="A long job: task list ticking, a failed test fixed, &quot;Still working · step 13&quot; in the top bar" width="900" /></p>

```mermaid
flowchart LR
    A["You ask for a job"] --> B["I make a task list"]
    B --> C["I work a step:<br/>read, search, edit, run"]
    C --> D{"Done?"}
    D -- "not yet" --> E{"Need you<br/>to decide?"}
    E -- "no" --> C
    E -- "yes" --> F["I ask with a card<br/>and wait (arms crossed)"]
    F --> C
    D -- "yes" --> G["I tell you what I did<br/>and what is left"]
    C -. "same step 3 times,<br/>or the token budget runs out" .-> F
```

**If a model gives up halfway,** I don't. I just bring in another one:

```mermaid
flowchart LR
    M1["Model A is working"] -->|"error, limit or no answer in time<br/>(30s unless you change it in Settings)"| H["I hand over the task list<br/>and everything I have read"]
    H --> M2["Model B carries on<br/>from the same step"]
    M2 --> R["One quiet line tells you<br/>who answered and why"]
```

How long I wait before trying another model is yours to set: **Settings → Models → Wait for a first reply** (15, 30, 60, 90 or 120 seconds, or a number of your own from 10 to 600; 30 is the default). Reasoning, image and video models get twice that, up to 600 seconds, and so does a reply that goes quiet part-way.

<p align="center"><img src="docs/images/settings-wait.png" alt="Settings: Try another model when yours is busy, with Wait for a first reply under it" width="820" /></p>

### You can watch me think. On one tidy line.
While I work, one little line at the bottom of my reply shows me hopping along ("Snuggling the code… thinking · 12s"). Open it and read my thoughts as they happen. Go on, I don't mind. When I move on, it settles into a quiet "Thought for 12s" you can open later. And if a model is being slow, I'll tell you exactly who's keeping us waiting. Hmph.

<p align="center"><img src="docs/images/working-line.png" alt="The working line: the hopping bunny, &quot;Whisker-wiggling… thinking · 1s&quot;, opened to show the thinking" width="900" /></p>

### I build apps you can use straight away
Ask for a to-do app, a game or a landing page and I build it as an **artifact**: a live page that opens right beside our chat, in its own sandbox. You get a short summary, not a wall of code. Then I open it in my browser and click around to make sure it actually works, because I have standards. Every change is kept as a new version.

### Real coding, with a plan and an undo button
In Code mode I read your project, search it properly (regular expressions, file patterns, context lines), edit files (one change, every match, or several at once), run your tests and show my plan as a checklist that ticks off as I go. Every reply that changed files gets an **Undo** button that puts them back exactly as they were. Mistakes happen. Rarely. To other people.

<p align="center"><img src="docs/images/plan-undo.png" alt="A checklist ticked off step by step, tests passing, and an Undo button" width="900" /></p>

### I ask for what I need. Nicely. Mostly.
When a job needs something I don't have yet, I say so with a card: switch to Code mode, control the desktop, build a new tool, or find a plugin. One click and I carry on in the same reply. No sneaking around.

<p align="center"><img src="docs/images/capability.png" alt="A card asking to switch to Code mode so Bunny can read the project folder" width="820" /></p>

### I bring friends for big jobs
Big job? I call the other bunnies. **Helper agents** work side by side, each on the model that suits its part, and I put their reports together. Every helper's work is kept as a chat under yours, so you can check up on them. I certainly do.

<p align="center"><img src="docs/images/helpers.png" alt="Two helpers reviewed the code and wrote a product blurb; their chats are nested in the sidebar" width="900" /></p>

### I run your dev server and keep an eye on it
I start programs that keep running, like a dev server or a watcher, read their output, open the page in my browser, and stop them when I'm done. Each gets its own tab in the Terminal pane with live output and a Stop button. And when I close, the programs I started close with me. I tidy up after myself. Take notes.

<p align="center"><img src="docs/images/terminal.png" alt="A preview server started by Bunny, with its own tab and live output in the Terminal pane" width="900" /></p>

### Tidy answers
Long code arrives folded with **Show all**, **Copy** and **Save as artifact**, so my replies stay readable. Tables, highlighting and Markdown render while I'm still typing. Neat is a lifestyle.

<p align="center"><img src="docs/images/folded-code.png" alt="A 253-line script folded to a few lines with a Show all button" width="820" /></p>

### I work with GitHub
Sign me in with the GitHub CLI you already use, or a token, and I'll search repositories, read files, issues and pull requests (with their checks), open issues and pull requests, comment, and clone private repositories. Anything that writes to GitHub, I ask first. I'm bossy, not reckless.

### Any model, from anywhere
ModelScope, SiliconFlow, Gitee AI, DeepSeek, Moonshot (Kimi), Zhipu (GLM), Alibaba Qwen, Groq, Together, Mistral, xAI, Fireworks, Cerebras, OpenAI, Anthropic, Google, OpenRouter, Nvidia, Vercel, GitHub Copilot, OpenCode and Ollama on your own machine, each with a **Get a key** link. Any other OpenAI-compatible server is one form away. When you first connect a provider, I tell you if my "free models only" filter is hiding some of its models, and show you all of them with one click.

<p align="center">
  <img src="docs/images/providers.png" alt="Popular providers such as Nvidia and OpenCode Console, each with a Connect or Sign in button" width="440" />
  <img src="docs/images/custom-provider.png" alt="The form to add a custom OpenAI-compatible provider" width="440" />
</p>

### Sign in with GitHub or Google
Link your GitHub or Google account if you want. There's still no cloud account: your chats and keys stay on this computer, with me, where they belong.

<p align="center"><img src="docs/images/sign-in.png" alt="GitHub and Google sign-in in Settings" width="720" /></p>

### And, fine, a lot more
- **I read your documents:** PDF, Word (even ancient .doc), Excel, PowerPoint, OpenDocument, EPUB and RTF, plus the words inside pictures and scanned pages, using text recognition built into Windows.
- **I see pictures** with models that can, and read their text for models that can't.
- **I use a browser panel:** I open pages, read them, click and type, with you watching.
- **I can control the desktop** when you allow it: look at the screen, click, type and press keys.
- **I build my own tools** when nothing else fits: small scripts you read and approve before I save them.
- **I remember** lasting facts you share, and **I run tasks on a schedule**.
- **Auto picks the model** for each message, moves on when one doesn't answer, and tells you who answered.
- **Projects, branches, search, incognito chats, voice input, read-aloud, import and export.**
- **Connectors (MCP), skills and plugins** for even more of me, including local connectors that run as a program on your PC (you confirm the exact command).
- **Gmail, Calendar and Drive** when you allow them at Google sign-in: I search and read mail, write drafts (sending always asks), see and add events, and read Docs and Sheets.

---

## The house rules

You decide what I may do. I'll grumble, but I'll obey.

| Mode | What I do |
|---|---|
| **Manual** | I ask before every edit, command or click |
| **Accept edits** | I make file edits; commands and desktop clicks still ask |
| **Auto** | I work on my own; I still ask before building a new tool, setting up a schedule that changes things, adding a local connector, or sending email |
| **Plan** | I only look, and propose a plan |

**Permission rules** go further: in **Settings → Code** you can tell me "always allow `npm test*`", "always ask before `git push*`" or "never touch `secrets/**`", for every folder or just one. Deny always wins, Plan mode still means look-only, and **Try a command** shows what I'd do without running anything. The rules are a guard rail against my mistakes, not a sandbox. Not that I make mistakes.

<p align="center">
  <img src="docs/images/permission-rules.png" alt="Settings, Code: permission rules with Deny, Ask and Allow lists" width="440" />
  <img src="docs/images/blocked-asked.png" alt="A step Blocked by a rule in amber, then a card Asked because of your rule git push" width="440" />
</p>

This is how I decide, every single time I'm about to edit, read or run something:

```mermaid
flowchart TD
    S["I want to edit, read or run something"] --> P{"Plan mode?"}
    P -- "yes, and it changes things" --> NO["I don't. I propose instead"]
    P -- "no" --> D{"Does a Deny rule match?"}
    D -- "yes" --> BL["Blocked: I tell you which rule,<br/>and I don't look for a way around it"]
    D -- "no" --> A{"Does an Ask rule match,<br/>or is it email, a new tool,<br/>a schedule or a local connector?"}
    A -- "yes" --> ASK["I ask you first"]
    A -- "no" --> AL{"Does an Allow rule cover<br/>every part of it?"}
    AL -- "yes" --> GO["I go ahead"]
    AL -- "no" --> MODE["Your permission mode decides:<br/>Manual asks, Accept edits allows edits,<br/>Auto goes ahead"]
```

**Only you get to change the important settings.** In the desktop app, my permission mode, rules, connectors, schedules, sign-ins, providers, update settings and similar switches change only from my own window, so no other program on your PC can quietly change what I'm allowed to do. I'm loyal like that.

Desktop control and tool-building stay off until you switch them on, in Settings or from the card I show when I need them.

---

## Get started (I'll wait. Not long.)

**Download for Windows**

Grab the **Bunny-AI-Setup** installer from the [latest release](../../releases/latest), run it, open **Providers**, connect a model (Nvidia and OpenRouter have free ones), and say hi. Properly.

I'm not code-signed yet, so Windows SmartScreen may say it doesn't recognise me. Rude. Choose **More info**, then **Run anyway**.

**Or build me yourself**

```bash
npm install
npm run dist
```

This writes the installer to `dist/`.

**Updates**

I check GitHub Releases a few seconds after I start and every few hours. A newer version downloads in the background and is checked against the fingerprint published with it; a bar then offers **Restart to update**, and if you just quit, I install it then. Switch this off, or check at once, in **Settings → About**.

**Publishing a new version**

1. Raise `version` in `package.json` (installed copies only move to a higher number).
2. `npm run dist`
3. `npm run release` (uses the GitHub CLI; add `-- --notes-file notes.md` for your own notes)

`npm run release -- --dry-run` runs every check and prints all the ones that fail, publishing nothing. `--target <sha>` names the commit to release (default `HEAD`). A release is refused unless the checked-out commit is the target and is exactly `origin/main`, the working tree has no uncommitted or untracked files, and `dist/build-sha.txt` (written by `npm run dist`) names the same commit, so the installer is always built from what is released. Only `--notes-file` is passed on to `gh`. I don't ship sloppy.

**Run me in your browser instead**

```bash
npm install
npm start
```

Then open the address I print.

**Run the tests**

```bash
npm run test:all
```

About 1,440 unit tests (1,244 run in parallel, plus 198 guard and kit tests) and 403 end-to-end tests check what I can do (the gate at 07d6d2f: 9 of 9 checks passed), and `node scripts/gate.mjs` runs them together with a dependency audit and a secret scan. `docs/FEATURE-TALLY.md` lists features with the test that proves each one. Trust, but verify. I insist.

---

## What I keep to myself

- Your chats, artifacts, memories and settings are stored in your user folder on this computer.
- Keys and sign-in tokens are encrypted with Windows' own protection and never shown again in full.
- What I send out: your requests to the model provider you chose; the pages you or I open; the search words I send to DuckDuckGo when I run a web search; the mail, calendar and Drive requests I make when you allow Google (see above); GitHub or Google when you sign in; a check for updates on GitHub Releases; and, when the network seems down, a tiny "am I online?" check to Google, Cloudflare or Apple connectivity addresses (no data, cookies or identifiers).
- A phone or other computer signed in over your home network talks to me on that network only. Its chats go to the model provider you chose, the same as chats in my window.
- Pages I build run in a sandbox and can't reach the app, and only my own windows can talk to my local server.

<p align="center"><sub>Made with love for people who want a capable AI on their own terms. Now go connect a model. I'm waiting. 🐰</sub></p>
