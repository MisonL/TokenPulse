import type {
  AdminUserItem,
  OrgMemberBindingItem,
  OrgMemberProjectBindingRow,
  OrgOrganizationItem,
  OrgOverviewBucket,
  OrgOverviewData,
  OrgProjectItem,
} from "../lib/client";
import {
  ORG_DOMAIN_READONLY_FALLBACK_MESSAGE,
  resolveOrgDomainAvailabilityState,
  type OrgDomainAvailabilityState,
} from "./enterpriseGovernance";

const toText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toText(item).trim()).filter(Boolean);
};

export const shouldRefreshOrgDomainAfterMutationError = (error: unknown) => {
  return resolveOrgDomainMutationErrorDecision(error).shouldRefresh;
};

export interface OrgDomainMutationErrorDecision {
  shouldRefresh: boolean;
  status: number | null;
  reason: "client_validation" | "conflict" | "semantic_validation" | "refresh_recommended";
}

export const resolveOrgDomainMutationErrorDecision = (
  error: unknown,
): OrgDomainMutationErrorDecision => {
  const rawStatus = (error as { status?: unknown })?.status;
  const status = typeof rawStatus === "number" && Number.isFinite(rawStatus)
    ? Number(rawStatus)
    : null;

  if (status === 400) {
    return {
      shouldRefresh: false,
      status,
      reason: "client_validation",
    };
  }
  if (status === 409) {
    return {
      shouldRefresh: false,
      status,
      reason: "conflict",
    };
  }
  if (status === 422) {
    return {
      shouldRefresh: false,
      status,
      reason: "semantic_validation",
    };
  }
  return {
    shouldRefresh: true,
    status,
    reason: "refresh_recommended",
  };
};

export interface OrgDomainWriteGuardState {
  blocked: boolean;
  reason: "ready" | "loading" | "read_only_fallback";
  message: string;
}

export const resolveOrgDomainWriteGuardState = (options: {
  loading: boolean;
  readOnlyFallback: boolean;
}): OrgDomainWriteGuardState => {
  if (options.readOnlyFallback) {
    return {
      blocked: true,
      reason: "read_only_fallback",
      message: ORG_DOMAIN_READONLY_FALLBACK_MESSAGE,
    };
  }

  if (options.loading) {
    return {
      blocked: true,
      reason: "loading",
      message: "组织域正在加载，暂不允许写操作。",
    };
  }

  return {
    blocked: false,
    reason: "ready",
    message: "",
  };
};

export interface OrgMemberEditingStateResolution {
  nextEditingMemberId: string | null;
  shouldResetForm: boolean;
  reason:
    | "idle"
    | "keep"
    | "load_failed"
    | "read_only_fallback"
    | "mutation_succeeded"
    | "member_removed"
    | "member_missing";
}

export const resolveOrgMemberEditingState = (options: {
  editingMemberId: string | null;
  loadFailed?: boolean;
  readOnlyFallback?: boolean;
  mutationSucceeded?: boolean;
  removedMemberId?: string | null;
  availableMemberIds?: string[];
}): OrgMemberEditingStateResolution => {
  const currentEditingMemberId = toText(options.editingMemberId).trim().toLowerCase();
  if (!currentEditingMemberId) {
    return {
      nextEditingMemberId: null,
      shouldResetForm: false,
      reason: "idle",
    };
  }

  if (options.mutationSucceeded) {
    return {
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "mutation_succeeded",
    };
  }

  if (options.readOnlyFallback) {
    return {
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "read_only_fallback",
    };
  }

  if (options.loadFailed) {
    return {
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "load_failed",
    };
  }

  const removedMemberId = toText(options.removedMemberId).trim().toLowerCase();
  if (removedMemberId && removedMemberId === currentEditingMemberId) {
    return {
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "member_removed",
    };
  }

  if (options.availableMemberIds) {
    const availableMemberIds = new Set(
      options.availableMemberIds
        .map((item) => toText(item).trim().toLowerCase())
        .filter(Boolean),
    );
    if (!availableMemberIds.has(currentEditingMemberId)) {
      return {
        nextEditingMemberId: null,
        shouldResetForm: true,
        reason: "member_missing",
      };
    }
  }

  return {
    nextEditingMemberId: currentEditingMemberId,
    shouldResetForm: false,
    reason: "keep",
  };
};

