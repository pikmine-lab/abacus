import { readFileSync } from 'node:fs'

/**
 * What the web driver notes for the coverage guards, read from what the page
 * really sends rather than from what a step says it does: the server action a
 * request calls, by the id Next sends in its `Next-Action` header, and the
 * screen a navigation lands on.
 */

/** The server actions of a build, by the id a page sends for each. */
export function actionNames(manifestPath: string): Map<string, string> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    node: Record<string, { exportedName?: string }>
  }
  return new Map(
    Object.entries(manifest.node).flatMap(([id, action]) =>
      action.exportedName ? [[id, action.exportedName] as const] : [],
    ),
  )
}

/** The server action a request calls, from its headers; none for any other request. */
export function actionOf(headers: Record<string, string>, names: Map<string, string>): string | undefined {
  const id = headers['next-action']
  return id === undefined ? undefined : names.get(id)
}

/** The screen a page of the app is on: its path, without query or trailing slash. */
export function screenOf(url: string): string {
  return `screen:${new URL(url).pathname.replace(/(.)\/$/, '$1')}`
}
