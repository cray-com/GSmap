export const DEFAULT_PIN_TEMPLATE = '<div class="pin"><span class="pin-label">{{label}}</span></div>';
export const DEFAULT_PIN_CSS = '.pin { background: #5b5bf2; color: #fff; border: 2px solid #fff; border-radius: 999px; padding: 6px 9px; font-size: 12px; font-family: sans-serif; white-space: nowrap; }';

const FORBIDDEN_HTML = /<(script|iframe|object|embed|style|link|form|svg)\b|\son\w+\s*=|javascript:|data:|https?:\/\//i;
const FORBIDDEN_CSS = /@import|url\s*\(|expression\s*\(|behavior\s*:|javascript:|https?:\/\//i;
const PLACEHOLDER = /{{\s*([\w.-]+)\s*}}/g;

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}
export function sanitizePinTemplate(html: string): string {
  if (FORBIDDEN_HTML.test(html)) throw new Error("Template contains forbidden scripts, handlers, embeds, or remote resources.");
  if (/<\s*[a-z][^>]*>/i.test(html) && !/^\s*<\s*(div|span|b|strong|small|i|em|br)(?:\s[^>]*)?>[\s\S]*<\s*\/\s*(div|span|b|strong|small|i|em)\s*>\s*$/i.test(html)) throw new Error("Only the constrained div/span/text template subset is supported.");
  return html;
}
export function sanitizePinCss(css: string): string {
  if (FORBIDDEN_CSS.test(css) || /[{}]/.test(css.replace(/\{[^}]*\}/g, ""))) throw new Error("CSS contains a remote resource or unsupported rule.");
  if (/[^\w\s.#,:;()%'"\-+\n\r\/]/.test(css)) throw new Error("CSS contains unsupported characters.");
  return css;
}
export function renderPinTemplate(template: string, values: Record<string, unknown>): string {
  return sanitizePinTemplate(template).replace(PLACEHOLDER, (_, key: string) => escapeHtml(values[key]));
}
export function templateText(template: string, values: Record<string, unknown>): string {
  const rendered = renderPinTemplate(template, values);
  return rendered.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() || "•";
}
export function templateStyle(css: string): { background: string; color: string; border: string; radius: number; fontSize: number; padding: number } {
  sanitizePinCss(css);
  const get = (name: string) => css.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, "i"))?.[1].trim();
  const size = Number.parseFloat(get("font-size") ?? "12");
  return { background: get("background(?:-color)?") ?? "#5b5bf2", color: get("color") ?? "#fff", border: get("border") ?? "2px solid #fff", radius: Number.parseFloat(get("border-radius") ?? "999") || 999, fontSize: Number.isFinite(size) ? size : 12, padding: Number.parseFloat(get("padding") ?? "6") || 6 };
}