export const normalizeOrganizationItem = (value: unknown): OrgOrganizationItem | null => {
  const row = toObject(value);
  const id = toText(row.id || row.organizationId || row.orgId || row.tenantId)
    .trim()
    .toLowerCase();
  if (!id) return null;
  return {
    id,
    name: toText(row.name || row.organizationName || row.orgName || row.tenantName).trim() || id,
    status: toText(row.status).trim() === "disabled" ? "disabled" : "active",
    updatedAt: toText(row.updatedAt || row.updateTime || row.modifiedAt).trim() || undefined,
  };
};

export const normalizeProjectItem = (value: unknown): OrgProjectItem | null => {
  const row = toObject(value);
  const id = toText(row.id || row.projectId).trim();
  if (!id) return null;
  const organizationId = toText(
    row.organizationId || row.orgId || row.tenantId || toObject(row.organization).id,
  )
    .trim()
    .toLowerCase();
  return {
    id,
    name: toText(row.name || row.projectName).trim() || id,
    organizationId,
    status: toText(row.status).trim() === "disabled" ? "disabled" : "active",
    updatedAt: toText(row.updatedAt || row.updateTime || row.modifiedAt).trim() || undefined,
  };
};

export const normalizeMemberBindingItem = (value: unknown): OrgMemberBindingItem | null => {
  const row = toObject(value);
  const memberId = toText(row.memberId || row.id || row.userId).trim().toLowerCase();
  if (!memberId) return null;
  const projectsFromObjects = Array.isArray(row.projects)
    ? row.projects
        .map((item) => toText(toObject(item).id || toObject(item).projectId).trim())
        .filter(Boolean)
    : [];
  const projectIds = Array.from(
    new Set([...toTextArray(row.projectIds), ...projectsFromObjects]),
  );
  return {
    memberId,
    username:
      toText(
        row.username || row.displayName || row.name || row.userName || row.email || row.userId,
      ).trim() || memberId,
    userId: toText(row.userId).trim().toLowerCase() || undefined,
    email: toText(row.email).trim().toLowerCase() || undefined,
    displayName: toText(row.displayName || row.name).trim() || undefined,
    organizationId: toText(row.organizationId || row.orgId || row.tenantId)
      .trim()
      .toLowerCase(),
    projectIds,
    role:
      (["owner", "admin", "member", "viewer"] as const).find(
        (item) => item === toText(row.role).trim(),
      ) || undefined,
    status: toText(row.status).trim() === "disabled" ? "disabled" : "active",
    updatedAt: toText(row.updatedAt || row.updateTime || row.modifiedAt).trim() || undefined,
  };
};

export const normalizeMemberProjectBindingRow = (
  value: unknown,
): OrgMemberProjectBindingRow | null => {
  const row = toObject(value);
  const rawId = row.id;
  const parsedId = typeof rawId === "number" ? rawId : Number.parseInt(toText(rawId).trim(), 10);
  if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
  const memberId = toText(row.memberId || row.orgMemberId).trim().toLowerCase();
  const projectId = toText(row.projectId).trim();
  if (!memberId || !projectId) return null;
  return {
    id: parsedId,
    organizationId: toText(row.organizationId || row.orgId || row.tenantId)
      .trim()
      .toLowerCase(),
    memberId,
    projectId,
  };
};

export const normalizeOrgOverviewBucket = (value: unknown): OrgOverviewBucket | null => {
  const row = toObject(value);
  const total = Number(toText(row.total).trim());
  const active = Number(toText(row.active).trim());
  const disabled = Number(toText(row.disabled).trim());
  if (![total, active, disabled].every((item) => Number.isFinite(item))) {
    return null;
  }
  return {
    total: Math.max(0, Math.floor(total)),
    active: Math.max(0, Math.floor(active)),
    disabled: Math.max(0, Math.floor(disabled)),
  };
};

