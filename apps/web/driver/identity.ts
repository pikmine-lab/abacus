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

export function identitySteps({ page, env, visit, settle, exercised }: WebContext): Partial<Steps> {
  // The person signed in on the page: the case user until a sign-up replaces them.
  let person = 'Camille'

  /** The app moves on by client-side navigation, which fires no new load event. */
  async function landedOn(path: string): Promise<void> {
    await page.waitForFunction((wanted) => location.pathname === wanted, path)
  }

  async function loginForm(): Promise<void> {
    await visit('/login')
    await page.getByRole('textbox', { name: 'Email' }).waitFor()
  }

  return {
    async signUp({ name, email, password }) {
      await exercised('screen:/login')
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
      await exercised('screen:/')
      await visit('/')
      await page.getByRole('button', { name: new RegExp(`${person}$`) }).click()
      await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
      await landedOn('/login')
    },
    async signIn({ email, password }) {
      await exercised('screen:/login')
      await loginForm()
      await page.getByRole('textbox', { name: 'Email' }).fill(email)
      await page.getByRole('textbox', { name: 'Mot de passe' }).fill(password)
      await page.getByRole('button', { name: 'Se connecter' }).click()
      const refused = page.getByText('Email ou mot de passe incorrect.')
      const landed = landedOn('/').then(() => 'signed-in' as const)
      return await Promise.race([landed, refused.waitFor().then(() => 'refused' as const)])
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
        return new URL(visitor.url()).pathname === '/login' ? 'refused' : 'let-in'
      } finally {
        await anonymous.close()
      }
    },
    async answerAccessRequest(answer) {
      await exercised('screen:/consent')
      const verifier = randomBytes(32).toString('base64url')
      const mcpUrl = process.env.ABACUS_CASES_MCP_URL as string
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
      if (new URL(page.url()).pathname === '/consent') await button.click()
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
      return token.ok && ((await token.json()) as { access_token?: string }).access_token
        ? 'token'
        : 'no-token'
    },
    async readAccountNames() {
      await exercised('screen:/accounts')
      await visit('/accounts')
      await page.getByRole('heading', { name: 'Comptes', level: 1 }).waitFor()
      const actions = await page.getByRole('button', { name: /^Actions sur / }).all()
      return Promise.all(
        actions.map(async (b) => ((await b.getAttribute('aria-label')) ?? '').replace(/^Actions sur /, '')),
      )
    },
    async correctSomeoneElsesMovement(movementId, amount) {
      await visit(`/movements?movement=${encodeURIComponent(movementId)}`)
      const correct = page.getByRole('dialog').getByRole('button', { name: 'Corriger' })
      try {
        await correct.waitFor({ timeout: 3000 })
      } catch {
        return 'refused'
      }
      await exercised('correctMovementAction')
      await correct.click()
      const panel = page.getByRole('dialog').last()
      await panel.getByRole('textbox', { name: 'Montant' }).fill(typed(amount))
      await panel.getByRole('button', { name: 'Enregistrer' }).click()
      await settle(panel)
      return 'corrected'
    },
  }
}
