import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

type ScrollNavigationContextValue = {
  compact: boolean;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

const defaultValue: ScrollNavigationContextValue = {
  compact: false,
  onScroll: () => undefined,
};

const ScrollNavigationContext = createContext<ScrollNavigationContextValue>(defaultValue);

export function ScrollNavigationProvider({ children }: PropsWithChildren) {
  const [compact, setCompact] = useState(false);
  const previousOffset = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    const nextCompact = nextFloatingTabCompactState({
      compact,
      previousOffset: previousOffset.current,
      offset,
    });

    previousOffset.current = offset;
    if (nextCompact !== compact) {
      setCompact(nextCompact);
    }
  }, [compact]);

  return (
    <ScrollNavigationContext.Provider value={{ compact, onScroll }}>
      {children}
    </ScrollNavigationContext.Provider>
  );
}

export function useScrollNavigation() {
  return useContext(ScrollNavigationContext);
}

export function nextFloatingTabCompactState({
  compact,
  previousOffset,
  offset,
}: {
  compact: boolean;
  previousOffset: number;
  offset: number;
}) {
  const movement = offset - previousOffset;

  if (offset <= 16) {
    return false;
  }

  if (movement >= 18 && offset >= 72) {
    return true;
  }

  if (movement <= -8) {
    return false;
  }

  return compact;
}
