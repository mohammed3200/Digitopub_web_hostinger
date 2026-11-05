import React, { useState, useRef, useEffect, useId } from 'react';

interface CollapsibleContentProps {
  maxHeight?: number; // in pixels, default 300
  children: React.ReactNode;
  className?: string;
}

const gradientStyle: React.CSSProperties = {
  content: "''",
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: '3rem',
  background: 'linear-gradient(to bottom, transparent, var(--background))',
  pointerEvents: 'none',
};

export default function CollapsibleContent({ maxHeight = 300, children, className }: CollapsibleContentProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight;
      setNeedsCollapse(height > maxHeight);
    }
  }, [children, maxHeight]);

  const containerStyle: React.CSSProperties = {
    maxHeight: expanded ? undefined : maxHeight,
    overflow: 'hidden',
    position: 'relative',
    transition: 'max-height 0.3s ease',
  };

  return (
    <div className={className}>
      <div 
        id={contentId} 
        ref={contentRef} 
        style={containerStyle}
      >
        {children}
        {needsCollapse && !expanded && <div style={gradientStyle} aria-hidden="true" />}
      </div>
      {needsCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded(!expanded)}
          className="mt-2 inline-flex min-h-6 items-center text-sm font-medium text-primary hover:underline"
        >
          {expanded ? 'Read Less' : 'Read More'}
        </button>
      )}
    </div>
  );
}
