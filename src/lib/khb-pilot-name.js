// Shared by KHB's browser shim and REQ formatter; preserve source crew names.
export function limitKhbPilotName(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (Array.from(text).length <= 30) return text;
  const words = text.split(" ");
  const id = /^\d+$/.test(words[0]) ? words.shift() : "";
  const name = words.length >= 3 ? [words[0], words[words.length - 1]] : words;
  const shortened = [id, ...name].filter(Boolean).join(" ");
  return Array.from(shortened).slice(0, 30).join("").trimEnd();
}