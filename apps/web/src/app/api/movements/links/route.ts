import { auth } from '@abacus/core/auth'
import { headers } from 'next/headers'
import { searchLinkChoices } from '@/lib/advance-data'

/**
 * The movements a link between two movements can point at, for what was typed:
 * the expenses an income pays back (`side=expense`), or the incomes an expense
 * was paid back by (`side=income`). A route rather than a server action
 * because it answers keystrokes, as the instrument search does.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const params = new URL(request.url).searchParams
  const side = params.get('side')
  if (side !== 'expense' && side !== 'income') return new Response('Bad side', { status: 400 })
  // What anyone types to find a movement fits well within this; a longer text
  // is cut, not refused, since the field sends what is typed as it goes.
  const q = (params.get('q') ?? '').slice(0, 200)
  return Response.json(await searchLinkChoices(session.user.id, side, q))
}
