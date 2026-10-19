const enc = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const un64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export type KeyBundle = { public_key: string; encrypted_private_key: string; private_key_iv: string; kdf_salt: string };
export async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function makeKeyBundle(password: string): Promise<KeyBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['encrypt','decrypt']);
  const privateBytes = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(password, salt), privateBytes);
  return { public_key: b64(await crypto.subtle.exportKey('spki', pair.publicKey)), encrypted_private_key: b64(encrypted), private_key_iv: b64(iv), kdf_salt: b64(salt) };
}
export async function unlockPrivateKey(bundle: KeyBundle, password: string) {
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(bundle.private_key_iv) }, await derive(password, un64(bundle.kdf_salt)), un64(bundle.encrypted_private_key));
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}
export async function encryptFile(file: File, publicKey: string) {
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, await file.arrayBuffer());
  const rawKey = await crypto.subtle.exportKey('raw', aes);
  const rsa = await crypto.subtle.importKey('spki', un64(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, rawKey);
  const checksum = await crypto.subtle.digest('SHA-256', ciphertext);
  return { ciphertext, nonce: b64(iv), checksum: [...new Uint8Array(checksum)].map(x=>x.toString(16).padStart(2,'0')).join(''), wrapped_key: b64(wrapped) };
}
export async function decryptFile(ciphertext: ArrayBuffer, nonce: string, wrappedKey: string, privateKey: CryptoKey) {
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, un64(wrappedKey));
  const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(nonce) }, aes, ciphertext);
}
export async function checksum(data: ArrayBuffer) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export async function rewrapForRecipient(wrappedKey: string, privateKey: CryptoKey, recipientPublic: string) {
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, un64(wrappedKey));
  const publicKey = await crypto.subtle.importKey('spki', un64(recipientPublic), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  return b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, raw));
}
