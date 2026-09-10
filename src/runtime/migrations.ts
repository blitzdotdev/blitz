export interface ProjectMigration {
    version: string
    migrate(projectRoot: string): void | Promise<void>
}

export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = []
