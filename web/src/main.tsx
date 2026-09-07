import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import {
  makeQueryClient,
  PERSISTED_QUERY_KEY,
  PERSIST_MAX_AGE,
  pruneExpiredQueries,
} from "./app/queryClient";
import "./theme/globals.css";

const queryClient = makeQueryClient();

// Persist the cache to localStorage: reads show offline, and writes queued
// while offline (paused mutations) survive a reload and replay on reconnect.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: PERSISTED_QUERY_KEY,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: PERSIST_MAX_AGE }}
      onSuccess={() => {
        pruneExpiredQueries(queryClient);
        // Fire any writes that were paused offline before this session.
        queryClient.resumePausedMutations();
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);
