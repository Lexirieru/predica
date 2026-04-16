/**
 * Gamification: badge definitions + unlock checker.
 *
 * Called after every settlement with the wallets that were just affected.
 * Only inserts rows for badges the wallet doesn't already have (UNIQUE
 * constraint on (wallet, badge_type) backs this up). Broadcasts
 * BADGE_UNLOCKED over WS so the FE can toast the user instantly.
 */

import { v4 as uuid } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { achievements, users, votes } from "../db/schema";
import { broadcast } from "./websocket";

export type BadgeType =
  | "FIRST_WIN"
  | "STREAK_3"
  | "STREAK_5"
  | "STREAK_10"
  | "SHARPSHOOTER"
  | "HIGH_ROLLER"
  | "MOONSHOT"
  | "CENTURION";

export interface BadgeDef {
  type: BadgeType;
  label: string;
  emoji: string;
  description: string;
}

export const BADGES: Record<BadgeType, BadgeDef> = {
  FIRST_WIN:    { type: "FIRST_WIN",    label: "First Win",     emoji: "🔥", description: "Won your first market" },
  STREAK_3:     { type: "STREAK_3",     label: "On Fire",       emoji: "⚡", description: "Won 3 markets in a row" },
  STREAK_5:     { type: "STREAK_5",     label: "Unstoppable",   emoji: "🌟", description: "Won 5 markets in a row" },
  STREAK_10:    { type: "STREAK_10",    label: "Oracle",        emoji: "👑", description: "Won 10 markets in a row" },
  SHARPSHOOTER: { type: "SHARPSHOOTER", label: "Sharpshooter",  emoji: "🎯", description: "70%+ win rate over 10+ votes" },
  HIGH_ROLLER:  { type: "HIGH_ROLLER",  label: "High Roller",   emoji: "💎", description: "Placed a single bet of $100+" },
  MOONSHOT:     { type: "MOONSHOT",     label: "Moonshot",      emoji: "🚀", description: "Single win payout over $500" },
  CENTURION:    { type: "CENTURION",    label: "Centurion",     emoji: "🏛️", description: "Reached 100 total votes" },
};

export const BADGE_LIST = Object.values(BADGES);

interface AwardContext {
  wallet: string;
  badgeType: BadgeType;
  metadata?: Record<string, unknown>;
}

async function tryAwardBadge(ctx: AwardContext): Promise<boolean> {
  try {
    const inserted = await db
      .insert(achievements)
      .values({
        id: uuid(),
        wallet: ctx.wallet,
        badgeType: ctx.badgeType,
        metadata: ctx.metadata ? JSON.stringify(ctx.metadata) : null,
      })
      .onConflictDoNothing({
        target: [achievements.wallet, achievements.badgeType],
      })
      .returning({ id: achievements.id });

    if (inserted.length === 0) return false; // already owned

    const def = BADGES[ctx.badgeType];
    broadcast("BADGE_UNLOCKED", {
      wallet: ctx.wallet,
      badge: {
        type: def.type,
        label: def.label,
        emoji: def.emoji,
        description: def.description,
      },
      metadata: ctx.metadata ?? null,
      unlockedAt: Date.now(),
    });
    return true;
  } catch (err) {
    console.warn(`[Achievements] award failed for ${ctx.wallet} / ${ctx.badgeType}:`, (err as Error).message);
    return false;
  }
}

/**
 * Evaluate all badge criteria for a wallet and award any newly earned ones.
 * Meant to be called after a user's vote resolves (win or lose) so the streak
 * / milestone checks reflect the latest state.
 */
export async function evaluateAchievements(wallet: string): Promise<void> {
  // Pull aggregate user row.
  const user = await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
  if (!user) return;

  // FIRST_WIN
  if (user.wins >= 1) {
    await tryAwardBadge({ wallet, badgeType: "FIRST_WIN" });
  }

  // CENTURION
  if (user.totalVotes >= 100) {
    await tryAwardBadge({ wallet, badgeType: "CENTURION", metadata: { totalVotes: user.totalVotes } });
  }

  // SHARPSHOOTER — 70%+ win rate over 10+ votes (settled only).
  const settled = user.wins + user.losses;
  if (settled >= 10 && user.wins / settled >= 0.7) {
    await tryAwardBadge({
      wallet,
      badgeType: "SHARPSHOOTER",
      metadata: { winRate: user.wins / settled, settled },
    });
  }

  // Streak badges need the recent vote history (settled only, newest first).
  const recent = await db.query.votes.findMany({
    where: and(eq(votes.userWallet, wallet)),
    orderBy: [desc(votes.createdAt)],
    limit: 20,
  });
  const settledSequence = recent.filter((v) => v.status === "won" || v.status === "lost");
  let streak = 0;
  for (const v of settledSequence) {
    if (v.status === "won") streak++;
    else break;
  }
  if (streak >= 10) {
    await tryAwardBadge({ wallet, badgeType: "STREAK_10", metadata: { streak } });
    await tryAwardBadge({ wallet, badgeType: "STREAK_5", metadata: { streak } });
    await tryAwardBadge({ wallet, badgeType: "STREAK_3", metadata: { streak } });
  } else if (streak >= 5) {
    await tryAwardBadge({ wallet, badgeType: "STREAK_5", metadata: { streak } });
    await tryAwardBadge({ wallet, badgeType: "STREAK_3", metadata: { streak } });
  } else if (streak >= 3) {
    await tryAwardBadge({ wallet, badgeType: "STREAK_3", metadata: { streak } });
  }

  // Single-event badges based on recent vote details.
  const biggestWin = settledSequence
    .filter((v) => v.status === "won")
    .reduce((max, v) => ((v.payout ?? 0) > max ? (v.payout ?? 0) : max), 0);
  if (biggestWin >= 500) {
    await tryAwardBadge({ wallet, badgeType: "MOONSHOT", metadata: { payout: biggestWin } });
  }
  const biggestBet = recent.reduce((max, v) => (v.amount > max ? v.amount : max), 0);
  if (biggestBet >= 100) {
    await tryAwardBadge({ wallet, badgeType: "HIGH_ROLLER", metadata: { amount: biggestBet } });
  }
}

export async function listAchievements(wallet: string) {
  const rows = await db.query.achievements.findMany({
    where: eq(achievements.wallet, wallet),
    orderBy: [desc(achievements.unlockedAt)],
  });
  return rows.map((r) => {
    const def = BADGES[r.badgeType as BadgeType];
    return {
      id: r.id,
      type: r.badgeType,
      label: def?.label ?? r.badgeType,
      emoji: def?.emoji ?? "🏅",
      description: def?.description ?? "",
      unlockedAt: Number(r.unlockedAt),
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    };
  });
}
