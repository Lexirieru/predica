"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const FAUCET_URL = "https://test-app.pacifica.fi/faucet";

const tabs = [
  {
    label: "Feed",
    href: "/",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          stroke={active ? "#fff" : "#555"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? "rgba(255,255,255,0.08)" : "none"}
        />
      </svg>
    ),
  },
  {
    label: "Explore",
    href: "/explore",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke={active ? "#fff" : "#555"} strokeWidth="1.8" />
        <path d="M21 21l-4.35-4.35" stroke={active ? "#fff" : "#555"} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Board",
    href: "/leaderboard",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M8 21V11M16 21V7M12 21V3"
          stroke={active ? "#fff" : "#555"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/profile",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" stroke={active ? "#fff" : "#555"} strokeWidth="1.8" />
        <path
          d="M20 21c0-3.314-3.582-6-8-6s-8 2.686-8 6"
          stroke={active ? "#fff" : "#555"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

type Tab = (typeof tabs)[number];

function NavLink({ tab, pathname }: { tab: Tab; pathname: string | null }) {
  const active = pathname === tab.href;
  return (
    <Link
      href={tab.href}
      aria-label={tab.label}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-col items-center gap-0.5 min-w-[48px] min-h-[44px] justify-center px-2"
    >
      {active && (
        <div
          className="absolute -top-1 w-4 h-0.5 rounded-full bg-white/80"
          style={{ boxShadow: "0 0 8px rgba(255,255,255,0.3)" }}
        />
      )}
      <div
        className="transition-transform duration-150"
        style={{ transitionTimingFunction: "var(--ease-out)" }}
      >
        {tab.icon(active)}
      </div>
      <span
        className={`text-[10px] font-medium transition-colors duration-150 ${
          active ? "text-white" : "text-[#555]"
        }`}
      >
        {tab.label}
      </span>
    </Link>
  );
}

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-2xl border-t border-white/6 md:hidden"
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Order: Feed, Explore, Board, Faucet, Profile (Profile stays rightmost
          per usual mobile convention; Faucet is the external sibling next to
          it so users find it where they expect "more / settings"). */}
      <div className="max-w-[430px] mx-auto flex items-center justify-around py-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
        {tabs.slice(0, 3).map((tab) => (
          <NavLink key={tab.href} tab={tab} pathname={pathname} />
        ))}
        <a
          href={FAUCET_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Faucet"
          className="relative flex flex-col items-center gap-0.5 min-w-[48px] min-h-[44px] justify-center px-2"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3c-3.5 4-5 7-5 9.5a5 5 0 0010 0C17 10 15.5 7 12 3z"
              stroke="#555"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[10px] font-medium text-[#555]">Faucet</span>
        </a>
        <NavLink tab={tabs[3]} pathname={pathname} />
      </div>
    </nav>
  );
}
