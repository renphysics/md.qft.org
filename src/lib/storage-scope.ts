/**
 * Keep project sites on the same origin from sharing editor state by accident.
 * Root deployments retain the original keys so existing documents remain visible.
 * This is namespacing, not a security boundary between same-origin applications.
 */
export function scopedStorageKey(key: string, base = import.meta.env?.BASE_URL ?? '/'): string {
  const path = base.split('/').filter(Boolean).join('/');
  return path ? `${key}:/${path}/` : key;
}
