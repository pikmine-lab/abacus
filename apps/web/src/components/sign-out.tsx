'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function SignOut({ name }: { name: string }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut()
        router.push('/login')
        router.refresh()
      }}
      className="flex cursor-pointer items-center gap-2 text-xs text-secondary-foreground hover:text-foreground"
      title="Se déconnecter"
    >
      <span className="hidden sm:inline">{name}</span>
      <span className="grid size-7 place-items-center rounded-full border border-border bg-wash text-[11px] font-semibold text-foreground">
        {name.charAt(0).toUpperCase()}
      </span>
    </button>
  )
}
