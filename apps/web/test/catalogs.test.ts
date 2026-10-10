import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { LANGUAGES } from '@abacus/core/domain'

/**
 * Every language the interface speaks says everything the French one says,
 * and nothing else. The types only hold the shape to French in one direction;
 * this holds it in both, and catches a catalog file that exists in one
 * language and not in the other.
 */

const root = new URL('../src/i18n/messages/', import.meta.url)

function catalog(language: string): Record<string, unknown> {
  const dir = new URL(`${language}/`, root)
  const entries = readdirSync(dir).filter((file) => file.endsWith('.json'))
  return Object.fromEntries(
    entries.map((file) => [file.slice(0, -5), JSON.parse(readFileSync(new URL(file, dir), 'utf8'))]),
  )
}

/** Every leaf as "namespace.path.to.key", with the text it holds. */
function leaves(node: unknown, prefix = ''): Map<string, string> {
  const found = new Map<string, string>()
  if (typeof node === 'string') {
    found.set(prefix, node)
    return found
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>))
    for (const [path, text] of leaves(child, prefix ? `${prefix}.${key}` : key)) found.set(path, text)
  return found
}

/**
 * The ICU arguments and rich-text tags a message names, so a translation
 * cannot drop or rename one. Branch bodies of a plural or a select are
 * messages of their own and are walked, never taken for arguments.
 */
function argumentsOf(text: string): string[] {
  const found = new Set<string>()
  let at = 0

  const skipSpaces = () => {
    while (/\s/.test(text[at] ?? '')) at++
  }
  const word = () => {
    const start = at
    while (/[\w=-]/.test(text[at] ?? '')) at++
    return text.slice(start, at)
  }
  /** Reads a message until the brace that closes it, or the end. */
  const message = () => {
    while (at < text.length && text[at] !== '}') {
      const tag = /^<\/?(\w+)>/.exec(text.slice(at))
      if (tag) {
        found.add(`<${tag[1]}>`)
        at += tag[0].length
      } else if (text[at] === '{') {
        at++
        argument()
      } else at++
    }
  }
  /** Reads `name}`, `name, type}` or `name, plural|select…, key {message}…}`. */
  const argument = () => {
    skipSpaces()
    found.add(word())
    skipSpaces()
    if (text[at] === ',') {
      at++
      skipSpaces()
      const type = word()
      skipSpaces()
      if (['plural', 'select', 'selectordinal'].includes(type) && text[at] === ',') {
        at++
        skipSpaces()
        while (at < text.length && text[at] !== '}') {
          if (text.startsWith('offset:', at)) at += 'offset:'.length
          word()
          skipSpaces()
          if (text[at] === '{') {
            at++
            message()
            at++
          }
          skipSpaces()
        }
      } else {
        while (at < text.length && text[at] !== '}') at++
      }
    }
    at++
  }

  message()
  return [...found].sort()
}

test('branch bodies are walked, not taken for arguments', () => {
  assert.deepEqual(argumentsOf('{kind, select, income {Revenus} other {Dépenses}} par {dimension}'), [
    'dimension',
    'kind',
  ])
  assert.deepEqual(argumentsOf('{count, plural, =0 {Aucun} one {# de {name}} other {# de {name}}}'), [
    'count',
    'name',
  ])
  assert.deepEqual(argumentsOf('<strong>{amount}</strong> le {day, selectordinal, other {#e}}'), [
    '<strong>',
    'amount',
    'day',
  ])
})

const reference = leaves(catalog('fr'))

test('the French catalog is not empty', () => {
  assert.ok(reference.size > 0)
})

for (const language of LANGUAGES.filter((l) => l !== 'fr')) {
  test(`the ${language} catalog has exactly the French keys`, () => {
    const translated = leaves(catalog(language))
    const missing = [...reference.keys()].filter((key) => !translated.has(key))
    const extra = [...translated.keys()].filter((key) => !reference.has(key))
    assert.deepEqual(missing, [], `missing in ${language}`)
    assert.deepEqual(extra, [], `only in ${language}`)
  })

  test(`the ${language} catalog keeps every argument of the French one`, () => {
    const translated = leaves(catalog(language))
    for (const [key, text] of reference) {
      const other = translated.get(key)
      if (other === undefined) continue
      assert.deepEqual(argumentsOf(other), argumentsOf(text), `${key} in ${language}`)
    }
  })
}

test('no message is left empty', () => {
  for (const language of LANGUAGES)
    for (const [key, text] of leaves(catalog(language)))
      assert.ok(text.trim().length > 0, `${key} is empty in ${language}`)
})
