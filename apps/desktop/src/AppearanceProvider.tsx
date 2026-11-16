import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

export type AppearanceMode = 'light' | 'dark' | 'system';
export type AppearanceColor = 'neutral' | 'blue' | 'green' | 'violet' | 'rose';
type ResolvedTheme = 'light' | 'dark';
type SaveState = 'ready' | 'saved' | 'error';
interface AppearancePreferences {
  mode: AppearanceMode;
  color: AppearanceColor;
}
interface StoredAppearance {
  preferences: AppearancePreferences;
  saveState: SaveState;
  storageError: string;
}
interface AppearanceContextValue extends AppearancePreferences {
  resolvedTheme: ResolvedTheme;
  saveState: SaveState;
  storageError: string;
  setMode: (mode: AppearanceMode) => void;
  setColor: (color: AppearanceColor) => void;
  retrySave: () => void;
  resetAppearance: () => void;
}

export const appearanceColors: { value: AppearanceColor; label: string }[] = [
  { value: 'neutral', label: '中性' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'violet', label: '紫色' },
  { value: 'rose', label: '玫红' },
];
const STORAGE_KEY = 'io.appearance';
const defaults: AppearancePreferences = { mode: 'system', color: 'neutral' };
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const modes = new Set<unknown>(['light', 'dark', 'system']);
const colors = new Set<unknown>(appearanceColors.map((color) => color.value));

function parsePreferences(raw: string | null): StoredAppearance {
  if (!raw) return { preferences: defaults, saveState: 'ready', storageError: '' };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('mode' in value) ||
      !('color' in value) ||
      !modes.has(value.mode) ||
      !colors.has(value.color)
    ) {
      throw new Error('invalid appearance');
    }
    return {
      preferences: { mode: value.mode as AppearanceMode, color: value.color as AppearanceColor },
      saveState: 'saved',
      storageError: '',
    };
  } catch {
    return {
      preferences: defaults,
      saveState: 'error',
      storageError: '本机外观设置无法识别，已恢复默认外观。可以重新选择并保存。',
    };
  }
}
function readPreferences(): StoredAppearance {
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {
      preferences: defaults,
      saveState: 'error',
      storageError: '无法读取本机外观设置，当前使用默认外观。',
    };
  }
}
function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoredAppearance>(readPreferences);
  const preferencesRef = useRef(state.preferences);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = state.preferences.mode === 'system' ? system : state.preferences.mode;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.dataset.themeColor = state.preferences.color;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, state.preferences.color]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystem(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
        const incoming = parsePreferences(event.key === null ? null : event.newValue);
        preferencesRef.current = incoming.preferences;
        setState(incoming);
      } catch {
        setState((current) => ({
          ...current,
          saveState: 'error',
          storageError: '无法同步其他窗口的外观设置，当前外观仍然有效。',
        }));
      }
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  const persist = useCallback((preferences: AppearancePreferences) => {
    preferencesRef.current = preferences;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
      setState({ preferences, saveState: 'saved', storageError: '' });
    } catch {
      setState({
        preferences,
        saveState: 'error',
        storageError: '外观已应用到当前窗口，但无法保存到本机；关闭后可能丢失。请重试保存。',
      });
    }
  }, []);
  const setMode = useCallback(
    (mode: AppearanceMode) => {
      if (modes.has(mode)) persist({ ...preferencesRef.current, mode });
    },
    [persist],
  );
  const setColor = useCallback(
    (color: AppearanceColor) => {
      if (colors.has(color)) persist({ ...preferencesRef.current, color });
    },
    [persist],
  );
  const value = useMemo<AppearanceContextValue>(
    () => ({
      ...state.preferences,
      resolvedTheme,
      saveState: state.saveState,
      storageError: state.storageError,
      setMode,
      setColor,
      retrySave: () => persist(preferencesRef.current),
      resetAppearance: () => persist(defaults),
    }),
    [state, resolvedTheme, setMode, setColor, persist],
  );
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('AppearanceProvider is required');
  return context;
}
