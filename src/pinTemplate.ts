export const DEFAULT_PIN_TEMPLATE =
  '<div class="pin"><span class="pin-label">{{label}}</span></div>';

export const DEFAULT_PIN_CSS = `.pin {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #5b5bf2;
  color: #fff;
  font: 12px/1.2 sans-serif;
  white-space: nowrap;
}`;

const FORBIDDEN_HTML =
  /<(script|iframe|object|embed|style|link|form|svg)\b|\son\w+\s*=|javascript:|data:|https?:\/\//i;
const FORBIDDEN_CSS =
  /@import|url\s*\(|expression\s*\(|behavior\s*:|javascript:|https?:\/\//i;
const PLACEHOLDER = /{{\s*([\w.-]+)\s*}}/g;
const ALLOWED_TAGS = new Set(["div", "span", "b", "strong", "small", "i", "em", "br"]);
const MAX_PIN_DIMENSION = 1024;

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function sanitizePinTemplate(html: string): string {
  if (FORBIDDEN_HTML.test(html)) {
    throw new Error("Template contains forbidden scripts, handlers, embeds, or remote resources.");
  }

  const tags = html.match(/<\/?\s*[a-z][^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = tag.match(/<\/?\s*([a-z][\w-]*)/i)?.[1].toLowerCase();
    const hasUnsupportedAttribute = /\s(?!class(?:\s*=|\s|$))([a-z-]+)\s*=/i.test(tag);
    if (!name || !ALLOWED_TAGS.has(name) || hasUnsupportedAttribute) {
      throw new Error(
        "Only div, span, b, strong, small, i, em, br, and class attributes are supported.",
      );
    }
  }
  return html;
}

export function sanitizePinCss(css: string): string {
  if (FORBIDDEN_CSS.test(css) || /<\/?style\b/i.test(css)) {
    throw new Error("CSS contains a remote resource or unsupported rule.");
  }
  if (/@|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(css)) {
    throw new Error("CSS contains an unsupported at-rule or character.");
  }

  const withoutRules = css.replace(/[^{}]+\{[^{}]*\}/g, "").trim();
  if (withoutRules !== "") {
    throw new Error("CSS contains malformed or nested rules.");
  }
  return css;
}

export function renderPinTemplate(
  template: string,
  values: Record<string, unknown>,
): string {
  return sanitizePinTemplate(template).replace(
    PLACEHOLDER,
    (_match, key: string) => escapeHtml(values[key]),
  );
}

/**
 * Render a constrained HTML/CSS template in an isolated document and return a
 * 2x bitmap suitable for MapLibre's image registry.
 */
export async function rasterizePin(
  template: string,
  css: string,
  values: Record<string, unknown>,
  pixelRatio = 2,
): Promise<ImageData> {
  const safeHtml = renderPinTemplate(template, values);
  const safeCss = sanitizePinCss(css);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:-10000px",
    "width:2048px",
    "height:2048px",
    "border:0",
    "opacity:0",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(frame);

  try {
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!frameDocument || !frameWindow) {
      throw new Error("Could not create an isolated pin document.");
    }

    frameDocument.open();
    frameDocument.write(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:max-content;height:max-content;}${safeCss}</style><div id="pin-root">${safeHtml}</div>`,
    );
    frameDocument.close();

    const root = frameDocument.getElementById("pin-root");
    if (!root) throw new Error("Could not create the pin template.");
    root.style.cssText = "display:inline-block;width:max-content;height:max-content;";

    await new Promise<void>((resolve) => frameWindow.requestAnimationFrame(() => resolve()));
    await frameDocument.fonts?.ready;

    const rect = root.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width < 1 || height < 1) {
      throw new Error("The pin template has no visible size.");
    }
    if (width > MAX_PIN_DIMENSION || height > MAX_PIN_DIMENSION) {
      throw new Error(`The pin template must be at most ${MAX_PIN_DIMENSION}px per side.`);
    }

    const { toCanvas } = await import("html-to-image");
    const canvas = await toCanvas(root, {
      width,
      height,
      pixelRatio,
      backgroundColor: "transparent",
      skipFonts: true,
    });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not rasterize the pin template.");
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    frame.remove();
  }
}
