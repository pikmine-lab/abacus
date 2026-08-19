'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/', label: 'Tableau de bord' },
  { href: '/mouvements', label: 'Mouvements' },
  { href: '/abonnements', label: 'Abonnements' },
  { href: '/comptes', label: 'Comptes' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <NavigationMenu viewport={false} className="max-w-full overflow-x-auto">
      <NavigationMenuList>
        {NAV.map((item) => (
          <NavigationMenuItem key={item.href}>
            <NavigationMenuLink
              asChild
              active={pathname === item.href}
              className={cn(
                navigationMenuTriggerStyle(),
                'h-8 px-2.5 text-[13px] text-muted-foreground data-[active=true]:font-semibold',
              )}
            >
              <Link href={item.href}>{item.label}</Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  )
}