export const normalizeOrgOverviewData = (value: unknown): OrgOverviewData | null => {
  const root = toObject(value);
  const data = toObject(root.data);
  const organizationsBucket = normalizeOrgOverviewBucket(data.organizations);
  const projectsBucket = normalizeOrgOverviewBucket(data.projects);
  const membersBucket = normalizeOrgOverviewBucket(data.members);
  const bindingsRaw = toObject(data.bindings);
  const bindingsTotal = Number(toText(bindingsRaw.total).trim());
  if (
    !organizationsBucket ||
    !projectsBucket ||
    !membersBucket ||
    !Number.isFinite(bindingsTotal)
  ) {
    return null;
  }
  return {
    organizations: organizationsBucket,
    projects: projectsBucket,
    members: membersBucket,
    bindings: {
      total: Math.max(0, Math.floor(bindingsTotal)),
    },
  };
};

export interface OrgDomainLinkDescriptor {
  path: string;
  query: Record<string, string>;
}

export const normalizeOrgDomainLinkDescriptor = (
  value: unknown,
): OrgDomainLinkDescriptor | null => {
  const row = toObject(value);
  const path = toText(row.path).trim();
  if (!path) return null;

  const queryRaw = toObject(row.query);
  const query: Record<string, string> = {};
  Object.entries(queryRaw).forEach(([key, rawValue]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    const normalizedValue = toText(rawValue).trim();
    if (!normalizedValue) return;
    query[normalizedKey] = normalizedValue;
  });

  return {
    path,
    query,
  };
};

export interface OrgOrganizationOverviewLinks {
  projects?: OrgDomainLinkDescriptor;
  members?: OrgDomainLinkDescriptor;
  memberProjectBindings?: OrgDomainLinkDescriptor;
  auditEvents?: OrgDomainLinkDescriptor;
}

export interface OrgOrganizationOverviewData {
  kind: "organization";
  organization: OrgOrganizationItem;
  projects: OrgOverviewBucket;
  members: OrgOverviewBucket;
  bindings: {
    total: number;
  };
  links: OrgOrganizationOverviewLinks;
}

export const normalizeOrgOrganizationOverviewData = (
  value: unknown,
): OrgOrganizationOverviewData | null => {
  const root = toObject(value);
  const data = toObject(root.data);
  const organization = normalizeOrganizationItem(data.organization);
  const projectsBucket = normalizeOrgOverviewBucket(data.projects);
  const membersBucket = normalizeOrgOverviewBucket(data.members);
  const bindingsRaw = toObject(data.bindings);
  const bindingsTotal = Number(toText(bindingsRaw.total).trim());
  if (!organization || !projectsBucket || !membersBucket || !Number.isFinite(bindingsTotal)) {
    return null;
  }

  const linksRaw = toObject(data.links);
  const links: OrgOrganizationOverviewLinks = {};
  const projectsLink = normalizeOrgDomainLinkDescriptor(linksRaw.projects);
  if (projectsLink) links.projects = projectsLink;
  const membersLink = normalizeOrgDomainLinkDescriptor(linksRaw.members);
  if (membersLink) links.members = membersLink;
  const memberProjectBindingsLink = normalizeOrgDomainLinkDescriptor(
    linksRaw.memberProjectBindings,
  );
  if (memberProjectBindingsLink) links.memberProjectBindings = memberProjectBindingsLink;
  const auditEventsLink = normalizeOrgDomainLinkDescriptor(linksRaw.auditEvents);
  if (auditEventsLink) links.auditEvents = auditEventsLink;

  return {
    kind: "organization",
    organization,
    projects: projectsBucket,
    members: membersBucket,
    bindings: {
      total: Math.max(0, Math.floor(bindingsTotal)),
    },
    links,
  };
};

export interface OrgProjectOverviewLinks {
  memberProjectBindings?: OrgDomainLinkDescriptor;
  auditEvents?: OrgDomainLinkDescriptor;
  billingUsage?: OrgDomainLinkDescriptor;
}

export interface OrgProjectOverviewData {
  kind: "project";
  project: OrgProjectItem;
  organization: OrgOrganizationItem;
  bindings: {
    total: number;
    members: number;
  };
  links: OrgProjectOverviewLinks;
}

