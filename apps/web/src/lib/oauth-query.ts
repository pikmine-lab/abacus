/**
 * The query a page was opened with, rebuilt as a string-keyed list: every
 * value of every key, in order. Next hands search params over as a record;
 * an authorization request signed by Better Auth has to go back exactly as
 * it came, or its signature no longer matches.
 */
export function oauthQuery(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v)
  }
  return query
}
