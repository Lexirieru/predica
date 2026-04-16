"use client";

import Image from "next/image";

export default function Header() {
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
          <span className="text-white font-semibold text-lg tracking-tight">Predica</span>
        </div>
        <div dangerouslySetInnerHTML={{ __html: '<appkit-button size="sm"></appkit-button>' }} />
      </div>
    </header>
  );
}
