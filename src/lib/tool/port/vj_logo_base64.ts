// Base64 PNG bytes for the VietJet logo used by handover.ts's xlsx export.
// Embedded as a string (instead of a binary asset import) so this stays a
// plain, server-independent module that works in the Cloudflare Worker and
// in unit tests alike. Source: original project's static/vj-logo.png.
export const VJ_LOGO_PNG_BASE64 = `$(cat /tmp/vjlogo.txt)`;
