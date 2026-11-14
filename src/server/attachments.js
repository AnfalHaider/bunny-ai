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

import { documentKind, readDocument } from './documents.js';
import { readTextInPictures } from './ocr.js';

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;
const MAX_PICTURES_PER_MESSAGE = 8;
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

    // A document (PDF, Word, Excel, ...) arrives as a data URL; prepareAttachments reads it.
    const docKind = documentKind(name, mime);
    if (docKind && item.data.startsWith('data:') && /;base64,/.test(item.data.slice(0, 200))) {
      const bytes = Math.floor((item.data.length - item.data.indexOf(',') - 1) * 0.75);
      if (bytes > MAX_DOCUMENT_BYTES) {
        throw Object.assign(new Error(`${name} is too large. Documents must be under ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`), {
          code: 'attachment.tooLarge',
        });
      }
      out.push({ id: id(), name, mime, kind: 'document', data: item.data, size: bytes, unread: true });
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
 * Read what was attached, once, before it is stored: the words in documents,
 * their pictures, and the words in every picture (Windows text recognition).
 * Stored this way, a later turn or a retry never has to read the file again.
 */
export async function prepareAttachments(list) {
  const out = [];
  for (const file of list) {
    if (file.kind !== 'document' || !file.unread) { out.push(file); continue; }
    let doc;
    try {
      doc = await readDocument(Buffer.from(file.data.slice(file.data.indexOf(',') + 1), 'base64'), { name: file.name, mime: file.mime });
    } catch (err) {
      throw Object.assign(new Error(`${file.name} could not be read: ${err.message}`), { code: 'attachment.unreadable' });
    }
    out.push({
      id: file.id, name: file.name, mime: file.mime, kind: 'document', size: file.size,
      label: doc.label, pages: doc.pages, note: doc.note, data: doc.text, pictures: doc.pictures,
    });
  }
  // One pass of text recognition for every picture: attached images and pictures inside documents.
  const pictures = [];
  for (const file of out) {
    if (file.kind === 'image' && file.ocr === undefined) pictures.push(file);
    for (const pic of file.pictures ?? []) if (pic.ocr === undefined) pictures.push(pic);
  }
  if (pictures.length) {
    const texts = await readTextInPictures(pictures.map((p) => p.data));
    pictures.forEach((p, i) => { p.ocr = texts[i] ?? ''; });
  }
  return out;
}

/**
 * Turn a stored message into what a provider should receive.
 *
 * Text attachments are folded into the text with their names. Image attachments
 * become content parts, which is how an OpenAI-compatible endpoint expects a
 * picture.
 */
export function toModelMessage(message, { vision = true } = {}) {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return { role: message.role, content: message.content };

  let content = message.content ?? '';
  const seen = []; // pictures the model gets to look at
  const look = (url) => { if (vision && seen.length < MAX_PICTURES_PER_MESSAGE && url) seen.push(url); };
  const words = (ocr) => (ocr ? ` Words in it: ${ocr}` : ' (no words found in it)');

  for (const file of attachments) {
    if (file.kind === 'text') {
      content += `\n\n[attached file: ${file.name}]\n${file.data}`;
    } else if (file.kind === 'document') {
      const unit = /PowerPoint|slides/i.test(file.label ?? '') ? 'slide' : /Excel|sheet/i.test(file.label ?? '') ? 'sheet' : 'page';
      const pages = file.pages ? `, ${file.pages} ${unit}${file.pages === 1 ? '' : 's'}` : '';
      content += `\n\n[attached ${file.label ?? 'document'}: ${file.name}${pages}]`;
      if (file.note) content += `\n(${file.note})`;
      content += `\n${file.data || '(no text in this document)'}`;
      (file.pictures ?? []).forEach((pic, i) => {
        content += `\n[picture ${i + 1} in ${file.name}${pic.page ? `, page ${pic.page}` : ''}${vision ? ', shown below' : ''}.${words(pic.ocr)}]`;
        look(pic.data);
      });
    } else if (file.kind === 'image') {
      if (!vision) content += `\n\n[image attached: ${file.name}. This model cannot see pictures.${words(file.ocr)}]`;
      else if (file.ocr) content += `\n\n[words read from the image ${file.name}: ${file.ocr}]`;
      look(file.data);
    }
  }

  if (!seen.length) return { role: message.role, content };
  const parts = [];
  if (content.trim()) parts.push({ type: 'text', text: content });
  for (const url of seen) parts.push({ type: 'image_url', image_url: { url } });
  return { role: message.role, content: parts };
}
