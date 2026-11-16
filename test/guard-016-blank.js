import { join } from 'node:path';
import { BIN, fileUrl } from './guard-016-helpers.js';

export const { simpleCommandTexts } = await import(fileUrl(join(BIN, 'lib', 'shellblank.mjs')));
