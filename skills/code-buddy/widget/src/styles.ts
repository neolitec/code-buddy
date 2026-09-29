/** Styles of the widget, scoped by its shadow root. */
export const WIDGET_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
  --cb-accent: #1b64f2;
  --cb-accent-strong: #1450c8;
  --cb-accent-weak: #eaf1ff;
  --cb-text: #13294b;
  --cb-muted: #6b7a90;
  --cb-border: #d9e2f1;
  --cb-surface: #ffffff;
  --cb-surface-2: #f4f7fd;
  --cb-green: #177a4c;
  --cb-green-bg: #e6f6ee;
  --cb-red: #d23f3f;
  --cb-red-bg: #fdecec;
  --cb-yellow: #f0ad2e;
  --cb-yellow-dark: #b7791f;
  --cb-radius: 8px;
  --cb-shadow: 0 8px 32px rgba(16, 36, 74, 0.18);
  --cb-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --cb-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
.cb { font: 14px/1.45 var(--cb-font); color: var(--cb-text); }
.cb-live { pointer-events: auto; }
button, textarea, input { font: inherit; color: inherit; }
p { margin: 0; white-space: pre-wrap; }
code { font-family: var(--cb-mono); }

.cb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: var(--cb-radius);
  border: 1px solid transparent; cursor: pointer; font-weight: 600;
  background: var(--cb-accent); color: #fff; white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s;
}
.cb-btn:hover { background: var(--cb-accent-strong); }
.cb-btn:disabled { cursor: default; background: var(--cb-accent-weak); color: #9db5e6; }
.cb-btn--secondary { background: var(--cb-surface); color: var(--cb-accent); border-color: var(--cb-border); }
.cb-btn--secondary:hover { background: var(--cb-surface-2); border-color: var(--cb-accent); }
.cb-btn--tertiary { background: transparent; color: var(--cb-accent); }
.cb-btn--tertiary:hover { background: var(--cb-surface-2); }
.cb-btn--sm { height: 28px; padding: 0 10px; font-size: 13px; }
.cb-btn svg { width: 16px; height: 16px; }

.cb-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--cb-text); cursor: pointer;
}
.cb-icon-btn:hover { background: var(--cb-surface-2); }
.cb-icon-btn:disabled { cursor: default; opacity: .35; background: transparent; }
.cb-icon-btn svg { width: 18px; height: 18px; }
.cb-icon-btn--danger { color: var(--cb-red); width: 22px; height: 22px; }
.cb-icon-btn--danger svg { width: 14px; height: 14px; }

.cb-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.cb-chip--open { background: var(--cb-accent-weak); color: var(--cb-accent); }
.cb-chip--claimed { background: #e3f0ff; color: #1767c7; }
.cb-chip--resolved { background: var(--cb-green-bg); color: var(--cb-green); }

.cb-textarea {
  width: 100%; min-height: 96px; resize: vertical; padding: 10px 12px;
  border: 1px solid var(--cb-border); border-radius: var(--cb-radius);
  background: var(--cb-surface-2); outline: none;
}
.cb-textarea:focus { border-color: var(--cb-accent); }
.cb-textarea::placeholder { color: #7f9cd6; font-style: italic; }

.cb-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--cb-accent); }
.cb-checkbox input { width: 16px; height: 16px; margin: 0; accent-color: var(--cb-accent); }

