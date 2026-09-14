import {DependencyList, useEffect, useState} from "react";

export function useAsyncMemo<T>(
    factory: () => Promise<T>,
    deps: DependencyList
): T | undefined {
    const [result, setResult] = useState<T>();

    useEffect(() => {
        let cancelled = false;

        factory().then((value) => {
            if (!cancelled) {
                setResult(value);
            }
        });

        return () => {
            cancelled = true;
        };
    }, deps);

    return result;
}
