"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAppKitAccount } from "@reown/appkit/react";

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
      <div className="max-w-[430px] mx-auto flex items-center justify-between px-4 h-14">
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
    </header>
  );
}
