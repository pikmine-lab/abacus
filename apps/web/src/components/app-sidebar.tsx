'use client'

import {
  ArrowLeftRightIcon,
  ChartCandlestickIcon,
  ChartNoAxesColumnIcon,
  CircleArrowDownIcon,
  CircleArrowUpIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  SettingsIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from '@/components/logo'
import { SidebarEdgeToggle } from '@/components/sidebar-edge-toggle'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { UserMenu } from '@/components/user-menu'

/**
 * Grouped by the question asked, not by entity: "what happened", "what is
 * committed", "what I own". A view that does not exist yet still appears,
 * disabled and labelled, because a visible roadmap beats a surprise.
 */
const GROUPS = [
  {
    label: 'Suivi',
    items: [
      { href: '/', label: 'Vue d’ensemble', icon: LayoutDashboardIcon },
      { href: '/movements', label: 'Mouvements', icon: ArrowLeftRightIcon },
      { href: '/analysis', label: 'Analyse', icon: ChartNoAxesColumnIcon },
    ],
  },
  {
    label: 'Engagements',
    items: [
      { href: '/recurring-expenses', label: 'Dépenses récurrentes', icon: CircleArrowDownIcon },
      { href: '/recurring-income', label: 'Revenus récurrents', icon: CircleArrowUpIcon },
    ],
  },
  {
    label: 'Patrimoine',
    items: [
      { href: '/accounts', label: 'Comptes', icon: LandmarkIcon },
      { href: '/placements', label: 'Placements', icon: ChartCandlestickIcon, soon: true },
    ],
  },
] as const

const ITEM_CLASS =
  'text-sidebar-foreground data-[active=true]:text-foreground data-[active=true]:[&>svg]:text-primary'

export function AppSidebar({ userName }: { userName: string }) {
  const pathname = usePathname()
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="abacus" className="gap-2.5">
              <Link href="/">
                <Logo className="!size-6 shrink-0 text-muted-foreground" />
                <span className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
                  abacus<span className="text-primary">_</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    {'soon' in item && item.soon ? (
                      <SidebarMenuButton
                        tooltip={`${item.label} (arrive en V2)`}
                        aria-disabled
                        className="cursor-default text-faint hover:bg-transparent hover:text-faint"
                      >
                        <item.icon />
                        <span>{item.label}</span>
                        <span className="ml-auto text-[10px] tracking-wide text-faint uppercase">V2</span>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        asChild
                        tooltip={item.label}
                        isActive={isActive(item.href)}
                        className={ITEM_CLASS}
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Réglages"
              isActive={isActive('/settings')}
              className={ITEM_CLASS}
            >
              <Link href="/settings">
                <SettingsIcon />
                <span>Réglages</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserMenu name={userName} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarEdgeToggle />
    </Sidebar>
  )
}
