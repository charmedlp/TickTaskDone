// Temporary stand-in for the workspace that authentication will provide (Phase 10).
// Mirrors the backend's hard-coded dev user (idWorkspace = 1). A user has a single
// workspace for now, so no switching UI is needed.
export const workspaceId = Number(import.meta.env.VITE_WORKSPACE_ID ?? '1');

// Empty base uses the Vite dev proxy (/api -> backend). See vite.config.ts.
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';