.cb-toggle { align-self: flex-start; display: inline-flex; padding: 2px; border: 1px solid var(--cb-border); border-radius: 6px; }
.cb-toggle button { border: 0; background: transparent; padding: 2px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.cb-toggle button[aria-checked='true'] { background: var(--cb-accent-weak); color: var(--cb-accent); }

.cb-spinner { animation: cb-spin .8s linear infinite; flex-shrink: 0; }
@keyframes cb-spin { to { transform: rotate(360deg); } }

.cb-dock { position: fixed; right: 24px; bottom: 24px; display: flex; gap: 8px; }
.cb-dock .cb-btn { box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.cb-selection { position: fixed; box-shadow: 0 4px 16px rgba(0,0,0,.15); }

.cb-panel {
  position: fixed; top: 16px; right: 16px; bottom: 16px;
  display: flex; flex-direction: column; background: var(--cb-surface);
  border-radius: 12px; box-shadow: var(--cb-shadow);
}
.cb-panel--docked { top: 0; right: 0; bottom: 0; border-radius: 0; box-shadow: none; border-left: 1px solid var(--cb-border); }
.cb-resize { position: absolute; top: 0; bottom: 0; left: -3px; width: 7px; cursor: col-resize; z-index: 1; }
.cb-resize:hover, .cb-resize[data-dragging] { background: var(--cb-accent); opacity: .6; }
.cb-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--cb-border); }
.cb-title { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cb-title h2 { margin: 0; font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-header-actions { display: flex; align-items: center; gap: 2px; }
.cb-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 20px; }
/* The mascot has its own strip below the body rather than floating over it: in a short panel, padding
   alone left it covering whatever the body showed. Its height leaves room for the drift, which never clips. */
.cb-buddy-slot { flex-shrink: 0; position: relative; height: 128px; pointer-events: none; user-select: none; }
.cb-buddy { position: absolute; bottom: 12px; left: 50%; height: 96px; transform: translateX(-50%); animation: cb-float 4.8s ease-in-out infinite; }
/* On a short screen the chat needs the room more than the mascot does. */
@media (max-height: 560px) {
  .cb-buddy-slot { display: none; }
  /* Without the strip, the footer sits over the body's end: keep it clear. */
  .cb-body { padding-bottom: 36px; }
}
/* Version and project link, in the panel's bottom-right corner. */
.cb-footer { position: absolute; right: 16px; bottom: 12px; font-size: 11px; color: var(--cb-muted); }
.cb-footer a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.cb-footer a:hover { color: var(--cb-accent); }
/* A slow drift, bob and tilt; translateX(-50%) is restated in every frame because the animation owns transform. */
@keyframes cb-float {
  0%, 100% { transform: translateX(-50%) translateY(0) rotate(-3deg); }
  25% { transform: translateX(calc(-50% + 10px)) translateY(-10px) rotate(2deg); }
  50% { transform: translateX(-50%) translateY(-4px) rotate(3deg); }
  75% { transform: translateX(calc(-50% - 10px)) translateY(-12px) rotate(-1deg); }
}
@media (prefers-reduced-motion: reduce) { .cb-buddy { animation: none; } }
.cb-form { display: flex; flex-direction: column; gap: 8px; }
.cb-actions { display: flex; gap: 8px; justify-content: flex-end; }
.cb-empty { display: flex; justify-content: center; padding: 32px 0; }
.cb-idle { font-size: 13px; color: var(--cb-muted); }

.cb-section, .cb-author, .cb-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--cb-muted); }
.cb-author { display: block; }
.cb-quote { margin: 0; padding-left: 8px; border-left: 3px solid var(--cb-yellow); font-size: 13px; color: var(--cb-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }

.cb-item { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: var(--cb-radius); border: 1px solid var(--cb-border); background: var(--cb-surface); cursor: pointer; }
.cb-item--active { border-color: var(--cb-accent); }
.cb-item--faded { opacity: .7; }
.cb-item .cb-delete { opacity: 0; transition: opacity .15s; }
.cb-item:hover .cb-delete, .cb-item .cb-delete:focus-visible { opacity: 1; }
.cb-item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cb-item-top > div { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cb-summary { gap: 6px; transition: border-color .15s, background .15s; }
.cb-summary:hover { border-color: var(--cb-accent); background: var(--cb-surface-2); }
.cb-summary p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cb-summary-head { display: flex; align-items: center; gap: 8px; }
.cb-summary-head > * { flex-shrink: 0; }
.cb-summary-head time { margin-left: auto; font-size: 12px; color: var(--cb-muted); white-space: nowrap; }
.cb-summary-head .cb-label, .cb-summary-head .cb-page { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-page { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--cb-accent); }
.cb-page span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-page svg { width: 14px; height: 14px; flex-shrink: 0; }

.cb-thread { display: flex; flex-direction: column; gap: 8px; }
.cb-answer { padding: 8px; border-radius: var(--cb-radius); background: var(--cb-green-bg); color: var(--cb-green); font-size: 13px; white-space: pre-wrap; }
.cb-working { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--cb-accent); }
.cb-stopped { padding: 8px; border-radius: var(--cb-radius); background: var(--cb-red-bg); color: var(--cb-red); font-size: 13px; }
.cb-stopped code { overflow-wrap: anywhere; }
.cb-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--cb-muted); }
.cb-steps li { display: flex; align-items: center; gap: 4px; }
.cb-steps li:last-child { color: var(--cb-accent); }
.cb-steps span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-steps time { font-variant-numeric: tabular-nums; }
.cb-steps svg { width: 14px; height: 14px; flex-shrink: 0; }

.cb-element { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; margin: 0 -4px; padding: 0 4px; border-radius: 6px; font-size: 13px; color: var(--cb-muted); cursor: pointer; }
.cb-element:hover { background: var(--cb-surface-2); }
.cb-element code { color: var(--cb-accent); }
.cb-element span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cb-mark { position: fixed; pointer-events: none; border: 2px solid var(--cb-yellow); border-radius: 4px; background: rgba(255, 196, 0, .1); }
.cb-mark--active { border-color: var(--cb-red); background: rgba(255, 140, 0, .12); }
.cb-pin { position: absolute; top: -12px; right: -12px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--cb-yellow-dark); color: #fff; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.cb-outline { position: fixed; pointer-events: none; border: 2px solid var(--cb-accent); border-radius: 4px; background: rgba(0, 120, 255, .12); box-shadow: 0 0 0 4px rgba(0, 120, 255, .18); }
.cb-hover { position: fixed; pointer-events: none; border: 2px dashed var(--cb-accent); border-radius: 4px; background: rgba(0, 120, 255, .08); }
.cb-hover span { position: absolute; top: -22px; left: -2px; padding: 1px 4px; border-radius: 3px; background: var(--cb-accent); color: #fff; font: 12px var(--cb-mono); white-space: nowrap; }
.cb-hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: #fff; font-size: 13px; pointer-events: none; }

.cb-toasts { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; }
.cb-toast { padding: 10px 14px; border-radius: var(--cb-radius); background: var(--cb-text); color: #fff; font-size: 13px; box-shadow: var(--cb-shadow); }
.cb-toast--error { background: var(--cb-red); }
`

/** Page-level styles: text highlights live in the page's own document. */
export const PAGE_CSS = `
::highlight(code-buddy) { background-color: rgba(255, 213, 79, 0.45); }
::highlight(code-buddy-active) { background-color: rgba(255, 152, 0, 0.55); }
`
