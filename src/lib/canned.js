/**
 * Canned (fixed) texts for the secretary bot.
 *
 * Voice: warm Ghanaian English with light pidgin — friendly, human, never
 * corporate. One module so the strings can be translated/reworded later
 * without touching the pipeline (spec §9).
 */

/** Sign-off appended to every secretary reply (TOS §5.4: never hide the bot). */
export function signOff(botName, ownerName) {
  return "\n\n— _" + botName + " 🤖, on behalf of " + ownerName + "_";
}

/** First-time chat: greet as the assistant, then the AI answers their question. */
export function welcome(botName, ownerName) {
  return (
    "Heyyy 👋 You dey chat with " + botName + ", " + ownerName +
    "'s personal assistant. I dey here for you — how I fit help? 😊"
  );
}

/** Question needs the owner personally; we've already alerted him. */
export function personalDeflection(ownerName) {
  return (
    "Aah this one be something wey " + ownerName +
    " himself go answer you — I don pass am give am 🙏. E go reply you soon soon! 🙌"
  );
}

/** Media/voice without any text — we can only read words for now. */
export const MEDIA_HINT =
  "Eei I fit read text pass — send am as words make I understand you well 🙏";

/** Per-chat reply cooldown: they're messaging faster than we can answer. */
export const COOLDOWN = "Small small ⏳ — I dey finish your last one, give me like a second 🙏";

/** AI/telegram failure in a customer chat (still better than silence). */
export function errorReply(ownerName) {
  return (
    "Aah sorry 🙏 — small technical issue from my side. I go sort am and come back. " +
    "If e no fast, " + ownerName + " go see am himself soon."
  );
}

/** Toasts for the action buttons (callback answers). */
export const TOAST_DELETE_OK = "E don delete ✅";
export const TOAST_DELETE_FAIL = "The boss no give me permission to delete am 😕";
export const TOAST_HUMAN_OK = "I don alert the boss 🙏";

/** DM to the owner: a question needs him personally. */
export function ownerPersonalAlert({ customerName, chatId, text }) {
  return (
    "🔔 Personal question — this one need you yourself:\n\n" +
    "From: " + (customerName || "Unknown") + " (chat " + chatId + ")\n" +
    "\"" + text + "\""
  );
}

/** DM to the owner: the customer pressed "Request Human". */
export function ownerHumanRequest({ customerName, chatId, text }) {
  return (
    "👋 Request human — " + (customerName || "Somebody") +
    " wan talk to you directly (chat " + chatId + ").\n\n" +
    (text ? "Last message: \"" + text + "\"" : "No recent text in memory.")
  );
}

/** DM to the owner: the business connection can't reply (rights missing). */
export function ownerNoReplyRights() {
  return (
    "⚠️ Secretary paused — the connection no get the can_reply right, so I no fit send " +
    "messages on your behalf. Reconnect me in BotFather and grant the reply permission."
  );
}

/** DM to the owner: a customer chat failed entirely. */
export function ownerSendFailure({ customerName, chatId }) {
  return (
    "⚠️ I no fit send am reply to " + (customerName || "somebody") +
    " (chat " + chatId + "). Check the Worker logs 🙏."
  );
}

/** Direct chat (owner ↔ bot) commands. */
export const DIRECT_START = (ownerName, botName) =>
  "Yoo " + ownerName + " 👊 I be " + botName + ", your secretary bot. " +
  "Any message wey land for your chats, I go see am and fit answer am for you. " +
  "Say /help make you see wetin I fit do.";

export const DIRECT_HELP =
  "Wetin I fit do:\n" +
  "• Answer your customers as you (with my sign-off) when you connect me for Secretary Mode.\n" +
  "• Alert you when a question need you personally.\n" +
  "• /stop — cancel any reply wey dey generate.\n" +
  "Connect me: BotFather → /mybots → your bot → Secretary Mode (Business).";

export const DIRECT_STOP_OK = "I don stop am ✅";
export const DIRECT_UNKNOWN = "Hmm I no know that command 🤔 — try /help.";
