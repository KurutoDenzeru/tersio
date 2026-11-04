// Seals a backup with the user's passphrase before it leaves this computer: the remote only ever sees ciphertext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('TSYNC1\n', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;

function key(passphrase: string, salt: Buffer): Buffer {
  // scrypt's default cost is ~16 MB and 200 ms, which is right for a file read once per backup.
  return scryptSync(passphrase, salt, 32);
}

/** `MAGIC | salt | iv | tag | ciphertext`; no length field, so a truncated download fails the tag check. */
export function seal(bytes: Buffer, passphrase: string): Buffer {
  if (passphrase.trim() === '') throw new Error('a passphrase is required to seal a backup');
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/** Throws a readable message for the three failures a user can hit: not ours, wrong passphrase, damaged file. */
export function open(sealed: Buffer, passphrase: string): Buffer {
  if (sealed.length < HEADER_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('this file is not a sealed Tersio backup');
  }
  if (passphrase.trim() === '') throw new Error('the passphrase is empty');
  const salt = sealed.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = sealed.subarray(MAGIC.length + SALT_BYTES, MAGIC.length + SALT_BYTES + IV_BYTES);
  const tag = sealed.subarray(MAGIC.length + SALT_BYTES + IV_BYTES, HEADER_BYTES);
  const body = sealed.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error('the passphrase does not open this backup, or the file is damaged');
  }
}
