import Home from "@/app/page";

/**
 * Chat route: /chat/[id]
 *
 * Renders the same SPA shell as "/". The chat id is read from the URL on the
 * client (app/page.tsx) via the History API, so this page is only ever truly
 * rendered on a hard refresh / direct visit — in-app navigation is handled
 * client-side without reloading.
 */
export default function ChatPage() {
  return <Home />;
}
