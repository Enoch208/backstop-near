import { useEffect, useRef } from "react";

export function useStickToBottom(count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [count]);
  return ref;
}
