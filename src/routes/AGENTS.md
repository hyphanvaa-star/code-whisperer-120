# src/routes notes

- The shared custom select popup (`#ddPop`) in the tool-page shim mounts inside the open modal dialog when its select lives there, so top-layer dialogs never hide it.
- The tool-page "Hiển thị chung" tab is hidden and Compare is the start tab; Check OFP results open in the floating dialog from `src/tool/ofp-check-modal.js`, which hosts the original `#paneLimitCheck` so OFP scoring stays in page.html.
- NOTAM Tracking opens in the normal layout like every other tab; the old auto-fullscreen (`body.nm-full`) mechanism was removed in V 6.85 — do not reintroduce it.
- Inside tool-page shim template literals, JS string newlines must be written `\\n`; a bare `\n` becomes a raw newline and breaks the whole page script.
- NOTAM "Add chuyến" bar targets only the tracked flight via browser-safe `src/lib/notam-pin-bar.js` (inlined by the shim); flights pinned earlier render as separate removable chips, so an old pin is never prefilled or re-pinned to the wrong sector.
