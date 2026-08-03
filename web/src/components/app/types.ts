import type { Quote } from "../../data/appdata";

export type Position = {
  id: number;
  assetSymbol: string;
  quote: Quote;
  qty: number;
  openedAt: string; // display time
};

export type ChatMsg = {
  role: "user" | "agent";
  text: string;
  bullets?: string[];
};

export type FeedEvent = {
  ts: string;
  kind: "info" | "action" | "suggest";
  text: string;
};

export type Suggestion = {
  id: number;
  title: string;
  detail: string;
  accept: string; // feed line when accepted
};
