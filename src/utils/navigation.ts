import { router, type Href } from "expo-router";

// Returns to the previous screen, or to a fixed parent when the stack is empty (e.g. after a web reload)
export function goBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