export const normalizeOrgProjectOverviewData = (
  value: unknown,
): OrgProjectOverviewData | null => {
  const root = toObject(value);
  const data = toObject(root.data);
  const project = normalizeProjectItem(data.project);
  const organization = normalizeOrganizationItem(data.organization);
  const bindingsRaw = toObject(data.bindings);
  const bindingsTotal = Number(toText(bindingsRaw.total).trim());
  const membersTotal = Number(toText(bindingsRaw.members).trim());
  if (
    !project ||
    !organization ||
    !Number.isFinite(bindingsTotal) ||
    !Number.isFinite(membersTotal)
  ) {
    return null;
  }

  const linksRaw = toObject(data.links);
  const links: OrgProjectOverviewLinks = {};
  const memberProjectBindingsLink = normalizeOrgDomainLinkDescriptor(
    linksRaw.memberProjectBindings,
  );
  if (memberProjectBindingsLink) {
    links.memberProjectBindings = memberProjectBindingsLink;
  }
  const auditEventsLink = normalizeOrgDomainLinkDescriptor(linksRaw.auditEvents);
  if (auditEventsLink) links.auditEvents = auditEventsLink;
  const billingUsageLink = normalizeOrgDomainLinkDescriptor(linksRaw.billingUsage);
  if (billingUsageLink) links.billingUsage = billingUsageLink;

  return {
    kind: "project",
    project,
    organization,
    bindings: {
      total: Math.max(0, Math.floor(bindingsTotal)),
      members: Math.max(0, Math.floor(membersTotal)),
    },
    links,
  };
};

export const buildOrgOverviewFallback = (
  organizationsData: OrgOrganizationItem[],
  projectsData: OrgProjectItem[],
  membersData: OrgMemberBindingItem[],
  bindingsData: OrgMemberProjectBindingRow[],
): OrgOverviewData => {
  const orgTotal = organizationsData.length;
  const orgActive = organizationsData.filter((item) => item.status === "active").length;
  const projectTotal = projectsData.length;
  const projectActive = projectsData.filter((item) => item.status === "active").length;
  const memberTotal = membersData.length;
  const memberActive = membersData.filter((item) => {
    const normalized = item.organizationId.trim().toLowerCase();
    if (!normalized) return true;
    const organization = organizationsData.find((row) => row.id === normalized);
    if (!organization) return true;
    return organization.status === "active";
  }).length;
  const bindingTotal =
    bindingsData.length > 0
      ? bindingsData.length
      : membersData.reduce((acc, item) => acc + item.projectIds.length, 0);

  return {
    organizations: {
      total: orgTotal,
      active: orgActive,
      disabled: Math.max(0, orgTotal - orgActive),
    },
    projects: {
      total: projectTotal,
      active: projectActive,
      disabled: Math.max(0, projectTotal - projectActive),
    },
    members: {
      total: memberTotal,
      active: memberActive,
      disabled: Math.max(0, memberTotal - memberActive),
    },
    bindings: {
      total: Math.max(0, bindingTotal),
    },
  };
};

export interface OrgDomainMemberBindingsLoadResult {
  members: OrgMemberBindingItem[];
  bindingRows: OrgMemberProjectBindingRow[];
}

export interface ResolveOrgDomainLoadResultOptions {
  results: [
    PromiseSettledResult<OrgOrganizationItem[]>,
    PromiseSettledResult<OrgProjectItem[]>,
    PromiseSettledResult<OrgDomainMemberBindingsLoadResult>,
  ];
  previous: {
    organizations: OrgOrganizationItem[];
    projects: OrgProjectItem[];
    members: OrgMemberBindingItem[];
    bindingRows: OrgMemberProjectBindingRow[];
  };
}

export interface ResolvedOrgDomainLoadResult {
  organizations: OrgOrganizationItem[];
  projects: OrgProjectItem[];
  members: OrgMemberBindingItem[];
  bindingRows: OrgMemberProjectBindingRow[];
  overviewFallback: OrgOverviewData;
  availability: OrgDomainAvailabilityState;
  failedSectionCount: number;
  errorMessage: string;
}

