import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { type ReactNode } from "react";
import { BauhausLayout } from "./layouts/BauhausLayout";
import { Dashboard } from "./pages/Dashboard";
import { CredentialsPage } from "./pages/CredentialsPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChatPlayground } from "./pages/ChatPlayground";
import { Toaster } from "sonner";
import { LoginPage } from "./pages/LoginPage";
import { ModelsCenterPage } from "./pages/ModelsCenterPage";
import { getApiSecret } from "./lib/client";

function RequireAuth({ children }: { children: ReactNode }) {
  const secret = getApiSecret();
  const location = useLocation();

  if (!secret) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" theme="light" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<BauhausLayout />}>
          <Route index element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="credentials" element={<RequireAuth><CredentialsPage /></RequireAuth>} />
          <Route path="logs" element={<RequireAuth><LogsPage /></RequireAuth>} />
          <Route path="chat" element={<RequireAuth><ChatPlayground /></RequireAuth>} />
          <Route path="models" element={<RequireAuth><ModelsCenterPage /></RequireAuth>} />
          <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
