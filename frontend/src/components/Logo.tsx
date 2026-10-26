import React from 'react';

// Transparent-background version of the logo (the original white-backdrop file is kept alongside it).
export const LOGO_SRC = '/assets/adinn-diwali-logo-transparent.png';

// The artwork has black lettering. On dark backgrounds a thin white outline (the logo's own halo) keeps it readable.
const DARK_OUTLINE = 'drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff) drop-shadow(0 0 2px rgba(255,255,255,.9))';

// The logo is wide (1915x821): size it by height/width classes and let object-contain keep the ratio.
export const Logo: React.FC<{ className?: string; onDark?: boolean }> = ({ className = 'h-10 w-auto', onDark = false }) => (
  <img src={LOGO_SRC} alt="Adinn Diwali" className={`object-contain ${className}`} style={onDark ? { filter: DARK_OUTLINE } : undefined} />
);
