import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * What the web offers, as the web driver names it: every server action the
 * app exports, and every screen (`screen:<route>`, a dynamic segment kept as
 * written). The inventory guard compares the inventory to it.
 */
export function webSurface(): { elements: string[] } {
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  const actions = [
    ...readFileSync(`${src}lib/actions.ts`, 'utf8').matchAll(/^export async function (\w+Action)\b/gm),
  ].map(([, name]) => name as string)
  const screens = (readdirSync(`${src}app`, { recursive: true }) as string[])
    .filter((path) => /(^|\/)page\.tsx$/.test(path) && !path.startsWith('api/'))
    .map((path) => {
      const route = path
        .replace(/(^|\/)page\.tsx$/, '')
        .split('/')
        .filter((segment) => segment && !/^\(.+\)$/.test(segment))
        .join('/')
      return `screen:/${route}`
    })
  return { elements: [...actions, ...screens] }
}
