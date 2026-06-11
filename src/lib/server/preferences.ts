import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db'
import { user } from '~/lib/db/schema'
import { requireUser } from '~/lib/auth/session'

// Per-user UI preferences. The theme choice is stored on the user row so it
// follows the account across devices/sessions rather than living only in a
// device-local cookie. The cookie (driven by @synek/ui's ThemeProvider) is kept
// as a fast pre-hydration cache; ThemeSync reconciles it with this server value.

const themeSchema = z.enum(['light', 'dark', 'system'])
export type Theme = z.infer<typeof themeSchema>

export const getUserTheme = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ theme: Theme }> => {
    const u = await requireUser()
    const row = db.select({ theme: user.theme }).from(user).where(eq(user.id, u.id)).get()
    const parsed = themeSchema.safeParse(row?.theme)
    return { theme: parsed.success ? parsed.data : 'system' }
  },
)

export const setUserTheme = createServerFn({ method: 'POST' })
  .inputValidator((d: { theme: Theme }) => z.object({ theme: themeSchema }).parse(d))
  .handler(async ({ data }): Promise<{ theme: Theme }> => {
    const u = await requireUser()
    db.update(user).set({ theme: data.theme }).where(eq(user.id, u.id)).run()
    return { theme: data.theme }
  })
