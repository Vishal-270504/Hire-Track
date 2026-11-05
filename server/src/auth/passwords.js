import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
