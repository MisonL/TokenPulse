import { Component, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { BauhausLayout } from "./layouts/BauhausLayout";
import { Dashboard } from "./pages/Dashboard";
import { Toaster } from "sonner";
import { LoginPage } from "./pages/LoginPage";
import { getApiSecret, verifyStoredApiSecret } from "./lib/client";

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

type AuthGateStatus = "checking" | "authenticated" | "unauthenticated";

interface AuthGateState {
  checkedTarget: string;
  verifiedSecret: string;
  status: AuthGateStatus;
}

function getLocationRedirectTarget(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${location.pathname || "/"}${location.search || ""}${location.hash || ""}`;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const secret = getApiSecret();
  const redirectTarget = getLocationRedirectTarget(location);
  const [authState, setAuthState] = useState<AuthGateState>({
    checkedTarget: "",
    verifiedSecret: "",
    status: "unauthenticated",
  });
  const needsPreflight =
    !!secret &&
    (authState.verifiedSecret !== secret || authState.checkedTarget !== redirectTarget);

  useEffect(() => {
    let cancelled = false;

    if (!needsPreflight || !secret) {
      return () => {
        cancelled = true;
      };
    }

    void verifyStoredApiSecret({
      redirectTarget,
    }).then((verified) => {
      if (cancelled) {
        return;
      }
      setAuthState({
        checkedTarget: redirectTarget,
        verifiedSecret: verified ? secret : "",
        status: verified ? "authenticated" : "unauthenticated",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [needsPreflight, redirectTarget, secret]);

  if (!secret) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (needsPreflight || authState.status === "checking") {
    return <RouteLoadingFallback message="登录态校验中..." />;
  }

  if (authState.status !== "authenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

export function RouteLoadingFallback({ message = "页面加载中..." }: { message?: string }) {
  return <div className="px-6 py-10 text-sm text-neutral-500">{message}</div>;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    void error;
    void errorInfo;
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="px-6 py-12">
          <div className="max-w-2xl border-4 border-black bg-[#FFE0E0] p-6 shadow-[8px_8px_0_0_#000]">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">页面加载失败</p>
            <h2 className="mt-3 text-2xl font-black uppercase tracking-tight">前端模块加载异常</h2>
            <p className="mt-3 text-sm font-bold text-red-700">
              可能是网络抖动、静态资源更新或浏览器缓存导致的 chunk 加载失败。请刷新页面后重试。
            </p>
            <button
              className="b-btn mt-5 bg-white"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.reload();
                }
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" theme="light" />
      <RouteErrorBoundary>
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
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
