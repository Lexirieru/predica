import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import NavBar from "@/components/NavBar";
import TradeModal from "@/components/TradeModal";
import BalanceSync from "@/components/BalanceSync";
import ConnectionBanner from "@/components/ConnectionBanner";
import VoteToaster from "@/components/VoteToaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Predica — Predict. Vote. Earn.",
  description:
    "TikTok-style prediction markets on Pacifica. Vote on crypto price predictions and earn rewards.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
