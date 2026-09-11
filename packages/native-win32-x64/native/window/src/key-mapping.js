const SDL_KEY_NAMES = Object.freeze({
  Up: "up",
  Down: "down",
  Left: "left",
  Right: "right",
  Space: "space",
  Return: "return",
  Escape: "escape",
  Backspace: "backspace",
  Tab: "tab",
  "Left Ctrl": "ctrl",
  "Right Ctrl": "ctrl",
  "Left Shift": "shift",
  "Right Shift": "shift",
  "Left Alt": "alt",
  "Right Alt": "alt",
  "Left GUI": "gui",
  "Right GUI": "gui",
});

/** Preserves the key names exposed by the previous @kmamal/sdl adapter. */
const normalizeSdlKeyName = (name) => {
  if (typeof name !== "string") return name;
  const mapped = SDL_KEY_NAMES[name];
  if (mapped) return mapped;
  if (/^[A-Z]$/.test(name) || /^F\d{1,2}$/.test(name)) {
    return name.toLowerCase();
  }
  return name;
};

module.exports = { normalizeSdlKeyName };
