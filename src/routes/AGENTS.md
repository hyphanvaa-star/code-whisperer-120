# src/routes notes

- The shared custom select popup (`#ddPop`) in the tool-page shim mounts inside the open modal dialog when its select lives there, so top-layer dialogs never hide it.
- The tool-page "Hiển thị chung" tab is hidden and Compare is the start tab; Check OFP results open in the floating dialog from `src/tool/ofp-check-modal.js`, which hosts the original `#paneLimitCheck` so OFP scoring stays in page.html.
- NOTAM fullscreen (`body.nm-full`) hides only the header; the sidebar tab list stays as a fixed 200px rail showing icons and tab names so tab switching remains available.
