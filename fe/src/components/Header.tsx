"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppKitAccount } from "@reown/appkit/react";

const DESKTOP_TABS = [
  { label: "Feed", href: "/" },
  { label: "Explore", href: "/explore" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Profile", href: "/profile" },
];

const FAUCET_URL = "https://test-app.pacifica.fi/faucet";

export default function Header() {
  const pathname = usePathname();
  const { isConnected } = useAppKitAccount();

  // On /profile the page itself renders a large "Connect Wallet" CTA in its
  // empty state — duplicating it in the header is noise. Hide the header
  // appkit-button on /profile only when not connected; once connected we
  // still show the wallet pill so the user can disconnect/switch network
  // from there.
  const hideAppKitButton = pathname === "/profile" && !isConnected;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-2xl border-b border-white/6">
      {/* Mobile bar — compact, logo + wallet only */}
      <div className="md:hidden max-w-[430px] mx-auto flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2.5">
          <Image
            src="/predica_logo.png"
            alt="Predica"
            width={32}
            height={32}
            className="rounded-xl"
            priority
          />
          <span
            className="text-white text-base tracking-[-0.04em]"
            style={{ fontFamily: "var(--font-brand)", fontWeight: 800 }}
          >
            Predica
          </span>
        </div>
        {!hideAppKitButton && (
          <div dangerouslySetInnerHTML={{ __html: '<appkit-button size="sm"></appkit-button>' }} />
        )}
      </div>

      {/* Desktop bar — full Polymarket-style top nav: logo + tabs + wallet */}
      <div className="hidden md:flex max-w-[1400px] mx-auto items-center justify-between px-6 h-16">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/predica_logo.png"
              alt="Predica"
              width={36}
              height={36}
              className="rounded-xl"
              priority
            />
            <span
              className="text-white text-lg tracking-[-0.04em]"
              style={{ fontFamily: "var(--font-brand)", fontWeight: 800 }}
            >
              Predica
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {DESKTOP_TABS.map((tab) => {
              const active = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    active
                      ? "text-white bg-white/8"
                      : "text-white/40 hover:text-white/80 hover:bg-white/4"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
            {/* Faucet — external link to Pacifica testnet faucet so users can
                top up USDP without leaving Predica via the menu. */}
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full text-sm font-medium text-white/40 hover:text-white/80 hover:bg-white/4 transition-colors"
            >
              Faucet
            </a>
          </nav>
        </div>
        {!hideAppKitButton && (
          <div dangerouslySetInnerHTML={{ __html: '<appkit-button></appkit-button>' }} />
        )}
      </div>
    </header>
  );
}
