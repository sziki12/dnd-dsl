// Pure checks for the map image upload - no React dependency. The server repeats them (it also checks the
// file's first bytes), so these only give an answer before anything is sent.

/** Same limit as the backend's MAX_IMAGE_BYTES. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** For the file input's `accept`. */
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(',');

/** What is wrong with a chosen file, or undefined when it can be uploaded. An unknown type is left for the server to judge. */
export function validateImageFile(file: { type: string; size: number }): string | undefined {
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > MAX_IMAGE_BYTES) return `The image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;
  if (file.type !== '' && !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Use a PNG, JPEG, WebP or GIF image.';
  return undefined;
}

/** The message in a Nest error body (a string or a list of strings), or a generic one with the status. */
export function errorMessageOf(body: unknown, status: number): string {
  const message = typeof body === 'object' && body !== null ? (body as { message?: unknown }).message : undefined;
  if (typeof message === 'string' && message.trim() !== '') return message;
  if (Array.isArray(message) && message.length > 0 && message.every(m => typeof m === 'string')) return message.join(' ');
  return `The upload failed (${status}).`;
}
