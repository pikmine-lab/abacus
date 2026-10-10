'use client'

import {
  ArrowLeftRightIcon,
  BriefcaseBusinessIcon,
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
import { useTranslations } from 'next-intl'
import { Logo } from '@/components/logo'
import { SidebarEdgeToggle } from '@/components/sidebar-edge-toggle'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { UserMenu } from '@/components/user-menu'

/**
 * Grouped by the question asked, not by entity: "what happened", "what is
 * committed", "what I own". The groups are separated by a hairline and not
 * named: each entry already names its screen, and a group label read before
 * every list says nothing the entries do not. A view that does not exist yet
 * still appears, disabled and labelled, because a visible roadmap beats a
 * surprise.
 */
const GROUPS = [
  {
    label: 'tracking',
    items: [
      { href: '/', label: 'overview', icon: LayoutDashboardIcon },
      { href: '/movements', label: 'movements', icon: ArrowLeftRightIcon },
      { href: '/analysis', label: 'analysis', icon: ChartNoAxesColumnIcon },
      { href: '/activity', label: 'activity', icon: BriefcaseBusinessIcon },
    ],
  },
  {
    label: 'commitments',
    items: [
      { href: '/recurring-expenses', label: 'recurringExpenses', icon: CircleArrowDownIcon },
      { href: '/recurring-income', label: 'recurringIncome', icon: CircleArrowUpIcon },
    ],
  },
  {
    label: 'wealth',
    items: [
      { href: '/accounts', label: 'accounts', icon: LandmarkIcon },
      { href: '/investments', label: 'investments', icon: ChartCandlestickIcon },
    ],
  },
] as const

const ITEM_CLASS =
  'text-sidebar-foreground data-[active=true]:text-foreground data-[active=true]:[&>svg]:text-primary'

export function AppSidebar({ userName }: { userName: string }) {
  const t = useTranslations('shell')
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
        {GROUPS.map((group, index) => (
          <SidebarGroup
            key={group.label}
            aria-label={t(`groups.${group.label}`)}
            className={index > 0 ? 'border-t border-sidebar-border' : undefined}
          >
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    {'soon' in item && item.soon ? (
                      <SidebarMenuButton
                        tooltip={t('soon', { screen: t(`screens.${item.label}`) })}
                        aria-disabled
                        className="cursor-default text-faint hover:bg-transparent hover:text-faint"
                      >
                        <item.icon />
                        <span>{t(`screens.${item.label}`)}</span>
                        <span className="ml-auto text-[10px] tracking-wide text-faint uppercase">V2</span>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton
                        asChild
                        tooltip={t(`screens.${item.label}`)}
                        isActive={isActive(item.href)}
                        className={ITEM_CLASS}
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span>{t(`screens.${item.label}`)}</span>
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
              tooltip={t('screens.settings')}
              isActive={isActive('/settings')}
              className={ITEM_CLASS}
            >
              <Link href="/settings">
                <SettingsIcon />
                <span>{t('screens.settings')}</span>
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
