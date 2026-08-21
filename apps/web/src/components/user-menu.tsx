'use client'

import { LogOutIcon, PlugZapIcon, SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton, useSidebar } from '@/components/ui/sidebar'
import { authClient } from '@/lib/auth-client'

export function UserMenu({ name }: { name: string }) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={name} className="text-sidebar-foreground">
          <Avatar className="size-6 shrink-0 rounded-md">
            <AvatarFallback className="rounded-md bg-secondary text-[11px] font-semibold text-foreground">
              {name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{name}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      {/* Anchored to the side on desktop so it never covers the nav it came from. */}
      <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" className="min-w-44">
        <DropdownMenuItem asChild>
          <Link href="/connect-ai">
            <PlugZapIcon />
            Brancher une IA
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon />
            Réglages
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await authClient.signOut()
            router.push('/login')
            router.refresh()
          }}
        >
          <LogOutIcon />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
