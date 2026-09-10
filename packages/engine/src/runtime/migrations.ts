export interface ProjectMigration {
    version: string
    migrate(projectRoot: string): void | Promise<void>
}

export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = []

export const NOOP_PROJECT_MIGRATION_EXAMPLE: ProjectMigration = {
    version: '0.0.0',
    migrate(_projectRoot) {
        // A migration may inspect or update files beneath projectRoot.
    },
}
