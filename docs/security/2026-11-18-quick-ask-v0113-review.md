# Quick ask v0.1.13 review (Security): Esc cc2bc3e and theme and fonts 43ced06, PASS for both

Branch claude/builder-c-v0113-quickask, based on 1b43ec2. I read the shell diff for e17b971..43ced06. On an extract of 43ced06 with an invented profile, `quick-ask` and `quick-ask-redesign` pass 25 of 25.

## Esc, cc2bc3e: PASS

- Main still takes Esc (`before-input-event`, `preventDefault`) and sends one message with no data, `quickask:esc`. If sending fails, the bar closes at once. Otherwise a 600 ms timer closes it unless the bar answers.
- `quickask:escHandled` clears the timer only if `fromBar(event)` passes. `quickask:close` returns `{ok:false}` to anyone else. A stranger can neither stop the close nor close the bar.
- The preload adds three functions and one listener, and passes no arguments through.
- **Limit, accepted:** the bar's own page can always answer "handled". So Esc relies on the bar page not being hostile. It is Bunny's own `file://` page under `script-src 'self'`, and answers are rendered as text, so model output cannot run script there. Clicking away still hides the bar.

## Theme and fonts, 43ced06: PASS

- `quickask:init` returns data only when `fromBar` passes. `barLook()` sends only:
  - a theme from a fixed list;
  - an interface-font key from a fixed list;
  - motion as `reduced` or nothing;
  - a model name stripped to `[A-Za-z0-9 ._:+/-]`, last path part, at most 60 characters.
  A failure returns `{}`. No other setting crosses, keys included.
- The bar checks the key again (`Object.hasOwn(FONT_STACKS, ...)`) and builds `@font-face` only from its own table of family names and file names. Main's text never reaches CSS or a URL. The model line is set with `textContent`.
- The CSP adds only `font-src 'self'`. On a `file://` page, Chromium lets 'self' cover local files. The page also has `default-src 'none'` and no `connect-src`, so a loaded font cannot be sent anywhere. Nothing new can leave.
- a64b527 (the redesign, read for the shell parts): `quickask:open` with the target `settings` comes after the `fromBar` check, and only brings Bunny's window forward on Providers.

Verdict: PASS at cc2bc3e and at 43ced06. As Builder C says, the real Electron window and Esc over a real desktop were not exercised; QA's walk covers them.
