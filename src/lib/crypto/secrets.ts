import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// Reversible secret-at-rest encryption for per-user credentials (the BYO OpenRouter
// key). UNLIKE api-keys.ts (which one-way sha256-hashes its keys, since they're only
// ever compared), the OpenRouter key must be DECRYPTED to call the API — so this is
// AES-256-GCM, keyed by a master secret the operator sets at deploy time
// (SYNEK_SECRETS_KEY), mirroring the BETTER_AUTH_SECRET pattern. The plaintext key
// never leaves the server.
//
// Blob format (all base64, ':'-joined): v1:<salt>:<iv>:<authTag>:<ciphertext>.
// A random per-record salt + iv means identical plaintexts encrypt differently and
// the master secret can later be rotated by re-encrypting (version tag reserves room).

const VERSION = 'v1'
const SALT_LEN = 16
const IV_LEN = 12 // GCM standard
const KEY_LEN = 32 // AES-256

function master(): string {
  const k = process.env.SYNEK_SECRETS_KEY?.trim()
  if (!k) {
    throw new Error(
      'SYNEK_SECRETS_KEY is not set — required to store per-user secrets (e.g. an OpenRouter key). ' +
        'Set it like BETTER_AUTH_SECRET (e.g. `openssl rand -base64 32`).',
    )
  }
  return k
}

/** True when a master secret is configured, so callers can gate the BYO-key UI. */
export function secretsConfigured(): boolean {
  return !!process.env.SYNEK_SECRETS_KEY?.trim()
}

/** Encrypt a plaintext secret to a self-describing blob. Throws if unconfigured. */
export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = scryptSync(master(), salt, KEY_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, salt.toString('base64'), iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

/** Decrypt a blob produced by encryptSecret. Throws on a bad key / tampered blob. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(':')
  if (parts.length !== 5 || parts[0] !== VERSION) throw new Error('malformed secret blob')
  const [, saltB64, ivB64, tagB64, ctB64] = parts
  const key = scryptSync(master(), Buffer.from(saltB64, 'base64'), KEY_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
