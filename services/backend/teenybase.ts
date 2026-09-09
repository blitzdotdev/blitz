import type {
  DatabaseSettings,
  TableAuthExtensionData,
  TableRulesExtensionData,
} from "teenybase";
import { sql, tableField } from "teenybase";
import {
  authFields,
  baseFields,
  createdTrigger,
  fields,
} from "teenybase/scaffolds/fields";

const internalRules: TableRulesExtensionData = {
  name: "rules",
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const config: DatabaseSettings = {
  appName: "Blitz games",
  appUrl: "https://blitz.dev",
  jwtSecret: "$PLATFORM_AUTH_JWT_SECRET",
  jwtIssuer: "blitz-games-platform",
  authProviders: [
    { name: 'google', clientId: '$GOOGLE_CLIENT_ID' },
  ],
  tables: [
    {
      name: "users",
      autoSetUid: true,
      fields: [
        ...baseFields,
        ...authFields,
        tableField("status", "text", "text", {
          notNull: true,
          default: sql`'active'`,
        }),
      ],
      triggers: [createdTrigger],
      extensions: [
        {
          name: "auth",
          passwordType: "sha256",
          jwtSecret: "$PLATFORM_AUTH_JWT_SECRET",
          jwtTokenDuration: 24 * 60 * 60,
          maxTokenRefresh: 30,
          passwordConfirmSuffix: "Confirm",
          autoSendVerificationEmail: false,
        } as TableAuthExtensionData,
        {
          name: "rules",
          listRule: "auth.uid == id",
          viewRule: "auth.uid == id",
          createRule: "true",
          updateRule: "auth.uid == id",
          deleteRule: null,
        } as TableRulesExtensionData,
      ],
    },
    {
      name: "games",
      autoSetUid: true,
      fields: [
        fields.id,
        tableField("owner_id", "text", "text", {
          notNull: true,
          foreignKey: { table: "users", column: "id" },
        }),
        tableField("slug", "text", "text", { notNull: true, unique: true }),
        tableField("name", "text", "text", { notNull: true }),
        tableField("state", "text", "text", { notNull: true, default: sql`'creating'` }),
        tableField("visibility", "text", "text", { notNull: true, default: sql`'public'` }),
        tableField("expires_at", "text", "text", {}),
        tableField("anon_meta", "text", "text", {}),
        tableField("claim_secret_hash", "text", "text", {}),
        tableField("active_release", "text", "text", {}),
        tableField("bytes_used", "integer", "integer", { notNull: true, default: sql`0` }),
        tableField("created_at", "text", "text", { notNull: true, default: sql`(datetime('now'))` }),
        tableField("updated_at", "text", "text", { notNull: true, default: sql`(datetime('now'))` }),
      ],
      indexes: [
        { fields: ["owner_id"] },
        { unique: true, fields: ["slug"] },
        { fields: ["expires_at"], where: sql`expires_at IS NOT NULL` },
        { fields: ["updated_at"], where: sql`state = 'cleaning'` },
      ],
      extensions: [internalRules],
    },
    {
      name: "game_tokens",
      autoSetUid: true,
      fields: [
        fields.id,
        tableField("game_id", "text", "text", {
          notNull: true,
          foreignKey: { table: "games", column: "id", onDelete: "CASCADE" },
        }),
        tableField("name", "text", "text", { notNull: true }),
        tableField("token_hash", "text", "text", { notNull: true, unique: true }),
        tableField("token_prefix", "text", "text", { notNull: true }),
        tableField("last_used_at", "text", "text", {}),
        tableField("revoked", "bool", "boolean", { notNull: true, default: sql`0` }),
        tableField("created_at", "text", "text", { notNull: true, default: sql`(datetime('now'))` }),
      ],
      indexes: [{ fields: ["game_id"] }],
      extensions: [internalRules],
    },
    {
      name: "releases",
      autoSetUid: true,
      fields: [
        fields.id,
        tableField("release_hash", "text", "text", { notNull: true }),
        tableField("game_id", "text", "text", {
          notNull: true,
          foreignKey: { table: "games", column: "id", onDelete: "CASCADE" },
        }),
        tableField("manifest_json", "text", "text", { notNull: true }),
        tableField("created_at", "text", "text", { notNull: true, default: sql`(datetime('now'))` }),
        tableField("message", "text", "text", {}),
      ],
      indexes: [
        { unique: true, fields: ["game_id", "release_hash"] },
        { fields: ["game_id", "created_at"] },
      ],
      extensions: [internalRules],
    },
  ],
};

export default config;
