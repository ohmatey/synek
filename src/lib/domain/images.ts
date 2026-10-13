import { z } from 'zod'

// Image URLs reach <img src> on pages other people open (the public story and
// series readers), and are written by an MCP client we do not control. This is the
// single allowlist, used at the Zod write boundaries AND again at the public
// render sites, so a row that predates the boundary (or arrives by a path that
// skips it) still cannot put a hostile scheme in front of a reader.
//
// Allowed: absolute http(s) URLs, and data:image/* URIs (the node panel's manual
// upload stores the file as a data URL: see files.ts). Everything else, including
// javascript:, file:, blob:, data:text/html, protocol-relative and relative paths,
// is refused.

const HTTP_URL = /^https?:\/\/[^\s]+$/i
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i

export function safeImageUrl(url: string | null | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  if (DATA_IMAGE.test(raw)) return raw
  return HTTP_URL.test(raw) ? raw : null
}

// Render-site helper: returns the image unchanged when its URL is allowed, else
// null, so callers keep their existing `image && <img />` conditionals.
export function safeImage<T extends { url: string }>(image: T | null | undefined): T | null {
  return image && safeImageUrl(image.url) ? image : null
}

export const IMAGE_URL_MESSAGE = 'must be an http(s) URL or a data:image/* URI'

// Zod boundary. Trims, then refuses anything safeImageUrl would. Chain `.describe()`
// / `.optional()` on it as usual.
export const imageUrlSchema = z
  .string()
  .trim()
  .refine((u) => safeImageUrl(u) !== null, { message: IMAGE_URL_MESSAGE })
