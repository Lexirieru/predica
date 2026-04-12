"use client";

import { createAppKit } from "@reown/appkit/react";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import { solanaDevnet } from "@reown/appkit/networks";
import type { ReactNode } from "react";

const solanaAdapter = new SolanaAdapter();

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!;

createAppKit({
  adapters: [solanaAdapter],
  networks: [solanaDevnet],
  projectId,
  metadata: {
    name: "Predica",
    description: "Prediction markets powered by Pacifica",
    url: "http://localhost:3000",
    icons: [],
  },
  themeMode: "dark",
  features: {
    analytics: false,
  },
});

export default function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
