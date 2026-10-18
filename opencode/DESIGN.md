# OpenCode indicator direction

Direction: the user's request to match OpenCode's colors and style. This adapter is part of a
desktop coding workflow, so the panel uses the dark OpenCode terminal palette rather than changing
the user's system theme.

Design read: a desktop control indicator for OpenCode users, with compact terminal typography and
a neutral panel. ENERGY 1 / RHYTHM 1 / MOTION 2.

| Decision | Purpose |
|---|---|
| Primary accent `#fab283` | Match the warm peach primary color in OpenCode's default dark theme |
| Panel `#141414`, text `#eeeeee` | Use OpenCode's neutral panel and text colors with a solid background for reliable contrast |
| Secondary text `#aaaaaa` | Keep the action and ESC explanation readable above the normal text contrast minimum |
| Countdown `#f5a742` | Match OpenCode's warning color while displaying the remaining seconds explicitly |
| Cascadia Mono or Consolas | Connect the native status panel with the terminal while retaining installed Windows fonts |
| Six design unit panel corners | Use OpenCode's rectilinear language and distinguish the panel from the ESC keycap |
| A steady square status mark | Show real active control and echo OpenCode's block based identity |
| A steady edge and pointer ring | Identify the controlled desktop and real cursor without perpetual breathing |
| Countdown progress and click ripples | Explain the wait and show where an actual interaction occurred |
| Compact narrow labels | Preserve program identity, remaining seconds and ESC when space is limited |
| A single floating panel with a small shadow | Separate the control announcement from the app underneath |

Source: [OpenCode's theme at v1.18.25](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/tui/src/theme/assets/opencode.json).
There are no new logos, avatars, navigation elements or fictional product statistics.

Delivery verification:

- Hard gate: PASS. No invented claims or dead controls. The overlay has one keyboard action, physical
  ESC, whose hook remains in the shared backend. Physical key testing is a separate human check.
- Purpose gate: PASS. Color, type, shadow, edge, ring and motion purposes are recorded above.
- Liveliness: PASS. The panel is the focal point; its square mark, peach accent and terminal text
  identify OpenCode. Motion is limited to the countdown and actual input feedback.
- Craftsmanship: PASS. Rendered and inspected at 100%, 150% and 200%, including a 360 design unit
  width and a long action. Countdown seconds and ESC remain visible. This is a Windows desktop
  overlay, so browser/mobile layout checks do not apply.
- Contrast: PASS. Text against `#141414`: `#eeeeee` 15.88:1, `#aaaaaa` 7.93:1, `#f5a742` 9.20:1,
  `#fab283` 10.32:1, computed with the WCAG relative luminance formula. Countdown, active and action
  states are rendered from the actual C# implementation in `docs/opencode-indicator.png`.
- Interaction evidence: starting control shows a countdown and permits input afterward; typing and
  a named button click reach the isolated fixture; programmatic stop removes the indicator;
  interruption blocks input; the replacement cursor is restored on stop or repaired after a kill.
  The status panel and ESC label are not clickable buttons and do not take keyboard focus.
