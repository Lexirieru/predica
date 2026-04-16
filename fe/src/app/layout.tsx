import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import dynamic from "next/dynamic";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import NavBar from "@/components/NavBar";
import BalanceSync from "@/components/BalanceSync";
import ConnectionBanner from "@/components/ConnectionBanner";
import VoteToaster from "@/components/VoteToaster";

// TradeModal is mounted on every route but only becomes interactive when the
// user taps Buy. Next's dynamic() splits it into its own chunk so the initial
// feed render doesn't block on framer-motion + wallet-provider imports that
// only matter once the modal opens. Can't use ssr:false here because layout.tsx
// is a Server Component in the app router; letting it SSR is fine since the
// modal renders null while closed (no visible payload).
const TradeModal = dynamic(() => import("@/components/TradeModal"));

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand font for the Predica wordmark. Unbounded is a wide, geometric display
// face used across web3 (Mantle, Eclipse, Hyperliquid-adjacent projects) — it
// reads as "crypto-native" without resorting to a pixel/8-bit gimmick. Picked
// over Space Grotesk because it differs clearly from the body font (Geist).
const brandFont = Unbounded({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["700", "800"],
});

export const metadata: Metadata = {
  title: "Predica — Predict. Vote. Earn.",
  description:
    "TikTok-style prediction markets on Pacifica. Vote on crypto price predictions and earn rewards.",
  icons: {
    icon: "/predica_logo.png",
    shortcut: "/predica_logo.png",
    apple: "/predica_logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${brandFont.variable} h-full antialiased`}
    >
      <body className="h-full bg-[#0a0a0a] text-white">
        <Providers>
          <div className="max-w-[430px] mx-auto h-full flex flex-col relative">
            <Header />
            <main className="flex-1 pt-14 pb-16 overflow-hidden">
              {children}
            </main>
            <NavBar />
            <TradeModal />
            <BalanceSync />
            <ConnectionBanner />
            <VoteToaster />
          </div>
        </Providers>
      </body>
    </html>
  );
}
