import { createHash, randomBytes } from 'node:crypto'
import type { Steps } from '@abacus/use-case-language'
import { typed, type WebContext } from './context.ts'

/**
 * A pre-registered client the case user has not consented to yet: signing the
 * user in for the MCP driver already consented for Cursor, and a remembered
 * consent skips the page this step answers.
 */
const CLIENT_ID = 'microsoft-365-copilot'
const REDIRECT_URI = 'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect'

export function identitySteps({ page, env, visit, settle }: WebContext): Partial<Steps> {
  // The person signed in on the page: the case user until a sign-up replaces them.
  let person = 'Camille'

  /** The app moves on by client-side navigation, which fires no new load event. */
  async function landedOn(path: string): Promise<void> {
    await page.waitForFunction(
      (wanted) => (globalThis as unknown as { location: { pathname: string } }).location.pathname === wanted,
      path,
    )
  }

  async function loginForm(): Promise<void> {
    await visit('/login')
    await page.getByRole('textbox', { name: 'Email' }).waitFor()
  }

  return {
    async signUp({ name, email, password }) {
      await page.context().clearCookies()
      await loginForm()
      await page.getByRole('button', { name: 'Créer un compte' }).click()
      await page.getByRole('textbox', { name: 'Prénom' }).fill(name)
      await page.getByRole('textbox', { name: 'Email' }).fill(email)
      await page.getByRole('textbox', { name: 'Mot de passe' }).fill(password)
      await page.getByRole('button', { name: 'Créer le compte' }).click()
      await landedOn('/')
      person = name
    },
    async signOut() {
      await visit('/')
      await page.getByRole('button', { name: new RegExp(`${person}$`) }).click()
      await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
      await landedOn('/login')
    },
    async signIn({ email, password }) {
      await loginForm()
      await page.getByRole('textbox', { name: 'Email' }).fill(email)
      await page.getByRole('textbox', { name: 'Mot de passe' }).fill(password)
      // Read by its effect, not its wording: whether the sign-in opened a session.
      const answered = page.waitForResponse((r) =>
        new URL(r.url()).pathname.endsWith('/api/auth/sign-in/email'),
      )
      await page.getByRole('button', { name: 'Se connecter' }).click()
      if (!(await answered).ok()) return 'refused'
      await landedOn('/')
      return 'signed-in'
    },
    async reachesTheApp() {
      await visit('/')
      return new URL(page.url()).pathname !== '/login'
    },
    async comeAnonymously() {
      const anonymous = await page.context().browser()!.newContext({ locale: 'fr-FR' })
      try {
        const visitor = await anonymous.newPage()
        await visitor.goto(`${env.webUrl}/accounts`)
        return new URL(visitor.url()).pathname === '/login' ? 'sent-to-sign-in' : 'let-in'
      } finally {
        await anonymous.close()
      }
    },
    async answerAccessRequest(answer) {
      const verifier = randomBytes(32).toString('base64url')
      const { mcpUrl } = env
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'mcp offline_access',
        state: 'consent-case',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        resource: mcpUrl,
      })
      // The redirect leaves the machine: it is read, and cut like any outside request.
      const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT_URI))
      // A redirect straight back to the client (an error) cuts the navigation.
      await visit(`/api/auth/oauth2/authorize?${query}`).catch(() => {})
      const button = page.getByRole('button', { name: answer === 'accept' ? 'Autoriser' : 'Refuser' })
      // The consent page, or a redirect straight back when nothing is asked.
      await Promise.race([button.waitFor(), back])
      if (await button.isVisible()) await button.click()
      const returned = new URL((await back).url())
      if (returned.searchParams.get('error') && answer === 'accept')
        throw new Error(`the authorization came back with ${returned.search}`)
      const code = returned.searchParams.get('code')
      if (!code) return 'no-token'
      const token = await fetch(`${env.webUrl}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          resource: mcpUrl,
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
        }),
      })
      const accessToken = token.ok
        ? ((await token.json()) as { access_token?: string }).access_token
        : undefined
      if (!accessToken) return 'no-token'
      // What the client does next: a tool, called with that token.
      const called = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_overview', arguments: {} },
        }),
      })
      const reply = await called.text()
      if (!called.ok || !reply.includes('"result"') || reply.includes('"isError":true'))
        throw new Error(`the client got a token but its call failed: ${called.status} ${reply.slice(0, 200)}`)
      return 'reaches-data'
    },
    async readConnectedApps() {
      await visit('/connect-ai')
      const region = page.getByRole('region', { name: 'Applications' })
      await region.waitFor()
      const menus = await region.getByRole('button', { name: /^Actions sur l’accès de / }).all()
      return Promise.all(
        menus.map(async (menu) => {
          const name = ((await menu.getAttribute('aria-label')) ?? '').replace(/^Actions sur l’accès de /, '')
          const row = menu.locator('xpath=ancestor::*[.//p][1]')
          const [, domain] = (await row.innerText()).split('\n').map((line) => line.trim())
          return { name, domain: domain && !domain.startsWith('autorisée') ? domain : null }
        }),
      )
    },
    async revokeConnectedApp(name) {
      await visit('/connect-ai')
      await page.getByRole('button', { name: `Actions sur l’accès de ${name}` }).click()
      await page.getByRole('menuitem', { name: 'Révoquer l’accès' }).click()
      const answered = page.waitForResponse(
        (response) => response.request().headers()['next-action'] !== undefined,
      )
      await page.getByRole('alertdialog').getByRole('button', { name: 'Révoquer', exact: true }).click()
      await answered
    },
    async readAccountNames() {
      await visit('/accounts')
      await page.getByRole('heading', { name: 'Comptes', level: 1 }).waitFor()
      const actions = await page.getByRole('button', { name: /^Actions sur / }).all()
      return Promise.all(
        actions.map(async (b) => ((await b.getAttribute('aria-label')) ?? '').replace(/^Actions sur /, '')),
      )
    },
    async readMovementCounterparties() {
      await visit('/movements')
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      const rows = await page.getByRole('button', { name: /^Ouvrir / }).all()
      return Promise.all(
        rows.map(async (row) => ((await row.getAttribute('aria-label')) ?? '').split(' · ')[1] as string),
      )
    },
    async correctSomeoneElsesMovement(movementId, amount) {
      // The panel asks the app for the movement: the data, not a button, says whether it is there.
      const read = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith(`/api/movements/${movementId}`),
      )
      await visit(`/movements?movement=${encodeURIComponent(movementId)}`)
      if (!(await read).ok()) return 'refused'
      const correct = page.getByRole('dialog').getByRole('button', { name: 'Corriger' })
      await correct.click()
      const panel = page.getByRole('dialog').last()
      await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
      return 'corrected'
    },
    async correctSomeoneElsesCommitment(commitmentId, label) {
      // A link to a commitment leads to its row; the row is the data.
      await visit(`/recurring-expenses?commitment=${encodeURIComponent(commitmentId)}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      const row = page.locator(`[data-commitment="${commitmentId}"]`)
      if ((await row.count()) === 0) return 'refused'
      await row
        .getByRole('button', { name: /^Actions sur / })
        .first()
        .click()
      await page.getByRole('menuitem', { name: 'Modifier' }).click()
      const panel = page.getByRole('dialog').last()
      await panel.getByRole('textbox', { name: 'Nom' }).fill(label)
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
      return 'corrected'
    },
  }
}
