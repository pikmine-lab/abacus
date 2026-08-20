import { auth } from '@abacus/core/auth'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  // Read the collapse state server-side so the sidebar renders in its final
  // width on the first paint instead of snapping after hydration.
  const collapsed = (await cookies()).get('sidebar_state')?.value === 'false'

  return (
    <SidebarProvider defaultOpen={!collapsed}>
      <AppSidebar userName={session.user.name} />
      <SidebarInset className="min-w-0 bg-background">{children}</SidebarInset>
    </SidebarProvider>
  )
}
