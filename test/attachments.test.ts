import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { attachmentNote, decodeAttachments, imageType, MAX_FILE_BYTES, MAX_FILES, saveAttachments } from '../src/attachments.ts';

const roots: string[] = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const hex = (h: string) => Buffer.from(h, 'hex');
const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64');
const PNG = hex('89504e470d0a1a0a0000000d49484452');

test('the image type comes from the bytes, not the file name', () => {
  assert.equal(imageType(PNG), 'png');
  assert.equal(imageType(hex('ffd8ffe000104a464946')), 'jpg');
  assert.equal(imageType(Buffer.from('GIF89a......')), 'gif');
  assert.equal(imageType(Buffer.concat([Buffer.from('RIFF'), hex('00000000'), Buffer.from('WEBPVP8 ')])), 'webp');
  assert.equal(imageType(Buffer.concat([hex('00000020'), Buffer.from('ftypavif')])), 'avif');
  assert.equal(imageType(hex('0000010001001010')), 'ico');
  assert.equal(imageType(Buffer.from('\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"></svg>')), 'svg');
  for (const notImage of ['MZ\x90\x00', '%PDF-1.7', '<html><svg></svg></html>', 'hello']) {
    assert.equal(imageType(Buffer.from(notImage, 'latin1')), undefined, notImage);
  }
});

test('decodeAttachments cleans names, fixes extensions and enforces limits', () => {
  const files = decodeAttachments([
    { name: 'C:\\Users\\me\\My Logo (final).PNG', data: b64(PNG) },
    { name: 'product.jpeg', data: `data:image/png;base64,${b64(PNG)}` }, // really a PNG
    { name: '...', data: b64(PNG) },
  ]);
  assert.deepEqual(files.map((f) => f.name), ['my-logo-final.png', 'product.png', 'image.png']);
  assert.deepEqual(decodeAttachments(undefined), []);

  assert.throws(() => decodeAttachments('nope'), /list of files/);
  assert.throws(() => decodeAttachments(Array.from({ length: MAX_FILES + 1 }, () => ({ name: 'a.png', data: b64(PNG) }))), /at most 10/);
  assert.throws(() => decodeAttachments([{ name: 'a.png' }]), /arrived empty/);
  assert.throws(() => decodeAttachments([{ name: 'a.png', data: '' }]), /is empty/);
  assert.throws(() => decodeAttachments([{ name: 'menu.pdf', data: b64('%PDF-1.7') }]), /"menu\.pdf" isn't an image/);
  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)]);
  assert.throws(() => decodeAttachments([{ name: 'huge.png', data: b64(huge) }]), /over 10 MB/);
});

test('saving never overwrites an earlier upload', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'office-attach-'));
  roots.push(workspace);
  const files = decodeAttachments([{ name: 'logo.png', data: b64(PNG) }, { name: 'logo.png', data: b64(PNG) }]);
  assert.deepEqual(saveAttachments(workspace, files), ['logo.png', 'logo-2.png']);
  assert.deepEqual(saveAttachments(workspace, files), ['logo-3.png', 'logo-4.png']);
  assert.deepEqual(readdirSync(join(workspace, 'attachments')).sort(), ['logo-2.png', 'logo-3.png', 'logo-4.png', 'logo.png']);
  assert.deepEqual(saveAttachments(workspace, []), []);
  assert.equal(attachmentNote([]), '');
  assert.match(attachmentNote(['logo.png']), /attachments\/\): logo\.png\.\n.*Read tool/);
});
