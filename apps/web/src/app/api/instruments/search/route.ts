import { auth } from '@abacus/core/auth'
import { searchInstruments } from '@abacus/core/prices/search'
import { headers } from 'next/headers'

/**
 * Instrument search, for the panel that declares a holding. A route rather than
 * a server action because it answers keystrokes: the field queries as the user
 * types, and an action per keystroke would serialize behind the previous one.
 *
 * Behind the session on purpose. It proxies two third-party APIs, so leaving it
 * open would make this deployment an anonymous relay to them.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const query = new URL(request.url).searchParams.get('q') ?? ''
  try {
    return Response.json(await searchInstruments(query))
  } catch {
    // Both sources are unofficial or rate-limited: an empty list lets the field
    // say "nothing found" instead of breaking the panel around it.
    return Response.json([])
  }
}
