// @ts-check
/**
 * Attach images (photos, business logos, product shots) to a task or a follow-up. Files can be
 * picked with the button, dropped onto the form, or pasted into the text box. They're sent with
 * the task as base64 and saved in the project's attachments/ folder by the office.
 *
 * Limits mirror src/attachments.ts so people hear about a problem before uploading; the server
 * checks again, and also checks that each file really is an image.
 */

export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon';
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/** @typedef {{ name: string, data: string }} UploadedFile */

export class AttachmentPicker {
  /**
   * @param {HTMLElement} container  Element the picker is built into.
   * @param {object} opts
   * @param {HTMLElement} opts.dropZone  Where files can be dropped.
   * @param {HTMLTextAreaElement} [opts.pasteTarget]  Text box that accepts pasted images.
   * @param {File[]} [opts.files]  Files to start with (kept by the caller across re-renders).
   * @param {(message: string) => void} opts.onError
   */
  constructor(container, opts) {
    /** @type {File[]} */
    this.files = opts.files ?? [];
    this.onError = opts.onError;
    /** @type {string[]} */
    this.previews = [];

    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = ACCEPT;
    this.input.multiple = true;
    this.input.hidden = true;
    this.input.addEventListener('change', () => {
      this.add([...(this.input.files ?? [])]);
      this.input.value = ''; // picking the same file again should still fire change
    });

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'secondary attach-button';
    this.button.addEventListener('click', () => this.input.click());

    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Photos, logos, products · drop or paste too';

    this.list = document.createElement('ul');
    this.list.className = 'attach-list';
    this.list.setAttribute('aria-label', 'Attached images');
    this.list.addEventListener('click', (event) => {
      const remove = /** @type {HTMLElement} */ (event.target).closest('button[data-remove]');
      if (!remove) return;
      this.files.splice(Number(remove.getAttribute('data-remove')), 1);
      this.render();
      this.button.focus();
    });

    const row = document.createElement('div');
    row.className = 'attach-row';
    row.append(this.button, hint);
    container.classList.add('attach');
    container.append(this.input, row, this.list);

    const zone = opts.dropZone;
    zone.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      zone.classList.add('dropping');
    });
    zone.addEventListener('dragleave', (event) => {
      if (!zone.contains(/** @type {Node | null} */ (event.relatedTarget))) zone.classList.remove('dropping');
    });
    zone.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      zone.classList.remove('dropping');
      this.add([...event.dataTransfer.files]);
    });
    opts.pasteTarget?.addEventListener('paste', (event) => {
      const pasted = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!pasted.length) return; // plain text pastes as usual
      event.preventDefault();
      this.add(pasted.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }))));
    });

    this.render();
  }

  /** @param {File[]} incoming */
  add(incoming) {
    const problems = [];
    for (const file of incoming) {
      if (!file.type.startsWith('image/')) problems.push(`${file.name} isn't an image`);
      else if (file.size > MAX_FILE_BYTES) problems.push(`${file.name} is over 10 MB`);
      else if (this.files.length >= MAX_FILES) problems.push(`only ${MAX_FILES} images per task`);
      else if (this.totalBytes() + file.size > MAX_TOTAL_BYTES) problems.push('the images add up to more than 25 MB');
      else this.files.push(file);
    }
    if (problems.length) this.onError(`Not attached: ${[...new Set(problems)].join('; ')}.`);
    this.render();
  }

  totalBytes() {
    return this.files.reduce((sum, f) => sum + f.size, 0);
  }

  render() {
    this.previews.forEach((url) => URL.revokeObjectURL(url));
    this.previews = this.files.map((f) => URL.createObjectURL(f));
    this.list.replaceChildren(...this.files.map((file, i) => {
      const item = document.createElement('li');
      const img = document.createElement('img');
      img.src = this.previews[i];
      img.alt = '';
      const name = document.createElement('span');
      name.className = 'attach-name';
      name.textContent = file.name;
      const size = document.createElement('span');
      size.className = 'hint';
      size.textContent = formatSize(file.size);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attach-remove';
      remove.setAttribute('data-remove', String(i));
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.textContent = '×';
      item.append(img, name, size, remove);
      return item;
    }));
    this.list.hidden = this.files.length === 0;
    this.button.textContent = this.files.length ? `📎 ${this.files.length} image${this.files.length === 1 ? '' : 's'} · add more` : '📎 Attach images';
  }

  /** Read every file for sending. @returns {Promise<UploadedFile[] | undefined>} */
  async read() {
    if (!this.files.length) return undefined;
    return Promise.all(this.files.map(async (file) => ({ name: file.name, data: await toBase64(file) })));
  }

  clear() {
    this.files.splice(0);
    this.render();
  }
}

/** @param {File} file @returns {Promise<string>} */
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** @param {number} bytes */
function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
