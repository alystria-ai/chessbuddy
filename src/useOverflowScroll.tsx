import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

export function useOverflowScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      setScrollable(el.scrollHeight > el.clientHeight + 1);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    const mutation = new MutationObserver(check);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);

  return { ref, scrollable };
}

type ScrollWhenClippedProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function ScrollWhenClipped({ className, children, ...rest }: ScrollWhenClippedProps) {
  const { ref, scrollable } = useOverflowScroll<HTMLDivElement>();
  const classes = [className, scrollable ? 'is-scrollable invisible-scroll' : ''].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={classes || undefined} {...rest}>
      {children}
    </div>
  );
}
