# Web app visible parts: build 93a1bce (447d6c9) against the approved drawing

Design, 2026-11-18. Verdict: **PASS with one difference to fix** (the update bar covers the row under the composer).

Checked by reading the code and one preview on its own port (invented profile, stopped after): the Settings Desktop-app page with the browser install event faked, localStorage "installed", no event, the desktop-bridge stand-in, and the update bar added on the app page at 1100 and 390 px, light and dark. Readings: shots/log.txt, pictures: shots/.

## Matches the drawing
- **Install row, ready:** title "Install as an app", the drawing text, Install button on; clicking it calls the browser prompt. **Installed:** badge "Installed", the drawing text, button "Installed" off. **Not offered:** the drawing text ("Chrome and Edge do"), Install off. **Over the network:** by the code (installRowState: any host that is not 127.0.0.1, localhost or ::1 gives the "network" state, Install off, the Add to Home Screen text); not pictured, because the server refuses other host names (S-1 guard). **Window pointer:** in the desktop-bridge stand-in the row is hidden and the pointer line reads "To install it as an app, open it in your browser and use Install as an app in Settings there." plus the network line. The network line is in every state, as drawn.
- **Theme colours:** manifest theme_color and background_color #faf9f6; meta theme-color #faf9f6 for light and #141518 for dark on index, signin and settings; body background follows the theme (rgb 250,249,246 / 20,21,24). PNG icons 192 and 512, maskable 192 and 512 and an apple-touch icon all served (200, image/png), manifest linked from every page, id and start_url "/".
- **Safe areas:** viewport-fit=cover on index and signin; the top bar adds env(safe-area-inset-top) (app.css:1777), the dock and the sheet add env(safe-area-inset-bottom) (:1778, :2174). On a desktop browser the insets are 0, so the real notch and home-bar result is not seen (UNKNOWN until a phone).
- **Update ready · Reload:** text and behaviour as drawn ("Update ready · Reload", clicking Reload applies the update), centred, 16 px above the bottom plus the bottom inset.

## Difference to fix
- **The "Update ready · Reload" bar sits over the row under the composer** (it covers Manual and the other controls at 390 px, `shots/update-dark-390.png`, and sits over the same row on desktop). Put it above the composer (bottom: the composer height plus 8 px), or as a thin line under the top bar, so it never hides a control. src/ui/install-app.js showUpdateBar (position: fixed; bottom: calc(16px + env(safe-area-inset-bottom))).

## Small notes
- In a browser tab the Settings page shows only the Install row (the other rows of the group are hidden because they belong to the window); the drawing showed the Open row above it. Fine.
- Not covered: the real installed window and title bar, a real phone (notch, home bar), the update flow with a real new service worker.
