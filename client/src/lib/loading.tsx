import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface LoadingContextValue {
  isLoading: boolean;
  loadingMessage: string;
  startLoading: () => void;
  stopLoading: () => void;
  withLoading: <T>(message: string, task: () => Promise<T>) => Promise<T>;
  showRouteTransition: (message?: string, durationMs?: number) => void;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [taskCount, setTaskCount] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading table...');
  const routeTimerRef = useRef<number | null>(null);
  const routeTransitionIdRef = useRef(0);

  const startLoading = useCallback(() => {
    setTaskCount((count) => count + 1);
  }, []);

  const stopLoading = useCallback(() => {
    setTaskCount((count) => Math.max(0, count - 1));
  }, []);

  const withLoading = useCallback(
    async <T,>(message: string, task: () => Promise<T>) => {
      setLoadingMessage(message);
      startLoading();

      try {
        return await task();
      } finally {
        stopLoading();
      }
    },
    [startLoading, stopLoading]
  );

  const showRouteTransition = useCallback((message = 'Loading table...', durationMs = 420) => {
    routeTransitionIdRef.current += 1;
    const transitionId = routeTransitionIdRef.current;
    setLoadingMessage(message);
    setRouteLoading(true);

    if (routeTimerRef.current !== null) {
      window.clearTimeout(routeTimerRef.current);
    }

    routeTimerRef.current = window.setTimeout(() => {
      if (transitionId === routeTransitionIdRef.current) {
        setRouteLoading(false);
      }
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (routeTimerRef.current !== null) {
        window.clearTimeout(routeTimerRef.current);
      }
    };
  }, []);

  const isLoading = taskCount > 0 || routeLoading;

  const value = useMemo<LoadingContextValue>(
    () => ({
      isLoading,
      loadingMessage,
      startLoading,
      stopLoading,
      withLoading,
      showRouteTransition
    }),
    [isLoading, loadingMessage, showRouteTransition, startLoading, stopLoading, withLoading]
  );

  return (
    <LoadingContext.Provider value={value}>
      {children}
      <div className={`global-loading-overlay ${isLoading ? 'visible' : ''}`} role="status" aria-live="polite" aria-hidden={!isLoading}>
        <div className="global-loading-card">
          <div className="loading-logo" aria-hidden="true">
            <img src="/KCFL_removed.png" alt="KCFL logo" className="loading-logo-core" />
            <span className="loading-logo-ring" />
          </div>
          <p>{loadingMessage}</p>
        </div>
      </div>
    </LoadingContext.Provider>
  );
}

export function useGlobalLoading() {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error('useGlobalLoading must be used within GlobalLoadingProvider');
  }

  return context;
}