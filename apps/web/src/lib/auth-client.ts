import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { createAuthClient } from 'better-auth/react'

// The OAuth plugin carries the signed authorization request of the page
// (login reached from an AI client) into sign-in and sign-up, so the server
// resumes the flow instead of opening the app.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] })
