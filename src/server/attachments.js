/**
 * Attachments: a file or an image sent along with a message.
 *
 * Text files travel as text and are folded into the prompt with their name, so
 * the model can see what was attached. Images travel as a data URL in the
 * OpenAI-compatible content-parts form every provider in the catalogue speaks.
 *
 * Everything is validated here, in one place, so no route has to remember the
 * limits: a file name is never a path, and a payload is never unbounded.
 */

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 8;

const IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
]);

/** A name is a label, never a path. */
export function safeName(name) {
  return String(name ?? 'file')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 80) || 'file';
}

/**
 * @param {Array<{name?: string, mime?: string, data?: string}>} list
 * @returns {Array<{id: string, name: string, mime: string, kind: string, data: string, size: number}>}
 */
export function normaliseAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, MAX_FILES)) {
    if (!item || typeof item.data !== 'string' || !item.data) continue;

    const name = safeName(item.name);
    const mime = String(item.mime ?? 'text/plain').toLowerCase().split(';')[0].trim();
    const isImage = IMAGE_TYPES.has(mime) || item.data.startsWith('data:image/');

    if (isImage) {
      const data = normaliseDataUrl(item.data, mime);
      if (!data) continue;
      if (data.length > MAX_IMAGE_BYTES) {
        throw Object.assign(new Error(`${name} is too large. Images must be under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`), {
          code: 'attachment.tooLarge',
        });
      }
      out.push({ id: id(), name, mime: mime || 'image/png', kind: 'image', data, size: data.length });
      continue;
    }

    // A text file arrives either as raw text or as a data URL.
    const text = item.data.startsWith('data:')
      ? decodeDataUrl(item.data)
      : item.data;
    if (text === null) continue;
    if (text.length > MAX_TEXT_BYTES) {
      throw Object.assign(new Error(`${name} is too large. Text files must be under ${MAX_TEXT_BYTES / 1024} KB.`), {
        code: 'attachment.tooLarge',
      });
    }
    out.push({ id: id(), name, mime: mime || 'text/plain', kind: 'text', data: text, size: text.length });
  }
  return out;
}

function normaliseDataUrl(data, mime) {
  if (data.startsWith('data:')) {
    const match = data.match(/^data:([^;,]+)?(;base64)?,/);
    if (!match) return null;
    return data;
  }
  // A bare base64 payload is treated as an image of the given type.
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return null;
  return `data:${mime || 'image/png'};base64,${data.replace(/\s+/g, '')}`;
}

function decodeDataUrl(data) {
  const match = data.match(/^data:[^;,]*;base64,(.*)$/s);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function id() {
  return `att-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Turn a stored message into what a provider should receive.
 *
 * Text attachments are folded into the text with their names. Image attachments
 * become content parts, which is how an OpenAI-compatible endpoint expects a
 * picture.
 */
export function toModelMessage(message) {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return { role: message.role, content: message.content };

  const images = attachments.filter((a) => a.kind === 'image');
  const texts = attachments.filter((a) => a.kind === 'text');

  let content = message.content ?? '';
  for (const file of texts) {
    content += `\n\n[attached file: ${file.name}]\n${file.data}`;
  }

  if (!images.length) return { role: message.role, content };

  const parts = [];
  if (content.trim()) parts.push({ type: 'text', text: content });
  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: image.data } });
  }
  return { role: message.role, content: parts };
}
