export const DEFAULT_PIN_TEMPLATE = '<div class="pin"><span class="pin-label">{{label}}</span></div>';
export const DEFAULT_PIN_CSS = '.pin { background: #5b5bf2; color: #fff; border: 2px solid #fff; border-radius: 999px; padding: 6px 9px; font-size: 12px; font-family: sans-serif; white-space: nowrap; }';

const FORBIDDEN_HTML = /<(script|iframe|object|embed|style|link|form|svg)\b|\son\w+\s*=|javascript:|data:|https?:\/\//i;
const FORBIDDEN_CSS = /@import|url\s*\(|expression\s*\(|behavior\s*:|javascript:|https?:\/\//i;
const PLACEHOLDER = /{{\s*([\w.-]+)\s*}}/g;

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}
const ALLOWED_TAGS = new Set(["div", "span", "b", "strong", "small", "i", "em", "br"]);

export function sanitizePinTemplate(html: string): string {
  if (FORBIDDEN_HTML.test(html)) {
    throw new Error("Template contains forbidden scripts, handlers, embeds, or remote resources.");
  }
  const tags = html.match(/<\/?\s*[a-z][^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = tag.match(/<\/?\s*([a-z][\w-]*)/i)?.[1].toLowerCase();
    if (!name || !ALLOWED_TAGS.has(name) || /\s(?!class(?:\s*=|\s|$))([a-z-]+)\s*=/i.test(tag)) {
      throw new Error("Only div, span, b, strong, small, i, em, br, and class attributes are supported.");
    }
  }
  return html;
}
export function sanitizePinCss(css: string): string {
  if (FORBIDDEN_CSS.test(css) || /<\/?style\b|[{}]/.test(css.replace(/\{[^{}]*\}/g, ""))) {
    throw new Error("CSS contains a remote resource or unsupported rule.");
  }
  if (/@|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(css)) {
    throw new Error("CSS contains an unsupported at-rule or character.");
  }
  const compact = css.replace(/\s+/g, " ").trim();
  const rules = compact.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  if (compact && rules.join("") !== compact) {
    throw new Error("CSS contains malformed or nested rules.");
  }
  return css;
}
export function renderPinTemplate(template: string, values: Record<string, unknown>): string {
  return sanitizePinTemplate(template).replace(PLACEHOLDER, (_, key: string) => escapeHtml(values[key]));
}
export function templateText(template: string, values: Record<string, unknown>): string {
  const rendered = renderPinTemplate(template, values);
  return rendered.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() || "•";
}
export async function rasterizePin(template: string, css: string, values: Record<string, unknown>, pixelRatio = 2): Promise<ImageData> {
  const safeHtml = renderPinTemplate(template, values);
  const safeCss = sanitizePinCss(css);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  try {
    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error("Could not create an isolated pin document.");
    frameDocument.open();
    frameDocument.write(`<style>${safeCss}</style><div id="pin-root">${safeHtml}</div>`);
    frameDocument.close();
    const root = frameDocument.getElementById("pin-root");
    if (!root) throw new Error("Could not create the pin template.");
    root.style.display = "inline-block";
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const { toCanvas } = await import("html-to-image");
    const canvas = await toCanvas(root, { pixelRatio, backgroundColor: "transparent" });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not rasterize the pin template.");
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    frame.remove();
  }
}

export function templateStyle(css: string): { background: string; color: string; border: string; radius: number; fontSize: number; padding: number } {
  sanitizePinCss(css);
  const get = (name: string) => css.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, "i"))?.[1].trim();
  const size = Number.parseFloat(get("font-size") ?? "12");
  return { background: get("background(?:-color)?") ?? "#5b5bf2", color: get("color") ?? "#fff", border: get("border") ?? "2px solid #fff", radius: Number.parseFloat(get("border-radius") ?? "999") || 999, fontSize: Number.isFinite(size) ? size : 12, padding: Number.parseFloat(get("padding") ?? "6") || 6 };
}
