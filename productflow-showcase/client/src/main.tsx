import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import "./styles/pf-redesign.css";

const queryClient = new QueryClient();
const RECOVERY_FLAG_KEY = "pf:chunk-recovery-attempted";

const injectAnalyticsScript = () => {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT?.trim();
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID?.trim();
  if (!endpoint || !websiteId) return;

  if (document.querySelector("script[data-analytics='umami']")) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = `${endpoint.replace(/\/$/, "")}/umami`;
  script.setAttribute("data-website-id", websiteId);
  script.setAttribute("data-analytics", "umami");
  document.body.appendChild(script);
};

function toErrorMessage(reason: unknown) {
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === "object" && "message" in reason) {
    return String((reason as { message?: unknown }).message ?? "");
  }
  return String(reason);
}

function isChunkLoadLikeError(reason: unknown) {
  const message = toErrorMessage(reason).toLowerCase();
  if (!message) return false;

  return [
    "chunkloaderror",
    "loading chunk",
    "failed to fetch dynamically imported module",
    "importing a module script failed",
    "failed to load module script",
    "unable to preload css",
    "dynamically imported module",
  ].some((keyword) => message.includes(keyword));
}

function tryRuntimeRecovery(reason: unknown) {
  if (typeof window === "undefined") return false;
  if (!isChunkLoadLikeError(reason)) return false;

  const attempted = window.sessionStorage.getItem(RECOVERY_FLAG_KEY);
  if (attempted === "1") {
    console.error("[Runtime] chunk recovery already attempted once", reason);
    return false;
  }

  window.sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");
  console.warn("[Runtime] chunk loading failed, force reloading page once", reason);
  window.location.reload();
  return true;
}

function installRuntimeRecoveryGuards() {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event: Event) => {
    try {
      event.preventDefault?.();
    } catch {
      // ignore
    }
    const target = event as unknown as { payload?: unknown };
    void tryRuntimeRecovery(target.payload ?? target);
  });

  window.addEventListener("error", (event) => {
    void tryRuntimeRecovery(event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const recovered = tryRuntimeRecovery(event.reason);
    if (recovered) {
      event.preventDefault();
    }
  });
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

installRuntimeRecoveryGuards();
injectAnalyticsScript();

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
