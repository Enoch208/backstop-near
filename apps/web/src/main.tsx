import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useSearchParams } from "react-router";
import { AppLayout } from "./app/AppLayout.js";
import { ArenaPage } from "./app/ArenaPage.js";
import { Overview } from "./app/Overview.js";
import { RunPage } from "./app/RunPage.js";
import { RunsPage } from "./app/RunsPage.js";
import { routerBasename } from "./data/base.js";
import { Landing } from "./landing/Landing.js";
import { LatestReplay, LivePage } from "./live/Live.js";
import { VerifyPage } from "./verify/VerifyPage.js";
import "./styles.css";

function LegacyLive() {
  const [params] = useSearchParams();
  const replay = params.get("replay");
  return <Navigate to={replay === null ? "/app/live" : `/app/runs/${replay}`} replace />;
}

const router = createBrowserRouter(
  [
    { path: "/", element: <Landing /> },
    {
      path: "/app",
      element: <AppLayout />,
      children: [
        { index: true, element: <Overview /> },
        { path: "live", element: <LivePage /> },
        { path: "replay", element: <LatestReplay /> },
        { path: "runs", element: <RunsPage /> },
        { path: "runs/:runId", element: <RunPage /> },
        { path: "verify", element: <VerifyPage /> },
        { path: "arena", element: <ArenaPage /> },
      ],
    },
    { path: "/live", element: <LegacyLive /> },
    { path: "/verify", element: <Navigate to="/app/verify" replace /> },
  ],
  { basename: routerBasename },
);

const root = document.getElementById("root");
if (root === null) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
