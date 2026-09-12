export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function dataUrl(mime, b64) {
  return `data:${mime};base64,${b64}`;
}

export function putText(pending, path, mime, text) {
  return { ...pending, [path]: { mime, b64: toBase64(text) } };
}

export function putBase64(pending, path, mime, b64) {
  return { ...pending, [path]: { mime, b64 } };
}

export function remove(pending, path) {
  const next = { ...pending };
  delete next[path];
  return next;
}
