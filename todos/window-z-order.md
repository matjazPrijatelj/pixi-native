## Required behavior

Add the following public type:

```ts
type WindowLayer = "background" | "content" | "overlay";
```

Extend:

- `NodeRendererOptions.windowLayer?: WindowLayer`
- `NodeWindowHandle.setWindowLayer(layer: WindowLayer): void`
- native `NativeWindowOptions` and `NativeWindow`
- window settings diagnostics

The default value is `content`.

Support the `PIXI_NATIVE_WINDOW_LAYER` environment variable so that a future launcher can set the layer without modifying the display bundle.

Priority:

1. `PIXI_NATIVE_WINDOW_LAYER`
2. `NodeRendererOptions.windowLayer`
3. `content`

An invalid value must cause a clear error before the window is created, including the list of allowed values.

## Platforms

### Windows

Use `SetWindowPos` without moving, resizing, or activating the window:

- `background` → `HWND_BOTTOM`
- `content` → `HWND_NOTOPMOST`
- `overlay` → `HWND_TOPMOST`

Reapply the layer after restore, after the window is shown again, and when it receives focus, so that clicking a background window does not raise it above content windows.

Do not change the window's input or focus behavior.

### Linux X11

Implement EWMH `_NET_WM_STATE`:

- `background` → add `_NET_WM_STATE_BELOW`, remove `ABOVE`
- `content` → remove `BELOW` and `ABOVE`
- `overlay` → add `_NET_WM_STATE_ABOVE`, remove `BELOW`

Send the appropriate client message to the root window and flush it.

If the window manager does not support the requested EWMH state, return a clear error or warning; do not report the layer as successfully applied.

### Linux Wayland

Wayland does not provide a portable global z-order API.

`content` must work normally. `background` and `overlay` must return a clear message stating that they are unsupported on Wayland.

Do not simulate support that the compositor does not provide.

## Implementation requirements

- Apply the layer when the window is created and also allow it to be changed later via `setWindowLayer()`.
- The same behavior must apply to Pixi 7 and Pixi 8, and to both WebGPU and WebGL.
- Preserve the existing behavior when `windowLayer` is not specified.
- Regenerate native types and platform-package copies using the existing scripts; do not manually edit generated files.
- Add documentation explaining the Windows, X11, and Wayland behavior and limitations.
- Bump the version to the next unpublished patch version only after checking the npm registry.
- Do not make any changes to `display-launcher`.

## Tests and acceptance criteria

- Unit tests for:

  - the default value
  - an explicit option
  - environment-variable override
  - invalid values

- Tests verifying layer forwarding through all renderer paths.

- Native mapping tests for Windows and X11.

- Windows runtime test with three overlapping windows, including:

  - clicking the windows
  - minimize/restore
  - changing the layer at runtime

- Linux X11 runtime test covering the same scenario; also verify the state through `_NET_WM_STATE`.

- Wayland test must confirm explicit rejection of `background` and `overlay`.

- For the native window addon, use only:

```bash
pnpm native:window:build
```

- Do not run `pnpm native:build` or rebuild Dawn without prior warning and explicit approval.
- Before finishing, run the relevant formatting, type checking, tests, builds, and distribution/package checks.
- In the final report, separately state which Windows and Linux runtime tests were actually executed.
