import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Commissioner, Fira_Code, Fira_Sans, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import { RegistryBook } from "@/components/RegistryBook";
import { fetchRegistryRows } from "@/lib/names-registry";
import { Shell } from "@/components/Shell";
import { loadSiteMarket } from "@/lib/site-market";
import { SiteHostProvider } from "@/lib/site-host";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAB_TITLE,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site-meta";
import { INK_BOOT } from "@/lib/skin-ink";
import "./globals.css";
import "./looks.css";
import "./feed.css";
import "./tip.css";

/** T1 default — Plex Sans has Cyrillic and `tnum`. */
const sans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const faceT0 = Commissioner({
  subsets: ["latin", "cyrillic"],
  variable: "--font-face-t0",
  display: "swap",
  // Only for a face picked in Settings (default is t1): load on use, not on every page.
  preload: false,
});

const faceT2 = Fira_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-face-t2",
  display: "swap",
  // Only for a face picked in Settings (default is t1): load on use, not on every page.
  preload: false,
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const faceT2Mono = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-t2-mono",
  display: "swap",
  // Only for a face picked in Settings (default is t1): load on use, not on every page.
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TAB_TITLE,
    template: `%s · ${SITE_TAB_TITLE}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: "ErgoScan",
  authors: [{ name: "ErgoScan" }],
  keywords: [
    "Ergo",
    "ERG",
    "blockchain explorer",
    "eUTXO",
    "mempool",
    "contracts",
    "stablecoins",
    "ErgoScan",
    "DEX",
    "DeFi",
  ],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/og.png?v=5",
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og.png?v=5"],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e0e0e" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e0e" },
    { color: "#0e0e0e" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [registryRows, market] = await Promise.all([fetchRegistryRows(), loadSiteMarket()]);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-face="t1"
      data-stamp="rail"
      data-float="ada"
      data-ink="oled"
      data-look="c"
      data-figs="mono"
      className={`dark ${sans.variable} ${faceT0.variable} ${faceT2.variable} ${mono.variable} ${faceT2Mono.variable}`}
    >
      <head>
        <Script id="ergoscan-ink" strategy="beforeInteractive">
          {INK_BOOT}
        </Script>
      </head>
      <body className="antialiased">
        <Providers>
          <SiteHostProvider>
            <RegistryBook rows={registryRows}>
              <Shell market={market}>{children}</Shell>
            </RegistryBook>
          </SiteHostProvider>
        </Providers>
      </body>
    </html>
  );
}
