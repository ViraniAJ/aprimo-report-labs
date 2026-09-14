import type { Metadata } from "next"
import { Instrument_Sans, JetBrains_Mono } from "next/font/google"
import { Toaster } from "sonner"
import { AprimoProvider } from "@/context/aprimo-context"
import { AprimoConfigDialog } from "@/components/aprimo-config-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans-face" })
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-face" })

export const metadata: Metadata = {
  title: { default: "Report Labs", template: "%s · Report Labs" },
  description: "Live reporting and a natural-language assistant for Aprimo DAM.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AprimoProvider>
            <AprimoConfigDialog />
            {children}
          </AprimoProvider>
          <Toaster position="top-right" richColors offset="72px" />
        </ThemeProvider>
      </body>
    </html>
  )
}
