'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/', label: 'Tableau de bord' },
  { href: '/mouvements', label: 'Mouvements' },
  { href: '/abonnements', label: 'Abonnements' },
  { href: '/comptes', label: 'Comptes' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto text-[13px]">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? 'page' : undefined}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 ${
            pathname === item.href
              ? 'bg-wash font-semibold text-foreground'
              : 'text-secondary-foreground hover:bg-wash hover:text-foreground'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
