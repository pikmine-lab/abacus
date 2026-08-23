import { auth } from '@abacus/core/auth'
import { listVenues } from '@abacus/core/prices/search'
import { headers } from 'next/headers'

/**
 * The venues of one fund, fetched only when someone asks to see them. Listing
 * them for every result would cost a search and a price per venue on each
 * keystroke, for information almost nobody needs: the euro line is picked
 * anyway, and the others exist to be checked, not browsed.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const fund = new URL(request.url).searchParams.get('fund') ?? ''
  if (fund.trim().length < 2) return Response.json([])
  try {
    return Response.json(await listVenues(fund))
  } catch {
    return Response.json([])
  }
}
