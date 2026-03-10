import { useState, type Dispatch, type SetStateAction } from "react";
import type { FeaturePayload } from "../lib/client";

export type EnterpriseFeatureGateState = {
  featurePayload: FeaturePayload | null;
  setFeaturePayload: Dispatch<SetStateAction<FeaturePayload | null>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  enterpriseEnabled: boolean;
  setEnterpriseEnabled: Dispatch<SetStateAction<boolean>>;
};

export function useEnterpriseFeatureGateState(): EnterpriseFeatureGateState {
  const [featurePayload, setFeaturePayload] = useState<FeaturePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [enterpriseEnabled, setEnterpriseEnabled] = useState(true);

  return {
    featurePayload,
    setFeaturePayload,
    loading,
    setLoading,
    enterpriseEnabled,
    setEnterpriseEnabled,
  };
}

export type EnterpriseAdminSessionState = {
  adminAuthenticated: boolean;
  setAdminAuthenticated: Dispatch<SetStateAction<boolean>>;
  adminUsername: string;
  setAdminUsername: Dispatch<SetStateAction<string>>;
  adminPassword: string;
  setAdminPassword: Dispatch<SetStateAction<string>>;
  authSubmitting: boolean;
  setAuthSubmitting: Dispatch<SetStateAction<boolean>>;
};

export function useEnterpriseAdminSessionState(): EnterpriseAdminSessionState {
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  return {
    adminAuthenticated,
    setAdminAuthenticated,
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    authSubmitting,
    setAuthSubmitting,
  };
}
