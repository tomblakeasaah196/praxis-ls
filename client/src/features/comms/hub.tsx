/**
 * Comms — a single Messaging workstation (pixie parity): no hub tab-row, and no
 * standalone Mail screen. `/comms` is the unified inbox where email lives as an
 * Email conversation (send + reply). Setup (keys/channels) is reached from the
 * inbox gear. External channel tabs live inside the inbox.
 */
import { useParams } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { TeamChatPage } from "./team-chat";
import { WhatsAppPage, InstagramPage } from "./external-channel";
import { SetupPage } from "./setup";

export function CommsHub() {
  const { section } = useParams();
  const { user } = useAuth();
  const ch = user?.channels || {};
  if (section === "setup") return <SetupPage />;
  if (section === "whatsapp" && ch.whatsapp) return <WhatsAppPage />;
  if (section === "instagram" && ch.instagram) return <InstagramPage />;
  return <TeamChatPage />;
}
