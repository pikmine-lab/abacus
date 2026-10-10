import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell')
  return {
    title: { default: 'abacus', template: '%s · abacus' },
    description: t('description'),
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0c0e13',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={await getLocale()} className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans text-[14px] antialiased">
        {/* Hands the request's language and catalog to client components. */}
        <NextIntlClientProvider>
          {/* Collapsed sidebar items carry their label as a tooltip, so the
              provider has to wrap the whole app, not one screen. */}
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
