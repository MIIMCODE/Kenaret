/**
 * The lock on the private room.
 *
 * Design note, because this is the part that matters:
 *
 * The PIN is **never** sent to the server, and there is no "PIN hash" in the
 * database to check it against. Instead:
 *
 *   PIN ──PBKDF2(310k, per-couple salt)──▶ wrapping key
 *   wrapping key ──AES-GCM unwrap──▶ the room's data key
 *   data key ──AES-GCM──▶ every photo and every note
 *
 * So the only way to know whether a PIN is right is to try to unwrap the data
 * key. Wrong PIN ⇒ the GCM authentication tag fails ⇒ we say «رمز درست نیست»
 * and, crucially, the server never learned anything either way.
 *
 * The consequence is not a bug we can fix: **we cannot recover a lost PIN**,
 * because recovering it would mean being able to read the room. The UI says
 * so before anyone commits, and the setup step asks for it twice.
 */

const PBKDF2_ITERATIONS = 310_000
const IV_BYTES = 12
const SALT_BYTES = 16

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c?.subtle) {
    throw new Error(
      'این مرورگر رمزنگاری امن را در دسترس نمی‌گذارد. از Chrome، Safari یا Firefox جدید استفاده کن — یا آدرس را روی https باز کن.',
    )
  }
  return c.subtle
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

async function deriveWrappingKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(pin.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

/** The data key of an open room. Lives in memory only — never in localStorage. */
export type VaultSession = { dataKey: CryptoKey }

/**
 * Creates the room: a fresh random data key, wrapped with the PIN.
 *
 * The data key is generated here rather than derived from the PIN on purpose.
 * If it were derived, changing the PIN would mean re-encrypting every file;
 * wrapped, changing the PIN touches one row.
 */
export async function createVault(
  pin: string,
): Promise<{ session: VaultSession; material: { salt: string; iv: string; wrapped: string; iters: number } }> {
  const salt = randomBytes(SALT_BYTES)
  const wrapIv = randomBytes(IV_BYTES)

  const dataKey = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const wrappingKey = await deriveWrappingKey(pin, salt, PBKDF2_ITERATIONS)

  const wrapped = await subtle().wrapKey('raw', dataKey, wrappingKey, {
    name: 'AES-GCM',
    iv: wrapIv as unknown as BufferSource,
  })

  // Re-import as non-extractable: the raw key should exist on this device only
  // for the instant it takes to wrap it.
  const raw = await subtle().exportKey('raw', dataKey)
  const sessionKey = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

  return {
    session: { dataKey: sessionKey },
    material: {
      salt: toBase64(salt),
      iv: toBase64(wrapIv),
      wrapped: toBase64(new Uint8Array(wrapped)),
      iters: PBKDF2_ITERATIONS,
    },
  }
}

/**
 * Opens the room with a PIN.
 *
 * Returns null on a wrong PIN. There is nothing else it *can* return: the
 * unwrap either authenticates or it does not.
 */
export async function openVault(
  pin: string,
  material: { kdf_salt: string; kdf_iters: number; wrap_iv: string; wrapped_key: string },
): Promise<VaultSession | null> {
  try {
    const salt = fromBase64(material.kdf_salt)
    const wrappingKey = await deriveWrappingKey(pin, salt, material.kdf_iters ?? PBKDF2_ITERATIONS)

    const dataKey = await subtle().unwrapKey(
      'raw',
      fromBase64(material.wrapped_key) as unknown as BufferSource,
      wrappingKey,
      { name: 'AES-GCM', iv: fromBase64(material.wrap_iv) as unknown as BufferSource },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )

    return { dataKey }
  } catch {
    // A failed GCM tag lands here, and so does a corrupt row. Both mean the
    // same thing to the person typing: that PIN does not open this room.
    return null
  }
}

/** Encrypts bytes. Returns the ciphertext and the IV it needs to come back. */
export async function sealBytes(
  session: VaultSession,
  bytes: Uint8Array,
): Promise<{ cipher: ArrayBuffer; iv: string }> {
  const iv = randomBytes(IV_BYTES)
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    session.dataKey,
    bytes as unknown as BufferSource,
  )
  return { cipher, iv: toBase64(iv) }
}

export async function openBytes(
  session: VaultSession,
  cipher: ArrayBuffer | Uint8Array,
  ivBase64: string,
): Promise<ArrayBuffer> {
  return subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivBase64) as unknown as BufferSource },
    session.dataKey,
    (cipher instanceof Uint8Array ? cipher : new Uint8Array(cipher)) as unknown as BufferSource,
  )
}

export async function sealText(
  session: VaultSession,
  text: string,
): Promise<{ cipher: string; iv: string }> {
  const { cipher, iv } = await sealBytes(session, new TextEncoder().encode(text))
  return { cipher: toBase64(new Uint8Array(cipher)), iv }
}

export async function openText(
  session: VaultSession,
  cipherBase64: string,
  ivBase64: string,
): Promise<string> {
  const plain = await openBytes(session, fromBase64(cipherBase64), ivBase64)
  return new TextDecoder().decode(plain)
}

/** PBKDF2 with 310k rounds is deliberately slow; tell the user why they wait. */
export const KEY_DERIVATION_NOTICE = 'یک لحظه — کلید دارد ساخته می‌شود.'
