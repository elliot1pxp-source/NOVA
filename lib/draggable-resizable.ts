"use client";

import { useState, useRef, useEffect } from "react";

interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface UseDraggableResizableOptions {
  initialSize?: Size;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export function useDraggableResizable({
  initialSize = { width: 512, height: 680 },
  minWidth = 320,
  minHeight = 400,
  maxWidth = 1200,
  maxHeight = 900,
}: UseDraggableResizableOptions = {}) {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [size, setSize] = useState<Size>(initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const elRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef<Size>(initialSize);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // Center the dialog within the viewport on first mount (client-side only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = initialSize.width;
    const h = initialSize.height;
    setPosition({
      x: Math.max(0, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(0, Math.round((window.innerHeight - h) / 2)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clampPos = (x: number, y: number, w: number, h: number): Position => ({
    x: Math.max(0, Math.min(x, window.innerWidth - w)),
    y: Math.max(0, Math.min(y, window.innerHeight - h)),
  });

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const rect = elRef.current?.getBoundingClientRect();
    dragRef.current = {
      px: clientX,
      py: clientY,
      x: rect?.left ?? position.x,
      y: rect?.top ?? position.y,
    };
    setIsDragging(true);
    e.stopPropagation();
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const s = sizeRef.current;
    resizeRef.current = { px: clientX, py: clientY, w: s.width, h: s.height };
    setIsResizing(true);
    e.stopPropagation();
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const flush = () => {
      rafRef.current = null;
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      if (dragRef.current) {
        const d = dragRef.current;
        const w = sizeRef.current.width;
        const h = sizeRef.current.height;
        const next = clampPos(d.x + (clientX - d.px), d.y + (clientY - d.py), w, h);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          if (elRef.current) {
            elRef.current.style.left = `${next.x}px`;
            elRef.current.style.top = `${next.y}px`;
          }
          setPosition(next);
          flush();
        });
      } else if (resizeRef.current) {
        const r = resizeRef.current;
        const nw = Math.max(minWidth, Math.min(r.w + (clientX - r.px), maxWidth, window.innerWidth));
        const nh = Math.max(minHeight, Math.min(r.h + (clientY - r.py), maxHeight, window.innerHeight));
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          if (elRef.current) {
            elRef.current.style.width = `${nw}px`;
            elRef.current.style.height = `${nh}px`;
          }
          setSize({ width: nw, height: nh });
          flush();
        });
      }
    };

    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isDragging, isResizing, minWidth, minHeight, maxWidth, maxHeight]);

  return {
    position,
    size,
    isDragging,
    isResizing,
    handleDragStart,
    handleResizeStart,
    elRef,
  };
}