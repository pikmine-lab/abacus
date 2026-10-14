import { auth } from '@abacus/core/auth'
import { headers } from 'next/headers'
import { movementDetail } from '@/lib/movement-detail'
import { idParam } from '@/lib/utils'

/**
 * One movement, for its reading panel. A route rather than a server action
 * because it reads and is fetched on opening, not posted: opening a movement
 * reads that movement alone, never the page around it.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const id = idParam((await ctx.params).id)
  const detail = id ? await movementDetail(session.user.id, id) : null
  if (!detail) return new Response('Not found', { status: 404 })
  return Response.json(detail)
}
