import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { BauhausLayout } from "./layouts/BauhausLayout";
import { Dashboard } from "./pages/Dashboard";
import { Toaster } from "sonner";
import { LoginPage } from "./pages/LoginPage";
import { getApiSecret } from "./lib/client";

const CredentialsPage = lazy(() =>
  import("./pages/CredentialsPage").then((module) => ({ default: module.CredentialsPage })),
);
const LogsPage = lazy(() =>
  import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const ChatPlayground = lazy(() =>
  import("./pages/ChatPlayground").then((module) => ({ default: module.ChatPlayground })),
);
const ModelsCenterPage = lazy(() =>
  import("./pages/ModelsCenterPage").then((module) => ({ default: module.ModelsCenterPage })),
);
const EnterprisePage = lazy(() =>
  import("./pages/EnterprisePage").then((module) => ({ default: module.EnterprisePage })),
);

function RequireAuth({ children }: { children: ReactNode }) {
  const secret = getApiSecret();
  const location = useLocation();

  if (!secret) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function RouteLoadingFallback() {
  return <div className="px-6 py-10 text-sm text-neutral-500">页面加载中...</div>;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" theme="light" />
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<BauhausLayout />}>
            <Route index element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="credentials" element={<RequireAuth><CredentialsPage /></RequireAuth>} />
            <Route path="logs" element={<RequireAuth><LogsPage /></RequireAuth>} />
            <Route path="chat" element={<RequireAuth><ChatPlayground /></RequireAuth>} />
            <Route path="models" element={<RequireAuth><ModelsCenterPage /></RequireAuth>} />
            <Route path="enterprise" element={<RequireAuth><EnterprisePage /></RequireAuth>} />
            <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
