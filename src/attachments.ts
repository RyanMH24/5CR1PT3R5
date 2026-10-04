import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, parse as parsePath } from 'node:path';
import { ActionError } from './errors.ts';

/**
 * Images a person attaches to a task (photos, business logos, product shots). They are saved in
 * the task folder under attachments/ before the agent starts, and the task text tells the agent
 * they are there, so "put my logo in the header" works with no path.
 *
 * Only images are accepted, and the type is read from the file's bytes, not its name: a file
 * called logo.png that is really something else is refused.
 */

export const ATTACH_DIR = 'attachments';
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export interface UploadedFile {
  name: string;
  /** File contents, base64 (a data: URL prefix is tolerated). */
  data: string;
}

export interface Attachment {
  name: string;
  bytes: Buffer;
}

/** Validate what the page sent. Throws ActionError with a message for the person. */
export function decodeAttachments(raw: unknown): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ActionError('Attachments must be a list of files.');
  if (raw.length > MAX_FILES) throw new ActionError(`Attach at most ${MAX_FILES} images at a time.`);
  let total = 0;
  return raw.map((item: Partial<UploadedFile>) => {
    const original = typeof item?.name === 'string' ? item.name : 'image';
    if (typeof item?.data !== 'string') throw new ActionError(`"${original}" arrived empty. Try attaching it again.`);
    const bytes = Buffer.from(item.data.replace(/^data:[^,]*,/, ''), 'base64');
    if (bytes.length === 0) throw new ActionError(`"${original}" is empty.`);
    if (bytes.length > MAX_FILE_BYTES) throw new ActionError(`"${original}" is over ${MAX_FILE_BYTES / 1024 / 1024} MB. Use a smaller image.`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new ActionError(`Attachments add up to more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB. Send fewer or smaller images.`);
    const ext = imageType(bytes);
    if (!ext) throw new ActionError(`"${original}" isn't an image. Attach PNG, JPEG, GIF, WebP, AVIF, SVG or ICO files.`);
    return { name: `${safeStem(original)}.${ext}`, bytes };
  });
}

/** Write the files into <workspace>/attachments without overwriting earlier ones. Returns the saved names. */
export function saveAttachments(workspace: string, files: readonly Attachment[]): string[] {
  if (files.length === 0) return [];
  const dir = join(workspace, ATTACH_DIR);
  mkdirSync(dir, { recursive: true });
  return files.map((file) => {
    const { name: stem, ext } = parsePath(file.name);
    let name = file.name;
    for (let n = 2; existsSync(join(dir, name)); n++) name = `${stem}-${n}${ext}`;
    writeFileSync(join(dir, name), file.bytes);
    return name;
  });
}

/** The line added to the task so the agent knows the images are there. */
export function attachmentNote(names: readonly string[]): string {
  if (names.length === 0) return '';
  return [
    '',
    '',
    `Attached images (in ${ATTACH_DIR}/): ${names.join(', ')}.`,
    'Use them where they fit, e.g. the logo in the header and product photos with their products. Open one with the Read tool to see it.',
  ].join('\n');
}

/** Detect an image type from its first bytes. Returns the file extension to use, or undefined. */
export function imageType(bytes: Buffer): string | undefined {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (bytes.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/)) return 'gif';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes.subarray(4, 12).toString('latin1').match(/^ftypavi[fs]$/)) return 'avif';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'ico';
  const head = bytes.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return undefined;
}

/** A filesystem-safe, readable name without its extension: "My Logo (final).PNG" -> "my-logo-final". */
function safeStem(name: string): string {
  const stem = parsePath(name.replace(/\\/g, '/').split('/').pop() ?? '').name;
  const clean = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return clean || 'image';
}
