let activePrivateKey: CryptoKey | null = null;

export function setActivePrivateKey(key: CryptoKey | null) {
  activePrivateKey = key;
}

export function getActivePrivateKey() {
  return activePrivateKey;
}

export function saveSession(token: string, key: CryptoKey) {
  localStorage.setItem('vaultshare_token', token);
  setActivePrivateKey(key);
}

export function clearSession() {
  localStorage.removeItem('vaultshare_token');
  setActivePrivateKey(null);
}
