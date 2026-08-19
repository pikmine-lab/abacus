import { auth } from '@abacus/core/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SignOut } from '@/components/sign-out'

const NAV = [
  { href: '/', label: 'Tableau de bord' },
  { href: '/mouvements', label: 'Mouvements' },
  { href: '/abonnements', label: 'Abonnements' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  return (
    <div className="mx-auto max-w-[1160px] px-3 pb-12 sm:px-5">
      <header className="flex items-center gap-3 py-3 sm:gap-6">
        <Link href="/" className="font-mono text-[15px] font-semibold">
          abacus<span className="text-faint">_</span>
        </Link>
        <nav className="flex gap-1 overflow-x-auto text-[13px]">
          {NAV.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 ${
                i === 0
                  ? 'bg-wash font-semibold text-foreground'
                  : 'text-secondary-foreground hover:bg-wash hover:text-foreground'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <SignOut name={session.user.name} />
        </div>
      </header>
      {children}
    </div>
  )
}
