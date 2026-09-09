import type { $Env } from "teenybase/worker";

export interface AppVariables {
  userId: string;
  username: string;
  authKind: "agent" | "platform";
  gameId: string;
  gameSlug: string;
  agentTokenId?: string;
}

export interface SecretBindings {
  RUNTIME_UPLOAD_TOKEN?: string;
}

export type AppEnv = $Env<Env & SecretBindings, AppVariables>;

export interface GameRow {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  state: "creating" | "open" | "cleaning";
  visibility: "public" | "private";
  expires_at: string | null;
  anon_meta: string | null;
  claim_secret_hash: string | null;
  active_release: string | null;
  bytes_used: number;
  created_at: string;
  updated_at: string;
}

export interface ManifestFile {
  sha256: string;
  size: number;
  mime?: string;
}

export interface ReleaseManifest {
  files: Record<string, ManifestFile>;
}

export interface RuntimeRow {
  version: string;
  sha256: string;
  size: number;
  created_at: string;
}
