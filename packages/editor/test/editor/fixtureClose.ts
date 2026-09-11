const fixtureCloseTimeoutMs = 2_000

export async function closeFixtureSteps(steps: Array<{name: string, close: () => Promise<void>}>): Promise<void> {
    const errors: Error[] = []
    for (const step of steps) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                step.close(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`Timed out closing ${step.name} after ${fixtureCloseTimeoutMs}ms`))
                    }, fixtureCloseTimeoutMs)
                }),
            ])
        } catch (error) {
            errors.push(error instanceof Error ? error : new Error(String(error)))
        } finally {
            clearTimeout(timer)
        }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more fixture close steps failed')
}
