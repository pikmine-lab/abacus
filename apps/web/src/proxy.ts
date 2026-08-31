import { type NextRequest, NextResponse } from 'next/server'

// The reading cookie, named and explained in src/lib/reading.ts. Repeated here
// rather than imported: Next bundles the proxy apart from the render code and
// says not to rely on shared modules, and importing that file would drag the
// database layer along with it.
const READING_COOKIE = 'reading'

function parse(value: string | null | undefined): string | null {
  return value === 'cash' || value === 'accrual' ? value : null
}

/**
 * How long a reading switched on a screen lasts: the visit, and not one page
 * load longer.
 *
 * The URL always says what a screen counts in, so a request carrying the
 * parameter also (re)opens the cookie that makes the choice follow to the next
 * screen. A request without it depends on how it was made: walking the app
 * keeps the cookie, so the choice holds from screen to screen, while loading a
 * document (a reload, a pasted link, a new tab) drops it and starts over from
 * the profile, which is the only place a lasting reading is written.
 *
 * `Sec-Fetch-Dest` is what separates the two, and it is the browser's own
 * header rather than one of Next's: the framework hides its RSC headers here
 * on purpose, so a navigation cannot accidentally answer differently from a
 * page load. This is that difference, wanted. A browser too old to send the
 * header keeps its cookie across a reload, which is the previous behaviour,
 * not a wrong reading.
 */
export function proxy(request: NextRequest): NextResponse {
  const asked = parse(request.nextUrl.searchParams.get('reading'))
  if (asked) {
    const response = NextResponse.next()
    response.cookies.set(READING_COOKIE, asked, { path: '/', sameSite: 'lax' })
    return response
  }

  if (request.headers.get('sec-fetch-dest') !== 'document') return NextResponse.next()

  // Dropped from the request too, not just from the browser: this very page
  // must already be rendered without it.
  request.cookies.delete(READING_COOKIE)
  const response = NextResponse.next({ request })
  response.cookies.delete(READING_COOKIE)
  return response
}

export const config = {
  // Everything the person navigates, and nothing else: the reading belongs to
  // screens, and running on assets would cost a pass per file for nothing.
  matcher: ['/((?!api|_next/static|_next/image|icon.svg).*)'],
}
