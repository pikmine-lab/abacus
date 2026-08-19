import { auth } from '@abacus/core/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { NavLinks } from '@/components/nav-links'
import { UserMenu } from '@/components/user-menu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  return (
    <div className="mx-auto max-w-[1160px] px-3 pb-12 sm:px-5">
      <header className="flex items-center gap-3 py-3 sm:gap-6">
        <Link href="/" className="font-mono text-[15px] font-semibold">
          abacus<span className="text-faint">_</span>
        </Link>
        <NavLinks />
        <div className="ml-auto">
          <UserMenu name={session.user.name} />
        </div>
      </header>
      {children}
    </div>
  )
}
