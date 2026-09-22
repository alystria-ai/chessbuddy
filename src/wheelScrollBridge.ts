import { useEffect } from 'react';

function wheelDeltaToPixels(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function canScrollVertically(el: HTMLElement, deltaY: number) {
  const maxScroll = el.scrollHeight - el.clientHeight;
  if (maxScroll <= 1) return false;
  if (deltaY > 0) return el.scrollTop < maxScroll - 1;
  if (deltaY < 0) return el.scrollTop > 1;
  return false;
}

function findScrollableAncestor(target: Element, root: HTMLElement, deltaY: number) {
  let el: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
  while (el && el !== root) {
    const style = window.getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && canScrollVertically(el, deltaY)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function createSmoothWheelScroller() {
  let target: HTMLElement | null = null;
  let targetTop = 0;
  let raf = 0;

  const step = () => {
    if (!target) {
      raf = 0;
      return;
    }

    const diff = targetTop - target.scrollTop;
    if (Math.abs(diff) < 0.5) {
      target.scrollTop = targetTop;
      target = null;
      raf = 0;
      return;
    }

    target.scrollTop += diff * 0.28;
    raf = requestAnimationFrame(step);
  };

  return {
    scroll(el: HTMLElement, deltaY: number) {
      if (target !== el) {
        target = el;
        targetTop = el.scrollTop;
      }
      const maxScroll = el.scrollHeight - el.clientHeight;
      targetTop = Math.max(0, Math.min(maxScroll, targetTop + deltaY));
      if (!raf) raf = requestAnimationFrame(step);
    },
    cancel() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      target = null;
    },
  };
}

export function useWheelScrollBridge() {
  useEffect(() => {
    const smoothScroller = createSmoothWheelScroller();

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      if (!(event.target instanceof Element)) return;

      const screen = event.target.closest('.game-screen, .menu-screen, .app-menu');
      if (!(screen instanceof HTMLElement) || screen.classList.contains('loading-screen')) return;

      const deltaY = wheelDeltaToPixels(event);
      if (!deltaY || findScrollableAncestor(event.target, screen, deltaY)) return;

      const pageScroller = document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : null;
      const scrollTarget = pageScroller && canScrollVertically(pageScroller, deltaY)
        ? pageScroller
        : canScrollVertically(screen, deltaY)
          ? screen
          : null;
      if (!scrollTarget || !canScrollVertically(scrollTarget, deltaY)) return;

      smoothScroller.scroll(scrollTarget, deltaY);
      event.preventDefault();
    };

    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true });
      smoothScroller.cancel();
    };
  }, []);
}
