import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Landing } from "./landing/Landing.js";
import { Live } from "./live/Live.js";
import { VerifyPage } from "./verify/VerifyPage.js";
import { routerBasename } from "./data/base.js";
import "./styles.css";

const router = createBrowserRouter(
  [
    { path: "/", element: <Landing /> },
    { path: "/live", element: <Live /> },
    { path: "/verify", element: <VerifyPage /> },
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
