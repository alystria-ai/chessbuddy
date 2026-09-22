import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

type Props = {
  text: string;
  children: ReactNode;
  placement?: TooltipPlacement;
  wide?: boolean;
  className?: string;
  /**
   * Suppress the tooltip while true (e.g. a popover anchored to the same
   * trigger is open — hovering the still-focused button must not stack the
   * hint on top of the panel). An already-open tip closes immediately.
   */
  disabled?: boolean;
};

export function computeTooltipPosition(
  trigger: DOMRect,
  tip: DOMRect,
  placement: TooltipPlacement,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): { top: number; left: number } {
  const margin = 10;
  const gap = 8;
  const requestedOrder: TooltipPlacement[] = placement === 'auto'
    ? ['bottom', 'top', 'left', 'right']
    : [placement, 'bottom', 'top', 'left', 'right'];
  const order = requestedOrder.filter((side, index) => requestedOrder.indexOf(side) === index);

  const candidate = (side: TooltipPlacement) => {
    if (side === 'bottom') {
      return { top: trigger.bottom + gap, left: trigger.left + trigger.width / 2 - tip.width / 2 };
    }
    if (side === 'top') {
      return { top: trigger.top - tip.height - gap, left: trigger.left + trigger.width / 2 - tip.width / 2 };
    }
    if (side === 'left') {
      return { top: trigger.top + trigger.height / 2 - tip.height / 2, left: trigger.left - tip.width - gap };
    }
    return { top: trigger.top + trigger.height / 2 - tip.height / 2, left: trigger.right + gap };
  };

  for (const side of order) {
    const point = candidate(side);
    if (
      point.left >= margin
      && point.top >= margin
      && point.left + tip.width <= viewport.width - margin
      && point.top + tip.height <= viewport.height - margin
    ) {
      return point;
    }
  }

  const fallback = candidate(order[0] ?? 'bottom');
  return {
    top: Math.max(margin, Math.min(fallback.top, viewport.height - tip.height - margin)),
    left: Math.max(margin, Math.min(fallback.left, viewport.width - tip.width - margin)),
  };
}

export default function Tooltip({
  text,
  children,
  placement = 'auto',
  wide = false,
  className = '',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [allowFocusTooltip] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia('(any-pointer: fine)').matches,
  );

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tipRect = tipRef.current.getBoundingClientRect();
    const pos = computeTooltipPosition(triggerRect, tipRect, placement);
    setStyle({ top: pos.top, left: pos.left, position: 'fixed', visibility: 'visible' });
  }, [open, text, placement, wide]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!triggerRef.current || !tipRef.current) return;
      const pos = computeTooltipPosition(
        triggerRef.current.getBoundingClientRect(),
        tipRef.current.getBoundingClientRect(),
        placement,
      );
      setStyle({ top: pos.top, left: pos.left, position: 'fixed', visibility: 'visible' });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, placement]);

  if (!text) return <>{children}</>;

  return (
    <>
      <span
        ref={triggerRef}
        className={`tooltip-trigger ${className}`.trim()}
        onMouseEnter={() => !disabled && setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => !disabled && allowFocusTooltip && setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open && !disabled && createPortal(
        <div
          ref={tipRef}
          id={id}
          className={`app-tooltip${wide ? ' is-wide' : ''}`}
          style={style}
          role="tooltip"
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