export const resolveOrgDomainLoadResult = (
  options: ResolveOrgDomainLoadResultOptions,
): ResolvedOrgDomainLoadResult => {
  const organizations =
    options.results[0].status === "fulfilled"
      ? options.results[0].value
      : options.previous.organizations;
  const projects =
    options.results[1].status === "fulfilled"
      ? options.results[1].value
      : options.previous.projects;
  const members =
    options.results[2].status === "fulfilled"
      ? options.results[2].value.members
      : options.previous.members;
  const bindingRows =
    options.results[2].status === "fulfilled"
      ? options.results[2].value.bindingRows
      : options.previous.bindingRows;
  const failedSectionCount = options.results.filter((item) => item.status === "rejected").length;

  return {
    organizations,
    projects,
    members,
    bindingRows,
    overviewFallback: buildOrgOverviewFallback(
      organizations,
      projects,
      members,
      bindingRows,
    ),
    availability: resolveOrgDomainAvailabilityState({
      loadFailed: failedSectionCount > 0,
    }),
    failedSectionCount,
    errorMessage:
      failedSectionCount > 0
        ? ORG_DOMAIN_READONLY_FALLBACK_MESSAGE
        : "",
  };
};

export interface EnterpriseOrgMemberEditFormState {
  organizationId: string;
  projectIds: string[];
}

export interface EnterpriseOrgMemberBindingMutationPlan {
  projectIds: string[];
  rowsToDelete: OrgMemberProjectBindingRow[];
  projectsToCreate: string[];
}

export const createOrgMemberEditForm = (options: {
  member: OrgMemberBindingItem;
  organizations: OrgOrganizationItem[];
  projects: OrgProjectItem[];
  fallbackOrganizationId?: string;
}): EnterpriseOrgMemberEditFormState => {
  const organizationId =
    options.member.organizationId ||
    options.organizations[0]?.id ||
    options.fallbackOrganizationId?.trim().toLowerCase() ||
    "";
  const validProjectIds = new Set(
    options.projects
      .filter((item) => (organizationId ? item.organizationId === organizationId : true))
      .map((item) => item.id),
  );
  return {
    organizationId,
    projectIds: options.member.projectIds.filter((item) => validProjectIds.has(item)),
  };
};

export const resolveOrganizationDisplayName = (
  organizationId: string,
  organizations: OrgOrganizationItem[],
) => {
  const id = organizationId.trim().toLowerCase();
  if (!id) return "-";
  const matched = organizations.find((item) => item.id === id);
  return matched ? `${matched.name} (${matched.id})` : id;
};

export const resolveProjectDisplay = (projectIds: string[], projects: OrgProjectItem[]) => {
  if (!projectIds.length) return "-";
  const nameMap = new Map(projects.map((item) => [item.id, item.name]));
  return projectIds
    .map((item) => (nameMap.get(item) ? `${nameMap.get(item)} (${item})` : item))
    .join(", ");
};

export const resolveAdminUserLabel = (userId: string, users: AdminUserItem[]) => {
  const id = userId.trim().toLowerCase();
  if (!id) return "";
  const matched = users.find((item) => item.id === id);
  if (!matched) return id;
  const display = matched.displayName?.trim() || matched.username || matched.id;
  return `${display} (${matched.id})`;
};

export const planOrgMemberBindingMutation = (options: {
  organizationId: string;
  selectedProjectIds: string[];
  projects: OrgProjectItem[];
  existingRows: OrgMemberProjectBindingRow[];
}) : EnterpriseOrgMemberBindingMutationPlan => {
  const organizationId = options.organizationId.trim().toLowerCase();
  const allowedProjects = new Set(
    options.projects
      .filter((item) => item.organizationId === organizationId)
      .map((item) => item.id),
  );
  const projectIds = Array.from(
    new Set(options.selectedProjectIds.filter((item) => allowedProjects.has(item))),
  );
  const targetProjectSet = new Set(projectIds);
  const rowsToDelete = options.existingRows.filter(
    (item) => item.organizationId !== organizationId || !targetProjectSet.has(item.projectId),
  );
  const existingProjectSet = new Set(
    options.existingRows
      .filter((item) => item.organizationId === organizationId)
      .map((item) => item.projectId),
  );
  const projectsToCreate = projectIds.filter((projectId) => !existingProjectSet.has(projectId));
  return {
    projectIds,
    rowsToDelete,
    projectsToCreate,
  };
};
