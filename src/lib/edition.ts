import { config } from "../config";

export type Edition = "standard" | "advanced";

export function getEdition(): Edition {
  return config.enableAdvanced ? "advanced" : "standard";
}

export function isAdvancedEnabled(): boolean {
  return getEdition() === "advanced";
}

export function getEditionFeatures() {
  const advanced = isAdvancedEnabled();
  return {
    edition: getEdition(),
    features: {
      oauth: true,
      gateway: true,
      enterprise: advanced,
      rbac: advanced,
      billing: advanced,
      audit: advanced,
    },
  };
}
